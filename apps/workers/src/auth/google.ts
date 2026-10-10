import { z } from "zod";
import { isString } from "@llmgames/game-catalog";

import type { Context } from "hono";
import { sign, verify } from "hono/jwt";
import type { Env, Variables, User } from "../types";
import {
  allowedBrowserWrite,
  clearSessionCookie,
  createSession,
  revokeBrowserSession,
  setSessionCookie,
} from "./session";
import { defaultGamertagSeed, ensureUserGamertag, generateAvailableGamertag } from "./gamertags";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const OAUTH_STATE_TTL = 10 * 60;

const LEGACY_OAUTH_STATE_COOKIE = "oauth_state";

interface GoogleUserProfile {
  email: string;
  verified_email: true;
  name?: string;
}

export function browserLoginDestination(
  frontendUrl: string,
  user: Pick<User, "gamertag_selected">,
): string {
  const path = user.gamertag_selected === 1 ? "/play" : "/onboarding";

  return new URL(path, frontendUrl).toString();
}

export function loginReturnDestination(
  returnTo: string,
  apiOrigin: string,
  frontendUrl: string,
): string {
  const baseUrl = returnTo.startsWith("/api/v1/oauth/") ? apiOrigin : frontendUrl;

  return new URL(returnTo, baseUrl).toString();
}

const parseGoogleAccessToken = z
  .object({ access_token: z.string().min(1) })
  .nullable()
  .catch(null)
  .transform((value) => value?.access_token ?? null).parse;

const parseGoogleUser = z
  .object({
    email: z.string().min(1),
    verified_email: z.literal(true),
    name: z.string().optional(),
  })
  .nullable()
  .catch(null).parse;

/**
 * Generates a cryptographically secure random state string (64 hex characters)
 * for use as the OAuth 2.0 `state` parameter to prevent CSRF attacks.
 *
 * @returns {string} A 64-character lowercase hex string.
 */
function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);

  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Only allow same-origin relative return paths (open-redirect protection).
 */
export function sanitizeReturnTo(
  returnTo: string | undefined | null,
  requestOrigin: string,
): string | null {
  if (!returnTo) return null;

  if (
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/.test(returnTo)
  )
    return null;

  try {
    const destination = new URL(returnTo, requestOrigin);

    if (destination.origin !== requestOrigin || destination.pathname.startsWith("//")) return null;

    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return null;
  }
}

/**
 * Keep each browser authorization attempt in its own cookie. MCP hosts often
 * start more than one login concurrently (for example Cursor and Codex); one
 * shared `oauth_state` cookie makes the later attempt invalidate the first.
 */
function oauthStateCookieName(state: string): string {
  return `oauth_state_${state}`;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const prefix = `${name}=`;

  for (const part of header.split(";")) {
    const value = part.trim();

    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }

  return null;
}

/** Cookie flags: Secure only on HTTPS (localhost HTTP needs Secure omitted). */
function oauthStateCookie(name: string, stateToken: string, secure: boolean): string {
  const base = `${name}=${stateToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_STATE_TTL}`;

  return secure ? `${base}; Secure` : base;
}

function clearOAuthStateCookie(name: string, secure: boolean): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

/**
 * Starts Google OAuth and either returns JSON `{ authUrl }` (API/web) or redirects
 * the browser (MCP authorize flow).
 *
 * `returnTo` is a same-origin path to land on after login (e.g. MCP consent).
 */
