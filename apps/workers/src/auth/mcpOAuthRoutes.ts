import { z } from "zod";
import type { Context } from "hono";
import type { JSONValue } from "hono/utils/types";
import { isString } from "@llmgames/game-catalog";

/**
 * MCP OAuth 2.1 Authorization Server routes (Hono / Cloudflare Workers).
 *
 * Endpoints (all under /api/v1 so prod custom-domain routes match):
 * - GET  /api/v1/oauth/protected-resource
 * - GET  /api/v1/oauth/.well-known/oauth-authorization-server
 * - GET  /api/v1/oauth/.well-known/openid-configuration
 * - POST /api/v1/oauth/register          (DCR)
 * - GET  /api/v1/oauth/authorize         (browser: login + consent)
 * - GET|POST /api/v1/oauth/consent
 * - POST /api/v1/oauth/token
 * - POST /api/v1/oauth/revoke
 *
 * Also mounted at origin root /.well-known/* when the Worker receives those paths
 * (workers.dev, or custom route for well-known).
 */

import { Hono } from "hono";
import type { Env, Variables, User } from "../types";
import {
  MCP_SCOPE,
  PENDING_REQ_TTL,
  browserContentSecurityPolicy,
  clientAllowsRedirect,
  createAccessToken,
  createAuthCode,
  escapeHtml,
  getClient,
  htmlPage,
  isAllowedRedirectUri,
  issueRefreshToken,
  mcpResourceUrl,
  oauthError,
  protectedResourceMetadataUrl,
  randomToken,
  resolveClient,
  sha256Hex,
  timingSafeEqual,
  verifyPkceS256,
  issuerUrl,
} from "./mcpOAuth";
import { startBrowserLogin } from "./email";
import { renderOAuthConsent } from "./renderOAuthConsent";
import { cleanupExpiredOAuthRows, enforceRateLimit } from "./oauthSecurity";
import { clearSessionCookie, revokeBrowserSession } from "./session";

export const mcpOAuthApiRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

export const mcpOAuthWellKnownRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

function originFrom(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

function asMetadata(c: { req: { url: string } }) {
  const origin = originFrom(c);
  const issuer = issuerUrl(origin);

  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    revocation_endpoint: `${issuer}/revoke`,
    scopes_supported: [MCP_SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    service_documentation: `${origin}/api/v1/mcp/info`,
  };
}

function protectedResourceMetadata(origin: string) {
  const resource = mcpResourceUrl(origin);
  const issuer = issuerUrl(origin);

  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "llmgames MCP",
    resource_documentation: `${origin}/api/v1/mcp/info`,
  };
}

function jsonMeta<T extends JSONValue>(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  body: T,
) {
  return c.json(body, 200, { "Cache-Control": "public, max-age=60" });
}

function bodyTooLarge(
  request: { header(name: string): string | undefined },
  maxBytes = 64 * 1024,
): boolean {
  const length = Number(request.header("Content-Length") || 0);

  return Number.isFinite(length) && length > maxBytes;
}

const parseRegistrationMetadata = z
  .object({
    redirect_uris: z.unknown().optional(),
    token_endpoint_auth_method: z.unknown().optional(),
    client_name: z.unknown().optional(),
    grant_types: z.unknown().optional(),
    response_types: z.unknown().optional(),
    scope: z.unknown().optional(),
    client_uri: z.unknown().optional(),
    logo_uri: z.unknown().optional(),
  })
  .nullable()
  .catch(null).parse;

type RegistrationMetadataInput = NonNullable<ReturnType<typeof parseRegistrationMetadata>>;

// ── Discovery under /api/v1/oauth (works with prod route www…/api/v1/*) ──

mcpOAuthApiRoutes.get("/protected-resource", (c) =>
  jsonMeta(c, protectedResourceMetadata(originFrom(c))),
);

mcpOAuthApiRoutes.get("/.well-known/oauth-authorization-server", (c) => jsonMeta(c, asMetadata(c)));

mcpOAuthApiRoutes.get("/.well-known/openid-configuration", (c) => jsonMeta(c, asMetadata(c)));

mcpOAuthApiRoutes.get("/.well-known/oauth-protected-resource", (c) =>
  jsonMeta(c, protectedResourceMetadata(originFrom(c))),
);

