import { z } from "zod";
import { isString } from "@llmgames/game-catalog";

/**
 * MCP OAuth 2.1 helpers — PKCE, tokens, client store, redirect validation.
 * Authorization server is co-located with the Worker (same origin as MCP).
 */

import { sign, verify } from "hono/jwt";
import type { D1Database } from "@cloudflare/workers-types";
import type { User } from "../types";

export const MCP_SCOPE = "mcp";

const ACCESS_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days

const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days

const AUTH_CODE_TTL = 10 * 60; // 10 minutes

export const PENDING_REQ_TTL = 15 * 60; // 15 minutes

export interface OAuthClientRow {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  redirect_uris: string;
  token_endpoint_auth_method: string;
  client_secret_expires_at: number | null;
  last_used_at?: number | null;
}

export interface McpAccessTokenPayload {
  sub: string;
  email: string;
  name: string | null;
  typ: "mcp_at";
  aud: string;
  client_id: string;
  scope: string;
  iat: number;
  exp: number;
}

const clientMetadataSchema = z.object({
  client_id: z.string().min(1),
  redirect_uris: z.array(z.string()),
  client_name: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).min(1).optional(),
  scope: z.string().optional(),
  client_uri: z.string().optional(),
  logo_uri: z.string().optional(),
});

const accessTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  name: z.string().nullable(),
  typ: z.literal("mcp_at"),
  aud: z.string(),
  client_id: z.string(),
  scope: z.string(),
  iat: z.number(),
  exp: z.number(),
});

export function mcpResourceUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/v1/mcp`;
}

/**
 * Authorization server issuer.
 * Uses `/api/v1/oauth` so discovery works when only `/api/v1/*` is routed
 * to the Worker (prod custom domain). Clients discover via path-append:
 *   {issuer}/.well-known/openid-configuration
 */