export async function startGoogleOAuth(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  opts: { returnTo?: string | null; mode?: "json" | "redirect" } = {},
) {
  const state = generateState();
  const now = Math.floor(Date.now() / 1000);
  const reqUrl = new URL(c.req.url);
  const returnTo = sanitizeReturnTo(opts.returnTo ?? null, reqUrl.origin);

  const stateToken = await sign(
    {
      typ: "oauth_state",
      state,
      returnTo,
      exp: now + OAUTH_STATE_TTL,
    },
    c.env.ENCRYPTION_SECRET,
    "HS256",
  );

  const stateCookieName = oauthStateCookieName(state);

  const redirectUri = new URL("/api/v1/auth/oauth/google/callback", reqUrl).toString();
  const secure = reqUrl.protocol === "https:";

  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set("client_id", c.env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "online");
  authUrl.searchParams.set("prompt", "select_account");

  const mode = opts.mode ?? "redirect";

  if (mode === "json") {
    return c.json({ authUrl: authUrl.toString() }, 200, {
      // Secure only on HTTPS so localhost HTTP can hold the CSRF cookie
      "Set-Cookie": oauthStateCookie(stateCookieName, stateToken, secure),
    });
  }

  // Browser redirect (MCP OAuth login)
  const res = c.redirect(authUrl.toString());
  res.headers.append("Set-Cookie", oauthStateCookie(stateCookieName, stateToken, secure));

  return res;
}

/**
 * `POST /auth/oauth/google` — Initiates the Google OAuth 2.0 authorisation flow for the web app.
 *
 * Generates a short-lived signed state token, builds the Google
 * authorisation URL, and returns both the URL and a `HttpOnly` `oauth_state` cookie
 * for subsequent CSRF validation in the callback.
 */
export async function googleAuth(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const body = await c.req.json<{ returnTo?: string }>();

  return startGoogleOAuth(c, {
    mode: "json",
    returnTo: isString(body?.returnTo) ? body.returnTo : null,
  });
}

/**
 * `GET /auth/oauth/google/callback` — Handles the Google OAuth 2.0 callback.
 *
 * Validates the `state` parameter against the signed `oauth_state` cookie to
 * prevent CSRF. Exchanges the authorisation `code` for tokens, fetches the
 * user's profile from Google, upserts the user in the database via {@link upsertUser},
 * creates a session JWT via `createSession`, and redirects to the frontend.
 * The temporary `oauth_state` cookie is cleared on redirect.
 *
 * @param {Context} c - The Hono request context. Expects `code`, `state`, and optionally
 *   `error` query parameters set by Google.
 * @returns {Response} A redirect to the frontend home page on success, or to
 *   `/login?error=<reason>` on any failure.
 */
export async function googleCallback(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const { code, state, error } = c.req.query();
  const frontendUrl = c.env.FRONTEND_URL || "http://localhost:3000";
  const reqUrl = new URL(c.req.url);
  const secure = reqUrl.protocol === "https:";
  const validState = isString(state) && /^[a-f0-9]{64}$/.test(state);

  const stateCookieName = validState ? oauthStateCookieName(state) : LEGACY_OAUTH_STATE_COOKIE;

  const clearStateCookie = clearOAuthStateCookie(stateCookieName, secure);

  if (error) {
    return c.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return c.redirect(`${frontendUrl}/login?error=missing_params`);
  }

  // Verify state from cookie
  const cookieHeader = c.req.header("Cookie");

  const stateToken =
    readCookie(cookieHeader, stateCookieName) ??
    // Accept an in-flight login created before this change was deployed.
    readCookie(cookieHeader, LEGACY_OAUTH_STATE_COOKIE);

  if (!stateToken) {
    return c.redirect(`${frontendUrl}/login?error=missing_state_cookie`);
  }

  let returnTo: string | null = null;

  try {
    const payload = z
      .object({
        typ: z.string().optional(),
        state: z.string(),
        returnTo: z.string().nullable().optional(),
      })
      .parse(await verify(stateToken, c.env.ENCRYPTION_SECRET, "HS256"));

    if (payload.typ !== "oauth_state" || payload.state !== state) {
      return c.redirect(`${frontendUrl}/login?error=invalid_state`);
    }

    returnTo = sanitizeReturnTo(payload.returnTo ?? null, reqUrl.origin);
  } catch {
    return c.redirect(`${frontendUrl}/login?error=invalid_state`);
  }

  try {
    // Exchange code for tokens
    const redirectUri = new URL("/api/v1/auth/oauth/google/callback", c.req.url).toString();

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      await tokenResponse.body?.cancel();

      return c.redirect(`${frontendUrl}/login?error=token_exchange_failed`);
    }

    const accessToken = parseGoogleAccessToken(await tokenResponse.json());

    if (!accessToken) {
      return c.redirect(`${frontendUrl}/login?error=token_exchange_failed`);
    }

    // Get user info
    const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userInfoResponse.ok) {
      return c.redirect(`${frontendUrl}/login?error=userinfo_failed`);
    }

    const googleUser = parseGoogleUser(await userInfoResponse.json());

    if (!googleUser || !googleUser.email.trim() || googleUser.email.length > 320) {
      return c.redirect(`${frontendUrl}/login?error=unverified_email`);
    }

    // Upsert user in database
    const user = await upsertUser(c, googleUser);

    // Create session
    const sessionToken = await createSession(c, user);

    // MCP OAuth resumes consent. Browser players only enter onboarding once.
    const dest = returnTo
      ? loginReturnDestination(returnTo, reqUrl.origin, frontendUrl)
      : browserLoginDestination(frontendUrl, user);

    const response = c.redirect(dest);
    // Secure only on HTTPS (localhost HTTP needs a non-Secure session cookie)
    setSessionCookie(response, sessionToken, { secure });

    // Clear the temporary oauth_state cookie
    response.headers.append("Set-Cookie", clearStateCookie);

    return response;
  } catch {
    console.error("OAuth callback failed");

    return c.redirect(`${frontendUrl}/login?error=callback_failed`);
  }
}