// ── Root well-known (workers.dev / optional custom route) ─────────

mcpOAuthWellKnownRoutes.get("/oauth-authorization-server", (c) => jsonMeta(c, asMetadata(c)));

mcpOAuthWellKnownRoutes.get("/openid-configuration", (c) => jsonMeta(c, asMetadata(c)));

mcpOAuthWellKnownRoutes.get("/oauth-protected-resource", (c) =>
  jsonMeta(c, protectedResourceMetadata(originFrom(c))),
);

mcpOAuthWellKnownRoutes.get("/oauth-protected-resource/*", (c) =>
  jsonMeta(c, protectedResourceMetadata(originFrom(c))),
);

// Path-insertion form for issuer with path: /.well-known/oauth-authorization-server/api/v1/oauth
mcpOAuthWellKnownRoutes.get("/oauth-authorization-server/*", (c) => jsonMeta(c, asMetadata(c)));

mcpOAuthWellKnownRoutes.get("/openid-configuration/*", (c) => jsonMeta(c, asMetadata(c)));

// ── Dynamic Client Registration ──────────────────────────────────

mcpOAuthApiRoutes.post("/register", async (c) => {
  if (bodyTooLarge(c.req)) return oauthError("invalid_request", "Request body is too large", 413);

  const limited = await enforceRateLimit(
    c.env.DB,
    c.req.header("CF-Connecting-IP"),
    "oauth-register",
    20,
    3600,
  );

  if (limited) return limited;
  await cleanupExpiredOAuthRows(c.env.DB);

  let body: RegistrationMetadataInput | null;

  try {
    body = parseRegistrationMetadata(await c.req.json());
  } catch {
    return oauthError("invalid_client_metadata", "Request body must be JSON");
  }

  if (!body) {
    return oauthError("invalid_client_metadata", "Request body must be a JSON object");
  }

  const redirectUris = body.redirect_uris;

  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10) {
    return oauthError(
      "invalid_client_metadata",
      "redirect_uris is required and must be a non-empty array",
    );
  }

  for (const u of redirectUris) {
    if (!isString(u) || u.length > 2048) {
      return oauthError("invalid_client_metadata", "Invalid redirect_uri");
    }

    // Allow https, loopback http, and native MCP custom schemes
    // (e.g. cursor://anysphere.cursor-mcp/oauth/callback — RFC 8252 private-use).
    const check = isAllowedRedirectUri(u);

    if (!check.ok) {
      return oauthError("invalid_client_metadata", check.error);
    }
  }

  const authMethod = isString(body.token_endpoint_auth_method)
    ? body.token_endpoint_auth_method
    : "none";

  if (!new Set(["none", "client_secret_post"]).has(authMethod)) {
    return oauthError("invalid_client_metadata", "Unsupported token_endpoint_auth_method");
  }

  const isPublic = authMethod === "none";
  const clientId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  let clientSecret: string | undefined;
  let clientSecretHash: string | null = null;
  let clientSecretExpiresAt: number | undefined;

  if (!isPublic) {
    clientSecret = randomToken(32);
    clientSecretHash = await sha256Hex(clientSecret);
    clientSecretExpiresAt = now + 30 * 24 * 60 * 60;
  }

  const clientName = isString(body.client_name) ? body.client_name.slice(0, 200) : null;

  const grantTypes = Array.isArray(body.grant_types)
    ? body.grant_types
    : ["authorization_code", "refresh_token"];

  const responseTypes = Array.isArray(body.response_types) ? body.response_types : ["code"];

  if (
    grantTypes.length === 0 ||
    grantTypes.length > 2 ||
    grantTypes.some((v) => !isString(v) || !["authorization_code", "refresh_token"].includes(v)) ||
    responseTypes.length !== 1 ||
    responseTypes[0] !== "code"
  ) {
    return oauthError("invalid_client_metadata", "Unsupported grant_types or response_types");
  }

  const scope = isString(body.scope) ? body.scope : MCP_SCOPE;

  if (scope !== MCP_SCOPE) {
    return oauthError("invalid_client_metadata", `Only scope=${MCP_SCOPE} is supported`);
  }

  for (const field of ["client_uri", "logo_uri"] as const) {
    const value = body[field];

    if (
      value != null &&
      (!isString(value) || value.length > 2048 || !value.startsWith("https://"))
    ) {
      return oauthError("invalid_client_metadata", `${field} must be a bounded HTTPS URL`);
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO oauth_clients
     (client_id, client_secret_hash, client_name, redirect_uris,
      token_endpoint_auth_method, client_secret_expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      clientId,
      clientSecretHash,
      clientName,
      JSON.stringify(redirectUris),
      authMethod,
      clientSecretExpiresAt ?? null,
    )
    .run();

  return c.json(
    {
      client_id: clientId,
      client_id_issued_at: now,
      client_secret: clientSecret,
      client_secret_expires_at: clientSecretExpiresAt,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: authMethod,
      scope,
    },
    201,
    { "Cache-Control": "no-store" },
  );
});

// ── Authorize (browser) ──────────────────────────────────────────

mcpOAuthApiRoutes.get("/authorize", async (c) => {
  const limited = await enforceRateLimit(
    c.env.DB,
    c.req.header("CF-Connecting-IP"),
    "oauth-authorize",
    60,
    3600,
  );

  if (limited) return limited;
  await cleanupExpiredOAuthRows(c.env.DB);

  const q = c.req.query();
  const clientId = q.client_id;
  const redirectUri = q.redirect_uri;
  const responseType = q.response_type || "code";
  const codeChallenge = q.code_challenge;
  const codeChallengeMethod = q.code_challenge_method || "S256";
  const state = q.state;
  const scope = q.scope || MCP_SCOPE;
  const resource = q.resource || mcpResourceUrl(originFrom(c));

  if (!clientId || !redirectUri || !codeChallenge) {
    return htmlPage(
      "Invalid request",
      `
       <h1>Invalid <span class="brand">request</span></h1>
       <p class="error">Missing client_id, redirect_uri, or code_challenge.</p>
       <p>MCP clients must use OAuth 2.1 with PKCE (S256).</p>`,
      { assetBaseUrl: c.env.FRONTEND_URL },
    );
  }

  if (
    clientId.length > 2048 ||
    redirectUri.length > 2048 ||
    codeChallenge.length < 43 ||
    codeChallenge.length > 128 ||
    (state?.length ?? 0) > 2048 ||
    scope.length > 200 ||
    resource.length > 2048
  ) {
    return oauthError("invalid_request", "Authorization request is too large");
  }

  const expectedResource = mcpResourceUrl(originFrom(c)).replace(/\/$/, "");

  if (scope !== MCP_SCOPE || resource.replace(/\/$/, "") !== expectedResource) {
    return oauthError(
      "invalid_scope",
      "Only the llmgames MCP resource and mcp scope are supported",
    );
  }

  if (responseType !== "code") {
    return oauthError("unsupported_response_type", "Only response_type=code is supported");
  }

  if (codeChallengeMethod !== "S256") {
    return oauthError("invalid_request", "Only code_challenge_method=S256 is supported");
  }

  const client = await resolveClient(c.env.DB, clientId);

  if (!client) {
    return htmlPage(
      "Unknown client",
      `
       <h1>Unknown <span class="brand">client</span></h1>
       <p class="error">This MCP client is not registered.</p>
       <p>Clients should use Dynamic Client Registration or Client ID Metadata Documents.</p>`,
      { assetBaseUrl: c.env.FRONTEND_URL },
    );
  }

  if (!clientAllowsRedirect(client, redirectUri)) {
    return htmlPage(
      "Invalid redirect",
      `
       <h1>Redirect URI not <span class="brand">allowed</span></h1>
       <p class="error">The redirect_uri is not registered for this client.</p>
       <p><code>${escapeHtml(redirectUri)}</code></p>`,
      { assetBaseUrl: c.env.FRONTEND_URL },
    );
  }

  await c.env.DB.prepare(`UPDATE oauth_clients SET last_used_at = unixepoch() WHERE client_id = ?`)
    .bind(clientId)
    .run();

  const reqId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `INSERT INTO oauth_pending_requests
     (id, client_id, redirect_uri, code_challenge, code_challenge_method, scopes, resource, state, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      reqId,
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scope,
      resource,
      state ?? null,
      now + PENDING_REQ_TTL,
    )
    .run();

  const user = c.get("user");
  const consentUrl = new URL("/api/v1/oauth/consent", c.req.url);
  consentUrl.searchParams.set("req", reqId);

  if (user) {
    return c.redirect(consentUrl.toString());
  }

  // Choose a login method, then return to consent
  return startBrowserLogin(c, { returnTo: consentUrl.pathname + consentUrl.search });
});

// ── Consent ──────────────────────────────────────────────────────

type PendingOAuthRequest = {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scopes: string;
  resource: string | null;
  state: string | null;
  expires_at: number;
  created_at: number;
};

async function loadPendingById(db: D1Database, reqId: string | undefined) {
  if (!reqId) return null;

  const row = await db
    .prepare(`SELECT * FROM oauth_pending_requests WHERE id = ?`)
    .bind(reqId)
    .first<PendingOAuthRequest>();

  if (!row) return null;

  if (row.expires_at < Math.floor(Date.now() / 1000)) return null;

  return row;
}

async function loadPending(c: {
  env: Env;
  req: { query: (k?: string) => string | Record<string, string> };
}) {
  const requestedId = c.req.query("req");
  const reqId = isString(requestedId) ? requestedId : undefined;

  return loadPendingById(c.env.DB, reqId);
}

mcpOAuthApiRoutes.get("/consent", async (c) => {
  const pending = await loadPending(c);

  if (!pending) {
    return htmlPage(
      "Connection request ended",
      `<div class="status-icon error-icon" aria-hidden="true">!</div>
       <h1>This request is no longer available</h1>
       <p>The secure connection window may have been open too long. Return to your MCP client and choose connect again.</p>
       <a class="btn ghost" href="/setup">View connection guide</a>`,
      { status: 410, assetBaseUrl: c.env.FRONTEND_URL },
    );
  }

  const user = c.get("user");

  if (!user) {
    const returnTo = `/api/v1/oauth/consent?req=${encodeURIComponent(pending.id)}`;

    return startBrowserLogin(c, { returnTo });
  }

  const client = await getClient(c.env.DB, pending.client_id);
  const clientName = client?.client_name || "MCP client";

  return renderOAuthConsent({
    user,
    clientName,
    pending,
    assetBaseUrl: c.env.FRONTEND_URL,
  });
});

mcpOAuthApiRoutes.post("/change-account", async (c) => {
  if (bodyTooLarge(c.req, 16 * 1024)) {
    return oauthError("invalid_request", "Request body is too large", 413);
  }

  const limited = await enforceRateLimit(
    c.env.DB,
    c.req.header("CF-Connecting-IP"),
    "oauth-change-account",
    60,
    3600,
  );

  if (limited) return limited;

  const form = await c.req.parseBody();
  const reqId = isString(form.req) ? form.req : undefined;
  const pending = await loadPendingById(c.env.DB, reqId);

  if (!pending) {
    return htmlPage(
      "Connection request ended",
      `<div class="status-icon error-icon" aria-hidden="true">!</div>
       <h1>This request is no longer available</h1>
       <p>Return to your MCP client and choose connect again.</p>`,
      { status: 410, assetBaseUrl: c.env.FRONTEND_URL },
    );
  }

  const returnTo = `/api/v1/oauth/consent?req=${encodeURIComponent(pending.id)}`;
  const response = await startBrowserLogin(c, { returnTo });
  await revokeBrowserSession(c);
  clearSessionCookie(response, {
    secure: new URL(c.req.url).protocol === "https:",
  });

  return response;
});

mcpOAuthApiRoutes.post("/consent", async (c) => {
  if (bodyTooLarge(c.req, 16 * 1024))
    return oauthError("invalid_request", "Request body is too large", 413);
  const contentType = c.req.header("Content-Type") || "";
  let reqId: string | undefined;
  let decision: string | undefined;

  if (contentType.includes("application/json")) {
    const body = z
      .object({
        req: z.string().optional().catch(undefined),
        decision: z.string().optional().catch(undefined),
      })
      .nullable()
      .catch(null)
      .parse(await c.req.json());

    reqId = body?.req;
    decision = body?.decision;
  } else {
    const form = await c.req.parseBody();
    reqId = isString(form.req) ? form.req : undefined;
    decision = isString(form.decision) ? form.decision : undefined;
  }

  if (!reqId) {
    return htmlPage(
      "Invalid connection request",
      `<div class="status-icon error-icon" aria-hidden="true">!</div>
       <h1>That link is incomplete</h1>
       <p>No authorization request was included. Return to your MCP client and start the connection again.</p>`,
      { status: 400, assetBaseUrl: c.env.FRONTEND_URL },
    );
  }

  const pending = await c.env.DB.prepare(`SELECT * FROM oauth_pending_requests WHERE id = ?`)
    .bind(reqId)
    .first<{
      id: string;
      client_id: string;
      redirect_uri: string;
      code_challenge: string;
      code_challenge_method: string;
      scopes: string;
      resource: string | null;
      state: string | null;
      expires_at: number;
    }>();

  if (!pending || pending.expires_at < Math.floor(Date.now() / 1000)) {
    return htmlPage(
      "Connection request ended",
      `<div class="status-icon error-icon" aria-hidden="true">!</div>
       <h1>This request is no longer available</h1>
       <p>Return to your MCP client and choose connect again.</p>`,
      { status: 410, assetBaseUrl: c.env.FRONTEND_URL },
    );
  }

  const redirect = new URL(pending.redirect_uri);
  c.header("Content-Security-Policy", browserContentSecurityPolicy(pending.redirect_uri));

  if (decision !== "allow") {
    redirect.searchParams.set("error", "access_denied");
    redirect.searchParams.set("error_description", "User denied access to llmgames");

    if (pending.state) redirect.searchParams.set("state", pending.state);
    await c.env.DB.prepare(`DELETE FROM oauth_pending_requests WHERE id = ?`).bind(reqId).run();

    return c.redirect(redirect.toString(), 303);
  }

  const user = c.get("user");

  if (!user) {
    return startBrowserLogin(c, {
      returnTo: `/api/v1/oauth/consent?req=${encodeURIComponent(reqId)}`,
    });
  }

  // Keep the PKCE-bound request until its short expiry. If a browser repeats
  // the POST (double click, back/forward, native handoff retry), the final
  // navigation still receives a usable authorization code instead of replacing
  // the successful callback with a misleading "expired" page.
  const code = await createAuthCode(c.env.DB, {
    pendingRequestId: reqId,
    clientId: pending.client_id,
    userId: user.id,
    redirectUri: pending.redirect_uri,
    codeChallenge: pending.code_challenge,
    codeChallengeMethod: pending.code_challenge_method,
    scopes: pending.scopes || MCP_SCOPE,
    resource: pending.resource,
  });

  redirect.searchParams.set("code", code);

  if (pending.state) redirect.searchParams.set("state", pending.state);

  // A consent form POST must become a GET at HTTP and custom-scheme callbacks.
  return c.redirect(redirect.toString(), 303);
});

mcpOAuthApiRoutes.post("/handoff-status", async (c) => {
  if (bodyTooLarge(c.req, 4 * 1024)) {
    return oauthError("invalid_request", "Request body is too large", 413);
  }

  const limited = await enforceRateLimit(
    c.env.DB,
    c.req.header("CF-Connecting-IP"),
    "oauth-handoff-status",
    240,
    3600,
  );

  if (limited) return limited;

  let reqId: string | undefined;

  try {
    const body = await c.req.json<{ req?: unknown }>();
    reqId = isString(body.req) ? body.req : undefined;
  } catch {
    return oauthError("invalid_request", "Request body must be JSON");
  }

  if (!reqId || reqId.length > 128) {
    return oauthError("invalid_request", "Invalid authorization request");
  }

  const user = c.get("user");

  if (!user) return oauthError("invalid_request", "Session expired", 401);
  const pending = await loadPendingById(c.env.DB, reqId);

  if (!pending) {
    return c.json({ status: "pending" }, 200, { "Cache-Control": "no-store" });
  }

  const row = await c.env.DB.prepare(
    `SELECT 1 AS complete FROM oauth_authorization_codes
     WHERE pending_request_id = ? AND user_id = ? AND used_at IS NOT NULL
     LIMIT 1`,
  )
    .bind(reqId, user.id)
    .first<{ complete: 1 }>();

  return c.json({ status: row ? "complete" : "pending" }, 200, { "Cache-Control": "no-store" });
});

// ── Token ────────────────────────────────────────────────────────

mcpOAuthApiRoutes.post("/token", async (c) => {
  if (bodyTooLarge(c.req)) return oauthError("invalid_request", "Request body is too large", 413);

  const limited = await enforceRateLimit(
    c.env.DB,
    c.req.header("CF-Connecting-IP"),
    "oauth-token",
    120,
    3600,
  );

  if (limited) return limited;
  await cleanupExpiredOAuthRows(c.env.DB);

  const contentType = c.req.header("Content-Type") || "";
  let params: Record<string, string> = {};

  if (contentType.includes("application/json")) {
    const body = z.record(z.string(), z.unknown()).safeParse(await c.req.json());

    if (!body.success) return oauthError("invalid_request", "Token request must be a JSON object");

    for (const [key, value] of Object.entries(body.data)) if (isString(value)) params[key] = value;
  } else {
    const form = await c.req.parseBody();

    for (const [k, v] of Object.entries(form)) {
      if (isString(v)) params[k] = v;
    }
  }

  if (params.client_assertion !== undefined || params.client_assertion_type !== undefined) {
    return oauthError("invalid_client", "Client assertion authentication is not supported", 401);
  }

  const grantType = params.grant_type;
  const clientId = params.client_id;

  if (Object.values(params).some((value) => value.length > 4096)) {
    return oauthError("invalid_request", "Token parameter is too large");
  }

  if (!clientId) {
    return oauthError("invalid_client", "client_id is required", 401);
  }

  const client = await resolveClient(c.env.DB, clientId);

  if (!client) {
    return oauthError("invalid_client", "Unknown client", 401);
  }

  await c.env.DB.prepare(`UPDATE oauth_clients SET last_used_at = unixepoch() WHERE client_id = ?`)
    .bind(clientId)
    .run();
  const now = Math.floor(Date.now() / 1000);

  if (client.client_secret_expires_at && client.client_secret_expires_at <= now) {
    return oauthError("invalid_client", "Client secret has expired", 401);
  }

  // Confidential client secret check
  if (client.token_endpoint_auth_method !== "none" && client.client_secret_hash) {
    const secret = params.client_secret;

    if (!secret || !timingSafeEqual(await sha256Hex(secret), client.client_secret_hash)) {
      return oauthError("invalid_client", "Invalid client credentials", 401);
    }
  }

  if (grantType === "authorization_code") {
    const code = params.code;
    const codeVerifier = params.code_verifier;
    const redirectUri = params.redirect_uri;

    const resource = params.resource || mcpResourceUrl(originFrom(c));

    if (!code || !codeVerifier || !redirectUri) {
      return oauthError("invalid_request", "code, code_verifier, and redirect_uri are required");
    }

    const codeHash = await sha256Hex(code);

    const row = await c.env.DB.prepare(
      `SELECT * FROM oauth_authorization_codes WHERE code_hash = ?`,
    )
      .bind(codeHash)
      .first<{
        code_hash: string;
        client_id: string;
        user_id: string;
        redirect_uri: string;
        code_challenge: string;
        code_challenge_method: string;
        scopes: string;
        resource: string | null;
        expires_at: number;
        used_at: number | null;
      }>();

    if (!row || row.used_at || row.expires_at < Math.floor(Date.now() / 1000)) {
      return oauthError("invalid_grant", "Invalid or expired authorization code");
    }

    if (row.client_id !== clientId) {
      return oauthError("invalid_grant", "Code was not issued to this client");
    }

    if (redirectUri !== row.redirect_uri) {
      return oauthError("invalid_grant", "redirect_uri mismatch");
    }

    const pkceOk = await verifyPkceS256(codeVerifier, row.code_challenge);

    if (!pkceOk) {
      return oauthError("invalid_grant", "PKCE verification failed");
    }

    // Single-use
    const consumed = await c.env.DB.prepare(
      `UPDATE oauth_authorization_codes SET used_at = ?
       WHERE code_hash = ? AND used_at IS NULL AND expires_at >= ?`,
    )
      .bind(now, codeHash, now)
      .run();

    if ((consumed.meta.changes ?? 0) !== 1) {
      return oauthError("invalid_grant", "Authorization code was already used");
    }

    const userRow = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
      .bind(row.user_id)
      .first<User>();

    if (!userRow) {
      return oauthError("invalid_grant", "User no longer exists");
    }

    const tokenResource = row.resource || resource;

    const { access_token, expires_in } = await createAccessToken(c.env.ENCRYPTION_SECRET, userRow, {
      clientId,
      resource: tokenResource,
      scope: row.scopes || MCP_SCOPE,
    });

    const refresh_token = await issueRefreshToken(c.env.DB, {
      clientId,
      userId: userRow.id,
      scopes: row.scopes || MCP_SCOPE,
      resource: tokenResource,
    });

    return c.json(
      {
        access_token,
        token_type: "Bearer",
        expires_in,
        refresh_token,
        scope: row.scopes || MCP_SCOPE,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  }

  if (grantType === "refresh_token") {
    const refreshToken = params.refresh_token;

    if (!refreshToken) {
      return oauthError("invalid_request", "refresh_token is required");
    }

    const tokenHash = await sha256Hex(refreshToken);

    const row = await c.env.DB.prepare(`SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?`)
      .bind(tokenHash)
      .first<{
        token_hash: string;
        client_id: string;
        user_id: string;
        scopes: string;
        resource: string | null;
        expires_at: number;
        revoked_at: number | null;
      }>();

    if (
      !row ||
      row.revoked_at ||
      row.expires_at < Math.floor(Date.now() / 1000) ||
      row.client_id !== clientId
    ) {
      return oauthError("invalid_grant", "Invalid refresh token");
    }

    const userRow = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
      .bind(row.user_id)
      .first<User>();

    if (!userRow) {
      return oauthError("invalid_grant", "User no longer exists");
    }

    const resource = row.resource || params.resource || mcpResourceUrl(originFrom(c));

    const { access_token, expires_in } = await createAccessToken(c.env.ENCRYPTION_SECRET, userRow, {
      clientId,
      resource,
      scope: row.scopes || MCP_SCOPE,
    });

    // Atomically claim this refresh token before rotating it.
    const consumed = await c.env.DB.prepare(
      `UPDATE oauth_refresh_tokens SET revoked_at = ?
       WHERE token_hash = ? AND revoked_at IS NULL AND expires_at >= ?`,
    )
      .bind(now, tokenHash, now)
      .run();

    if ((consumed.meta.changes ?? 0) !== 1) {
      return oauthError("invalid_grant", "Refresh token was already used");
    }

    const newRefresh = await issueRefreshToken(c.env.DB, {
      clientId,
      userId: userRow.id,
      scopes: row.scopes || MCP_SCOPE,
      resource,
    });

    return c.json(
      {
        access_token,
        token_type: "Bearer",
        expires_in,
        refresh_token: newRefresh,
        scope: row.scopes || MCP_SCOPE,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  }

  return oauthError("unsupported_grant_type", `Unsupported grant_type: ${grantType}`);
});

// ── Revoke ───────────────────────────────────────────────────────

mcpOAuthApiRoutes.post("/revoke", async (c) => {
  if (bodyTooLarge(c.req, 16 * 1024)) return c.body(null, 200);
  const form = await c.req.parseBody().catch(() => ({ token: undefined }));
  const rawToken = form.token;
  const token = isString(rawToken) ? rawToken : null;

  if (token) {
    const tokenHash = await sha256Hex(token);
    await c.env.DB.prepare(`UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE token_hash = ?`)
      .bind(Math.floor(Date.now() / 1000), tokenHash)
      .run();
  }

  // RFC 7009: always 200
  return c.body(null, 200);
});

/** Build WWW-Authenticate challenge for MCP 401 responses */
export function mcpWwwAuthenticate(origin: string): string {
  // Always under /api/v1 so prod custom-domain routing reaches the Worker
  const meta = protectedResourceMetadataUrl(origin);

  return `Bearer resource_metadata="${meta}", scope="${MCP_SCOPE}"`;
}