export function issuerUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/v1/oauth`;
}

/** Protected Resource Metadata URL advertised in WWW-Authenticate (always under /api/v1). */
export function protectedResourceMetadataUrl(origin: string): string {
  return `${issuerUrl(origin)}/protected-resource`;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);

  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Base64url without padding */
function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";

  for (const b of arr) s += String.fromCharCode(b);

  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Verify PKCE S256: BASE64URL(SHA256(verifier)) === challenge
 */
export async function verifyPkceS256(
  codeVerifier: string,
  codeChallenge: string,
): Promise<boolean> {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const computed = base64Url(digest);

  return timingSafeEqual(computed, codeChallenge);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;

  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);

  return out === 0;
}

/** Schemes that must never be OAuth redirect targets. */
const BLOCKED_REDIRECT_SCHEMES = new Set([
  "javascript:",
  "data:",
  "file:",
  "blob:",
  "about:",
  "vbscript:",
  "ws:",
  "wss:",
]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isPublicMetadataUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    if (url.protocol !== "https:" || url.username || url.password) return false;

    if (
      LOOPBACK_HOSTS.has(host) ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      !host.includes(".") ||
      host.includes(":")
    )
      return false;
    const octets = host.split(".").map(Number);

    if (octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      const [a, b] = octets;

      if (
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 169 && b === 254) ||
        (a === 172 && b! >= 16 && b! <= 31) ||
        (a === 192 && b === 168)
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a redirect_uri for Dynamic Client Registration (RFC 7591 / RFC 8252).
 *
 * Allowed:
 * - https: (any host)
 * - http: loopback only (localhost / 127.0.0.1 / ::1)
 * - Private-use / custom schemes for native MCP hosts (RFC 8252 §7.1),
 *   e.g. cursor://anysphere.cursor-mcp/oauth/callback
 */
export function isAllowedRedirectUri(uri: string): { ok: true } | { ok: false; error: string } {
  try {
    const parsed = new URL(uri);
    const protocol = parsed.protocol.toLowerCase();

    if (protocol === "https:") return { ok: true };

    if (protocol === "http:") {
      const host = parsed.hostname.toLowerCase();

      if (!LOOPBACK_HOSTS.has(host)) {
        return {
          ok: false,
          error: "http redirect_uris are only allowed for loopback",
        };
      }

      return { ok: true };
    }

    if (BLOCKED_REDIRECT_SCHEMES.has(protocol)) {
      return { ok: false, error: `Unsupported redirect_uri: ${uri}` };
    }

    // Application / private-use scheme: alpha + alphanum / + / - / .
    if (!/^[a-z][a-z0-9+.-]*:$/i.test(protocol)) {
      return { ok: false, error: `Unsupported redirect_uri: ${uri}` };
    }

    // Require a host (cursor://host/path) or path (app:/callback) so bare "scheme:" is rejected.
    if (!parsed.hostname && !parsed.pathname) {
      return { ok: false, error: `Invalid redirect_uri: ${uri}` };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: `Invalid redirect_uri: ${uri}` };
  }
}

/**
 * Loopback redirect URIs may use any port (RFC 8252 §7.3).
 * Non-loopback requires exact match.
 */
export function redirectUriMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;

  try {
    const req = new URL(requested);
    const reg = new URL(registered);
    const reqHost = req.hostname.toLowerCase();
    const regHost = reg.hostname.toLowerCase();

    if (
      LOOPBACK_HOSTS.has(reqHost) &&
      LOOPBACK_HOSTS.has(regHost) &&
      req.protocol === reg.protocol &&
      req.pathname === reg.pathname &&
      req.search === reg.search
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];

  try {
    const v: unknown = JSON.parse(raw);

    return Array.isArray(v) ? v.filter((x): x is string => isString(x)) : [];
  } catch {
    return [];
  }
}

export async function getClient(db: D1Database, clientId: string): Promise<OAuthClientRow | null> {
  return (
    (await db
      .prepare(`SELECT * FROM oauth_clients WHERE client_id = ?`)
      .bind(clientId)
      .first<OAuthClientRow>()) ?? null
  );
}

/**
 * Resolve client: DCR row, or Client ID Metadata Document (HTTPS URL client_id).
 */
export async function resolveClient(
  db: D1Database,
  clientId: string,
): Promise<OAuthClientRow | null> {
  const existing = await getClient(db, clientId);

  if (existing) return existing;

  // Client ID Metadata Document (CIMD): client_id is an HTTPS URL
  if (!isPublicMetadataUrl(clientId) || clientId.length > 2048) return null;

  try {
    const res = await fetch(clientId, {
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;
    const contentLength = Number(res.headers.get("content-length") || 0);

    if (contentLength > 64 * 1024) return null;
    const text = await res.text();

    if (text.length > 64 * 1024) return null;
    const parsedMetadata = clientMetadataSchema.safeParse(JSON.parse(text));
    const meta = parsedMetadata.success ? parsedMetadata.data : null;

    if (!meta) return null;

    if (meta.client_id !== clientId) return null;

    if (
      !Array.isArray(meta.redirect_uris) ||
      meta.redirect_uris.length === 0 ||
      meta.redirect_uris.length > 10 ||
      meta.redirect_uris.some(
        (uri) => !isString(uri) || uri.length > 2048 || !isAllowedRedirectUri(uri).ok,
      ) ||
      (meta.grant_types ?? ["authorization_code", "refresh_token"]).some(
        (grant) => !["authorization_code", "refresh_token"].includes(grant),
      ) ||
      JSON.stringify(meta.response_types ?? ["code"]) !== JSON.stringify(["code"]) ||
      !(meta.token_endpoint_auth_methods_supported ?? [meta.token_endpoint_auth_method ?? "none"]).includes("none") ||
      (meta.scope != null && meta.scope !== MCP_SCOPE)
    ) {
      return null;
    }

    const row: OAuthClientRow = {
      client_id: clientId,
      client_secret_hash: null,
      client_name: meta.client_name?.slice(0, 200) ?? null,
      redirect_uris: JSON.stringify(meta.redirect_uris),
      token_endpoint_auth_method: "none",
      client_secret_expires_at: null,
    };

    // Cache for future lookups
    await db
      .prepare(
        `INSERT OR REPLACE INTO oauth_clients
         (client_id, client_secret_hash, client_name, redirect_uris,
          token_endpoint_auth_method, client_secret_expires_at)
         VALUES (?, NULL, ?, ?, ?, NULL)`,
      )
      .bind(row.client_id, row.client_name, row.redirect_uris, row.token_endpoint_auth_method)
      .run();

    return row;
  } catch {
    return null;
  }
}

export function clientAllowsRedirect(client: OAuthClientRow, redirectUri: string): boolean {
  const uris = parseJsonArray(client.redirect_uris);

  return uris.some((u) => redirectUriMatches(redirectUri, u));
}

export async function createAccessToken(
  secret: string,
  user: User,
  opts: { clientId: string; resource: string; scope: string },
): Promise<{ access_token: string; expires_in: number }> {
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    typ: "mcp_at",
    aud: opts.resource,
    client_id: opts.clientId,
    scope: opts.scope,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL,
  } satisfies McpAccessTokenPayload;

  const access_token = await sign(payload, secret, "HS256");

  return { access_token, expires_in: ACCESS_TOKEN_TTL };
}

export async function verifyMcpAccessToken(
  secret: string,
  token: string,
  expectedResource?: string,
): Promise<McpAccessTokenPayload | null> {
  try {
    const parsedToken = accessTokenPayloadSchema.safeParse(await verify(token, secret, "HS256"));
    const decoded = parsedToken.success ? parsedToken.data : null;

    if (!decoded) return null;

    if (!decoded.client_id || !decoded.scope?.split(/\s+/).includes(MCP_SCOPE)) {
      return null;
    }

    if (expectedResource && decoded.aud !== expectedResource) {
      // Allow trailing-slash mismatch
      const a = decoded.aud.replace(/\/$/, "");
      const b = expectedResource.replace(/\/$/, "");

      if (a !== b) return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

export function userFromAccessToken(payload: McpAccessTokenPayload): User {
  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    gamertag: null,
    created_at: 0,
    updated_at: 0,
    user_type: "human",
  };
}

export async function issueRefreshToken(
  db: D1Database,
  opts: {
    clientId: string;
    userId: string;
    scopes: string;
    resource: string | null;
  },
): Promise<string> {
  const raw = `llmgr_${randomToken(32)}`;
  const tokenHash = await sha256Hex(raw);
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO oauth_refresh_tokens
       (token_hash, client_id, user_id, scopes, resource, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tokenHash,
      opts.clientId,
      opts.userId,
      opts.scopes,
      opts.resource,
      now + REFRESH_TOKEN_TTL,
    )
    .run();

  return raw;
}

export async function createAuthCode(
  db: D1Database,
  opts: {
    pendingRequestId: string;
    clientId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scopes: string;
    resource: string | null;
  },
): Promise<string> {
  const raw = randomToken(32);
  const codeHash = await sha256Hex(raw);
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO oauth_authorization_codes
       (code_hash, pending_request_id, client_id, user_id, redirect_uri, code_challenge,
        code_challenge_method, scopes, resource, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      codeHash,
      opts.pendingRequestId,
      opts.clientId,
      opts.userId,
      opts.redirectUri,
      opts.codeChallenge,
      opts.codeChallengeMethod,
      opts.scopes,
      opts.resource,
      now + AUTH_CODE_TTL,
    )
    .run();

  return raw;
}

export function oauthError(error: string, description?: string, status = 400): Response {
  return new Response(
    JSON.stringify({
      error,
      error_description: description,
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

const BASE_BROWSER_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; " +
  "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'";

/**
 * OAuth form redirects are constrained to the request's already-validated
 * callback. Without this source, Chrome blocks the 303 handoff to native MCP
 * listeners because the consent document previously declared form-action=self.
 */
export function browserContentSecurityPolicy(
  callbackUri?: string,
  scriptNonce?: string,
  assetBaseUrl?: string,
): string {
  let callbackSource: string | null = null;
  let callbackFrameSource: string | null = null;

  if (callbackUri) {
    try {
      const callback = new URL(callbackUri);

      if (callback.protocol === "http:" || callback.protocol === "https:") {
        callbackSource = callback.origin;

        if (
          callback.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname.toLowerCase())
        ) {
          callbackFrameSource = callback.origin;
        }
      } else if (/^[a-z][a-z0-9+.-]*:$/i.test(callback.protocol)) {
        callbackSource = callback.protocol;
      }
    } catch {
      // Invalid callbacks are rejected before rendering; retain self-only here.
    }
  }

  let assetSource = "'self'";

  if (assetBaseUrl) {
    try {
      const assetOrigin = new URL(assetBaseUrl).origin;

      if (/^https?:\/\//.test(assetOrigin)) assetSource += ` ${assetOrigin}`;
    } catch {
      // Invalid asset origins fall back to same-origin resources.
    }
  }

  const scriptSource = scriptNonce ? `'nonce-${scriptNonce}'` : "'none'";

  return `${BASE_BROWSER_CSP}; img-src ${assetSource} https: data:; font-src ${assetSource}; script-src ${scriptSource}; frame-src ${callbackFrameSource ? `'self' ${callbackFrameSource}` : "'none'"}; form-action 'self'${callbackSource ? ` ${callbackSource}` : ""}`;
}

/**
 * Browser shell for MCP OAuth consent and error pages.
 * Uses the same contemporary typography and surfaces as the web app.
 */
export function htmlPage(
  title: string,
  body: string,
  options: { status?: number; callbackUri?: string; assetBaseUrl?: string } = {},
): Response {
  const scriptNonce = randomToken(16);
  let assetBaseUrl = "";

  if (options.assetBaseUrl) {
    try {
      const parsed = new URL(options.assetBaseUrl);

      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        assetBaseUrl = parsed.origin;
      }
    } catch {
      // Same-origin assets remain the safe fallback.
    }
  }

  const assetUrl = (path: string) => escapeHtml(`${assetBaseUrl}${path}`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>${escapeHtml(title)} · llmgames</title>
  <link rel="icon" href="${assetUrl("/llmgames-favicon-v3.ico")}" />
  <script nonce="${scriptNonce}">
    (() => {
      const applyTheme = (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        document.documentElement.classList.toggle("light", theme === "light");
      };
      let theme;
      try { theme = localStorage.getItem("llm-games-theme"); } catch {}
      if (theme !== "light" && theme !== "dark") {
        theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
      applyTheme(theme);
      addEventListener("DOMContentLoaded", () => {
        const toggle = document.querySelector("[data-theme-toggle]");
        const sync = () => toggle?.setAttribute("aria-pressed", String(document.documentElement.classList.contains("dark")));
        sync();
        toggle?.addEventListener("click", () => {
          const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
          applyTheme(next);
          try { localStorage.setItem("llm-games-theme", next); } catch {}
          sync();
        });


      });
    })();
  </script>
  <style>
    :root {
      --background: #f7f7f7;
      --foreground: #181818;
      --card: #ffffff;
      --card-foreground: #181818;
      --primary: #202020;
      --primary-foreground: #ffffff;
      --muted: #efefef;
      --muted-foreground: #666666;
      --secondary: #eeeeee;
      --secondary-foreground: #262626;
      --border: #dedede;
      --destructive: oklch(0.58 0.21 25);
      --ring: #737373;
      --font-body: "Manrope", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-display: "Manrope", system-ui, sans-serif;
    }
    :root.dark {
      --background: #0c0c0c;
      --foreground: #eeeeee;
      --card: #151515;
      --card-foreground: #eeeeee;
      --primary: #eeeeee;
      --primary-foreground: #151515;
      --muted: #202020;
      --muted-foreground: #a3a3a3;
      --secondary: #232323;
      --secondary-foreground: #eeeeee;
      --border: #303030;
      --destructive: oklch(0.65 0.2 25);
      --ring: #a3a3a3;
    }
    @media (prefers-color-scheme: dark) {
      :root:not(.light) {
        --background: #0c0c0c;
        --foreground: #eeeeee;
        --card: #151515;
        --card-foreground: #eeeeee;
        --primary: #eeeeee;
        --primary-foreground: #151515;
        --muted: #202020;
        --muted-foreground: #a3a3a3;
        --secondary: #232323;
        --secondary-foreground: #eeeeee;
        --border: #303030;
        --destructive: oklch(0.65 0.2 25);
        --ring: #a3a3a3;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { min-width: 320px; color-scheme: light dark; }
    body {
      min-height: 100vh;
      font-family: var(--font-body);
      font-size: 1rem;
      line-height: 1.55;
      color: var(--foreground);
      background: var(--background);
    }
    a { color: inherit; }
    :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
    ::selection { background: var(--primary); color: var(--primary-foreground); }
    .site-header {
      position: fixed;
      inset: 0 0 auto;
      z-index: 10;
      height: 72px;
      border-bottom: 1px solid var(--border);
      background: color-mix(in oklch, var(--background) 85%, transparent);
      backdrop-filter: blur(20px);
    }
    .header-inner {
      width: 100%;
      max-width: 1440px;
      height: 100%;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 32px;
    }
    .wordmark {
      display: flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
    }
    .logo-mark {
      width: 28px;
      height: 28px;
      flex-shrink: 0;
    }
    .logo-word {
      font-family: var(--font-display);
      font-size: 1rem;
      letter-spacing: -0.04em;
      font-weight: 700;
    }
    .header-link {
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 12px;
      border-radius: 9px;
      color: var(--muted-foreground);
      font-size: 0.8rem;
      font-weight: 700;
      text-decoration: none;
      transition: color 180ms ease, background 180ms ease;
    }
    .header-link:hover { color: var(--foreground); background: var(--muted); }
    .header-actions { display: flex; align-items: center; gap: 8px; }
    .theme-toggle {
      width: 36px;
      min-height: 36px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      border-radius: 9px;
      background: var(--card);
      color: var(--foreground);
    }
    .theme-toggle:hover { background: var(--muted); }
    .theme-toggle svg { width: 16px; height: 16px; }
    .theme-toggle .sun { display: none; }
    :root.dark .theme-toggle .moon { display: none; }
    :root.dark .theme-toggle .sun { display: block; }
    main {
      min-height: 100vh;
      display: flex;
      align-items: center;
      padding: 112px 32px 56px;
    }
    .page-grid {
      width: 100%;
      max-width: 1440px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(380px, 0.75fr);
      align-items: center;
      gap: clamp(64px, 8vw, 112px);
    }
    .brand-panel {
      display: flex;
      flex-direction: column;
      gap: 28px;
      max-width: 720px;
    }
    .hero-badge,
    .badge {
      width: fit-content;
      min-height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      padding: 3px 10px;
      border-radius: 999px;
      background: var(--secondary);
      color: var(--secondary-foreground);
      font-size: 0.72rem;
      font-weight: 700;
    }
    .brand-panel h2 {
      max-width: 690px;
      font-family: var(--font-display);
      font-size: clamp(3.25rem, 5.8vw, 5.7rem);
      line-height: 0.94;
      letter-spacing: -0.07em;
      font-weight: 700;
    }
    .brand-panel h2 span { color: var(--primary); }
    .hero-copy {
      max-width: 520px;
      color: var(--muted-foreground);
      font-size: 1.2rem;
      line-height: 1.45;
    }
    .feature-list {
      max-width: 580px;
      display: grid;
      gap: 12px;
      list-style: none;
    }
    .feature-list li {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 14px 16px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: color-mix(in oklch, var(--card) 72%, transparent);
    }
    .feature-icon {
      flex: 0 0 34px;
      width: 34px;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      background: color-mix(in oklch, var(--primary) 10%, transparent);
      color: var(--primary);
    }
    .feature-icon svg { width: 18px; height: 18px; }
    .feature-list strong {
      display: block;
      font-family: var(--font-display);
      font-size: 0.9rem;
      line-height: 1.3;
    }
    .feature-list p {
      margin: 3px 0 0;
      font-size: 0.85rem;
      line-height: 1.45;
    }
    .auth-panel {
      width: 100%;
      max-width: 520px;
      justify-self: end;
    }
    .card {
      width: 100%;
      background: var(--card);
      color: var(--card-foreground);
      padding: 24px;
      border: 1px solid var(--border);
      border-radius: 4px;
      box-shadow: 0 1px 2px color-mix(in oklch, var(--foreground) 4%, transparent);
    }
    .card-heading { margin-bottom: 18px; text-align: center; }
    .card-heading .badge { margin: 0 auto 18px; }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--primary);
    }
    .eyebrow {
      font-family: var(--font-display);
      font-size: 0.7rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--muted-foreground);
      margin-bottom: 8px;
      font-weight: 700;
    }
    h1 {
      font-family: var(--font-display);
      font-size: clamp(1.75rem, 4vw, 2.15rem);
      line-height: 1.12;
      letter-spacing: -0.04em;
      margin: 0 0 10px;
      font-weight: 700;
    }
    h1 .brand { color: var(--primary); }
    p {
      color: var(--muted-foreground);
      line-height: 1.5;
      margin: 0 0 18px;
      font-size: 0.95rem;
    }
    code {
      font-family: var(--font-body);
      font-size: 0.85rem;
      word-break: break-all;
      color: var(--foreground);
      background: var(--muted);
      padding: 3px 7px;
      border-radius: 6px;
    }
    .user {
      display: flex;
      gap: 14px;
      align-items: center;
      padding: 14px;
      margin: 0 0 18px;
      background: color-mix(in oklch, var(--muted) 62%, transparent);
      border: 1px solid var(--border);
      border-radius: 4px;
    }
    .user img,
    .user .avatar-fallback {
      width: 44px;
      height: 44px;
      flex-shrink: 0;
      border-radius: 999px;
      border: 1px solid var(--border);
      object-fit: cover;
    }
    .user .avatar-fallback {
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--primary);
      color: var(--primary-foreground);
      font-family: var(--font-display);
      font-size: 0.9rem;
      font-weight: 700;
    }
    .user .meta { min-width: 0; }
    .user .meta .meta-label {
      margin-bottom: 2px;
      color: var(--muted-foreground);
      font-size: 0.68rem;
      line-height: 1.2;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 700;
    }
    .user .meta strong {
      display: block;
      font-family: var(--font-display);
      font-size: 0.9rem;
      letter-spacing: -0.01em;
      color: var(--foreground);
      font-weight: 700;
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .user .meta span {
      display: block;
      color: var(--muted-foreground);
      font-size: 0.8rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .account-switch {
      flex: 0 0 auto;
      margin-left: auto;
    }
    .account-switch button {
      width: auto;
      min-height: 32px;
      padding: 5px 10px;
      border-color: var(--border);
      border-radius: 9px;
      background: transparent;
      color: var(--muted-foreground);
      font-size: 0.75rem;
    }
    .account-switch button:hover {
      color: var(--foreground);
      background: var(--muted);
    }
    .permission-block {
      margin-bottom: 20px;
      padding: 17px 2px;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }
    .permission-block .permission-title {
      margin: 0 0 12px;
      color: var(--foreground);
      font-family: var(--font-display);
      font-size: 0.78rem;
      font-weight: 700;
    }
    .permissions { display: grid; gap: 10px; list-style: none; }
    .permissions li {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      color: var(--muted-foreground);
      font-size: 0.82rem;
      line-height: 1.45;
    }
    .check {
      flex: 0 0 20px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: color-mix(in oklch, var(--primary) 13%, transparent);
      color: var(--primary);
      font-size: 0.72rem;
      font-weight: 800;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 0;
    }
    form.actions { margin: 0; }
    button,
    .btn {
      appearance: none;
      position: relative;
      border: 1px solid transparent;
      border-radius: 12px;
      min-height: 48px;
      padding: 12px 16px;
      font-family: var(--font-body);
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      text-decoration: none;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      line-height: 1.5;
      transition: background-color 180ms ease, color 180ms ease, transform 180ms ease, box-shadow 180ms ease;
    }
    button:active,
    .btn:active {
      transform: translateY(1px);
    }
    .primary {
      background: var(--primary);
      color: var(--primary-foreground);
      box-shadow: 0 1px 2px color-mix(in oklch, var(--foreground) 8%, transparent);
    }
    .primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 5px 14px color-mix(in oklch, var(--primary) 18%, transparent);
    }
    .button-arrow { font-size: 1rem; line-height: 1; }
    .ghost {
      background: transparent;
      color: var(--muted-foreground);
      border-color: var(--border);
    }
    .ghost:hover {
      color: var(--foreground);
      background: color-mix(in oklch, var(--muted) 50%, transparent);
    }
    .error {
      color: var(--destructive);
      font-size: 0.9rem;
      margin-bottom: 12px;
    }
    .status-icon {
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 18px;
      border-radius: 4px;
      font-family: var(--font-display);
      font-weight: 700;
    }
    .error-icon {
      color: var(--destructive);
      background: color-mix(in oklch, var(--destructive) 12%, transparent);
      border: 1px solid color-mix(in oklch, var(--destructive) 24%, transparent);
    }
    [hidden] { display: none !important; }
    .handoff { padding: 16px 4px 12px; text-align: center; }
    .handoff .status-icon {
      margin: 0 auto 18px;
      color: var(--primary);
      background: color-mix(in oklch, var(--primary) 12%, transparent);
      border: 1px solid color-mix(in oklch, var(--primary) 24%, transparent);
    }
    .handoff .status-icon svg { width: 22px; height: 22px; }
    .handoff .success-check { display: none; }
    .handoff.is-complete .progress-ring { display: none; }
    .handoff.is-complete .success-check { display: block; }
    .progress-ring { animation: handoff-spin 900ms linear infinite; }
    .handoff-note {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin-top: 4px;
      padding: 6px 10px;
      border-radius: 999px;
      background: var(--muted);
      color: var(--muted-foreground);
      font-size: 0.72rem;
      font-weight: 700;
    }
    .handoff-note span {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--primary);
    }
    @keyframes handoff-spin { to { transform: rotate(360deg); } }
    .foot {
      text-align: center;
      font-size: 0.75rem;
      color: var(--muted-foreground);
      padding-top: 16px;
    }
    .foot a {
      color: var(--foreground);
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .foot a:hover { color: var(--primary); }
    @media (max-width: 900px) {
      .header-inner { padding: 0 20px; }
      main { padding: 104px 20px 44px; }
      .page-grid { display: block; max-width: 520px; }
      .brand-panel { display: none; }
      .auth-panel { max-width: none; }
    }
    @media (max-width: 520px) {
      .logo-word { display: none; }
      .header-link { font-size: 0.75rem; }
      main { padding: 96px 14px 32px; align-items: flex-start; }
      .card { padding: 22px 18px; }
      .header-actions { gap: 4px; }
      .header-link { padding: 0 8px; }
      .user { gap: 11px; padding: 12px; }
      .user img, .user .avatar-fallback { width: 40px; height: 40px; }
      .account-switch button { padding-inline: 8px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 1ms !important; }
    }
    /* Public authorization pages share the sign-in layout. */
    html, html.light, html.dark { --primary: #f2c438; --primary-foreground: #211b08; }
    html.light { color-scheme: light; }
    html.dark { color-scheme: dark; }
    .site-header { height: 60px; background: var(--background); backdrop-filter: none; }
    main { min-height: 100dvh; display: flex; align-items: center; padding: 108px 24px 48px; }
    .page-grid { display: block; width: 100%; max-width: 640px; margin: auto; }
    .auth-panel { max-width: none; width: 100%; }
    .card { padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; text-align: center; }
    .card::before, .card::after { display: none; }
    .card-heading { margin: 0 0 32px; text-align: center; }
    h1 { font-family: var(--font-body); font-size: clamp(2.75rem, 5vw, 4.5rem); font-weight: 600; letter-spacing: -.04em; line-height: 1.06; overflow-wrap: anywhere; margin: 0 0 20px; }
    h1 .brand { color: inherit; }
    .card p { max-width: 440px; margin: 0 auto 24px; font-size: 1rem; line-height: 1.75; }
    .user, .permission-block, .actions { width: 100%; max-width: 400px; margin-inline: auto; text-align: left; }
    .user { padding: 14px 16px; border: 1px solid var(--border); border-radius: 6px; background: var(--muted); margin-bottom: 24px; }
    .user .meta { flex: 1; }
    .user .avatar-fallback { width: 38px; height: 38px; font-family: var(--font-body); }
    .user .meta strong { font-family: var(--font-body); font-weight: 600; }
    .account-switch button { border: 0; border-radius: 4px; text-decoration: underline; text-underline-offset: 4px; }
    .permission-block { border: 0; padding: 0; margin-bottom: 28px; }
    .permission-block .permission-title { margin: 0 0 12px; font-size: .875rem; line-height: 1.5; font-weight: 600; }
    .permissions { padding: 0; gap: 12px; }
    .permissions li { font-size: .875rem; }
    .check { color: var(--foreground); background: transparent; }
    form.actions { margin: 0 auto; }
    button, input { font-family: var(--font-body); }
    button, .btn { border-radius: 4px; font-weight: 500; box-shadow: none; }
    .actions .primary { min-height: 48px; font-size: 1rem; border: 0; }
    .actions .ghost { border: 0; min-height: 40px; }
    .card > .btn { max-width: 400px; margin: 28px auto 0; }
    .permission-title, .meta-label { text-transform: none !important; letter-spacing: normal !important; }
    .status-icon, .handoff .status-icon { margin: 0 auto 24px; width: 48px; height: 48px; border-radius: 50%; }
    .status-icon:not(.error-icon) { background: var(--muted); color: var(--foreground); border: 0; }
    .handoff { padding: 0; }
    .handoff-note { border-radius: 4px; font-weight: 500; }
    .foot { margin: 28px auto 0; text-align: center; font-size: .75rem; }
    .foot a { text-decoration: underline; text-underline-offset: 4px; }
    @media (max-width: 520px) { main { padding: 88px 20px 32px; } .card { padding: 0; } .user { gap: 10px; } }
    @font-face {font-family:"Geist";src:url("${assetUrl("/fonts/geist-variable.woff2")}") format("woff2");font-weight:100 900;font-style:normal;font-display:swap;}
    :root {--font-body:"Geist",-apple-system,system-ui,sans-serif;--font-display:"Geist",-apple-system,system-ui,sans-serif;--background:#f4f4f1;--card:#ffffff;--popover:#ffffff;--foreground:#0b0b0c;--muted:#ebebe6;--muted-foreground:#5f5f66;--border:#e2e2dc;--primary:#0b0b0c;}
    html.dark {--background:#0b0b0c;--card:#131314;--popover:#131314;--foreground:#ffffff;--muted:#1b1b1d;--muted-foreground:#8e8e95;--border:#2a2a2d;--primary:#ffffff;}
    body {background:var(--background);color:var(--foreground);-webkit-font-smoothing:antialiased;}
    .page-grid {max-width:520px;}
    h1 {font-size:clamp(40px,6vw,60px);font-weight:600;letter-spacing:-.05em;line-height:1;margin-bottom:20px;}
    .card-heading {margin-bottom:28px;}
    .card p {max-width:none;font-size:17px;line-height:1.55;color:var(--muted-foreground);}
    .user,.permission-block,.actions {max-width:none;}
    .user {border:0;border-radius:18px;padding:16px;background:var(--muted);}
    .user .meta strong {font-size:18px;}.user .meta span {font-size:14px;}
    .permission-block .permission-title,.permissions li {font-size:15px;}
    button,.btn {border-radius:999px;transition:transform .22s cubic-bezier(.34,1.56,.64,1),opacity .2s;}
    button:active,.btn:active {transform:scale(.96);}
    .actions .primary,.actions .ghost {min-height:52px;font-size:17px;font-weight:550;border:0;}
    .actions .primary {background:var(--primary);color:var(--background);}
    .actions .ghost {background:transparent;color:var(--foreground);}
    .actions .ghost:hover {background:var(--muted);}
    .foot {font-size:13px;color:var(--muted-foreground);}
    @media(max-width:600px) {.card p {font-size:16px;}.user .meta span {overflow-wrap:anywhere;}.user .meta {min-width:0;}}
    .auth-panel {padding:36px;border:0;border-radius:34px;background:var(--card);box-shadow:0 0 0 1px rgba(11,11,12,.06),0 28px 56px -24px rgba(11,11,12,.35);animation:rise .7s cubic-bezier(.22,1,.36,1) both;}
    html.dark .auth-panel {box-shadow:inset 0 0 0 1px var(--border);}
    @keyframes rise {from {opacity:0;transform:translateY(18px) scale(.985);} to {opacity:1;transform:none;}}
    @media(prefers-reduced-motion:reduce) {.auth-panel {animation:none;} button,.btn {transition:none;}}
    @media(max-width:600px) {.auth-panel {padding:24px 20px;border-radius:26px;}}
  </style>
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a class="wordmark" href="${assetUrl("/")}" aria-label="llmgames home">
        <img class="logo-mark" src="${assetUrl("/llmgames-mark-v5.svg")}" width="28" height="28" alt="" />
        <span class="logo-word">llmgames</span>
      </a>
      <div class="header-actions">
        <a class="header-link" href="${assetUrl("/setup")}">Connection guide</a>
        <button class="theme-toggle" type="button" data-theme-toggle aria-label="Toggle color theme" aria-pressed="false">
          <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>
          <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>
        </button>
      </div>
    </div>
  </header>
  <main>
    <div class="page-grid">
      <section class="auth-panel" aria-label="MCP authorization">
        <div class="card">
          ${body}
        </div>
        <p class="foot"><a href="${assetUrl("/privacy")}">Privacy</a> · <a href="${assetUrl("/terms")}">Terms</a></p>
      </section>
    </div>
  </main>
</body>
</html>`;

  return new Response(html, {
    status: options.status ?? 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": browserContentSecurityPolicy(
        options.callbackUri,
        scriptNonce,
        assetBaseUrl,
      ),
    },
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