/** Revoke the browser session before deleting its cookie. */
export async function logout(c: Context<{ Bindings: Env; Variables: Variables }>) {
  if (!allowedBrowserWrite(c)) return c.json({ error: "Request origin is not allowed." }, 403);

  if (c.req.header("Authorization"))
    return c.json({ error: "Use a browser session to sign out." }, 401);
  const all = c.req.path.endsWith("/logout-all");

  if (all && !c.get("session")?.id)
    return c.json({ error: "Sign in to end your browser sessions." }, 401);
  await revokeBrowserSession(c, all);
  const response = c.json({ success: true });
  response.headers.set("Cache-Control", "no-store");
  clearSessionCookie(response, { secure: new URL(c.req.url).protocol === "https:" });

  return response;
}

/**
 * Creates or updates a user record in the database based on their Google profile.
 *
 * - **Existing user** (matched by email): updates the account name and keeps the
 *   generated abstract avatar preference.
 * - **New user**: inserts a fresh record with a generated UUID.
 *
 * @param {Context} c - The Hono request context (provides DB access).
 * @param {GoogleUserProfile} googleUser
 *   The user profile returned by the Google UserInfo endpoint.
 * @returns {Promise<User>} The upserted {@link User} record.
 */
export async function upsertUser(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  googleUser: GoogleUserProfile,
): Promise<User> {
  const now = Math.floor(Date.now() / 1000);
  const email = googleUser.email.trim().toLowerCase();
  const name = googleUser.name?.slice(0, 200) || "Player";

  // Check if user exists
  const existing = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(email)
    .first<User>();

  if (existing) {
    if (!googleUser.name) return ensureUserGamertag(c.env.DB, existing);
    // Update existing user
    await c.env.DB.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?")
      .bind(name, now, existing.id)
      .run();

    return ensureUserGamertag(c.env.DB, {
      ...existing,
      name,
      updated_at: now,
    });
  }

  // Create new user
  const userId = crypto.randomUUID();

  const gamertag = await generateAvailableGamertag(c.env.DB, defaultGamertagSeed());

  await c.env.DB.prepare(
    "INSERT INTO users (id, email, name, gamertag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(userId, email, name, gamertag, now, now)
    .run();

  return {
    id: userId,
    email,
    name,
    gamertag,
    gamertag_selected: 0,
    created_at: now,
    updated_at: now,
  };
}
