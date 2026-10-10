import { z } from "zod";
import { isNumber } from "@llmgames/game-catalog";

import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import type { Env, Variables, User } from "../types";
import { mcpResourceUrl, verifyMcpAccessToken } from "./mcpOAuth";
import { loadCurrentUser } from "./gamertags";
import { isAllowedWebOrigin } from "./webOrigins";

type AuthContext = Context<{ Bindings: Env; Variables: Variables }>;

const SESSION_DURATION = 7 * 24 * 60 * 60;

const RECENT_LOGIN_DURATION = 15 * 60;

type SessionPayload = {
  typ: "web_session";
  sub: string;
  sid: string;
  iat: number;
  exp: number;
};

const parseSessionPayload = z
  .object({
    typ: z.literal("web_session"),
    sub: z.string().min(1),
    sid: z.string().regex(/^[a-f0-9-]{36}$/),
    iat: z.number().refine(Number.isSafeInteger),
    exp: z.number().refine(Number.isSafeInteger),
  })
  .nullable()
  .catch(null).parse;

/** Only successful Google/email authentication creates a session. No sliding renewal. */
export async function createSession(c: AuthContext, user: User): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const payload: SessionPayload = {
    typ: "web_session",
    sub: user.id,
    sid: crypto.randomUUID(),
    iat: now,
    exp: now + SESSION_DURATION,
  };

  const token = await sign(payload, c.env.ENCRYPTION_SECRET, "HS256");
  await c.env.DB.prepare("DELETE FROM web_sessions WHERE expires_at <= ?").bind(now).run();
  await c.env.DB.prepare(
    "INSERT INTO web_sessions (id, user_id, authenticated_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(payload.sid, user.id, now, payload.exp)
    .run();

  return token;
}

function cookieName(secure: boolean) {
  return secure ? "__Host-session" : "session";
}

export function setSessionCookie(
  response: Response,
  token: string,
  opts?: { secure?: boolean },
): void {
  const secure = opts?.secure ?? true;
  response.headers.append(
    "Set-Cookie",
    `${cookieName(secure)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION}${secure ? "; Secure" : ""}`,
  );
}

export function clearSessionCookie(response: Response, opts?: { secure?: boolean }): void {
  const secure = opts?.secure ?? true;
  response.headers.append(
    "Set-Cookie",
    `${cookieName(secure)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
  );

  // Remove the obsolete production cookie too; it is never accepted on HTTPS.
  if (secure)
    response.headers.append(
      "Set-Cookie",
      "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    );
}

async function getSessionFromCookie(c: AuthContext): Promise<SessionPayload | null> {
  const url = new URL(c.req.url);
  const secure = url.protocol === "https:";

  if (!secure && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
  const name = cookieName(secure);

  // Reject duplicates instead of letting header order select the active account.
  const matches = (c.req.header("Cookie") ?? "")
    .split(";")
    .filter((part) => part.slice(0, part.indexOf("=")).trim() === name);

  if (matches.length !== 1) return null;
  const token = getCookie(c, name);

  if (!token) return null;
  let payload: SessionPayload | null;

  try {
    payload = parseSessionPayload(await verify(token, c.env.ENCRYPTION_SECRET, "HS256"));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    !payload ||
    payload.iat > now ||
    payload.exp <= now ||
    payload.exp - payload.iat !== SESSION_DURATION
  )
    return null;

  const row = await c.env.DB.prepare(
    "SELECT authenticated_at, expires_at FROM web_sessions WHERE id = ? AND user_id = ? AND expires_at > ?",
  )
    .bind(payload.sid, payload.sub, now)
    .first<{ authenticated_at: number; expires_at: number }>();

  if (!row || row.authenticated_at !== payload.iat || row.expires_at !== payload.exp) return null;

  return payload;
}

/** Revoke before clearing the browser. A DB failure must not report successful logout. */
export async function revokeBrowserSession(c: AuthContext, all = false): Promise<void> {
  const session = c.get("session");

  if (session?.id && !c.get("mcpClientId")) {
    await (
      all
        ? c.env.DB.prepare("DELETE FROM web_sessions WHERE user_id = ?").bind(session.userId)
        : c.env.DB.prepare("DELETE FROM web_sessions WHERE id = ? AND user_id = ?").bind(
            session.id,
            session.userId,
          )
    ).run();
  }

  c.set("user", null);
  c.set("session", null);
}

export function allowedBrowserWrite(c: AuthContext): boolean {
  return isAllowedWebOrigin(
    c.req.header("Origin"),
    [
      new URL(c.req.url).origin,
      c.env.FRONTEND_URL,
      ...(c.env.ALLOWED_ORIGINS ?? "").split(","),
    ].filter(Boolean),
  );
}

export function recentlyAuthenticated(c: AuthContext): boolean {
  const authenticatedAt = c.get("session")?.authenticatedAt;
  const now = Math.floor(Date.now() / 1000);

  return (
    isNumber(authenticatedAt) &&
    authenticatedAt <= now &&
    now - authenticatedAt <= RECENT_LOGIN_DURATION
  );
}

export const requireRecentLogin: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  if (!recentlyAuthenticated(c))
    return c.json(
      {
        code: "REAUTHENTICATION_REQUIRED",
        error: "Sign out and sign in again before changing saved credentials.",
      },
      403,
    );
  await next();
};

export const sessionMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (
  c,
  next,
) => {
  c.set("user", null);
  c.set("session", null);
  c.set("mcpClientId", null);

  try {
    const authorization = c.req.header("Authorization");

    if (authorization) {
      const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

      const payload = bearer
        ? await verifyMcpAccessToken(
            c.env.ENCRYPTION_SECRET,
            bearer,
            mcpResourceUrl(new URL(c.req.url).origin),
          )
        : null;

      if (payload) {
        const user = await loadCurrentUser(c.env.DB, payload.sub);

        if (user) {
          c.set("user", user);
          c.set("mcpClientId", payload.client_id);
          c.set("session", {
            userId: user.id,
            email: user.email,
            name: user.name,
            expiresAt: payload.exp,
          });
        }
      }
    } else {
      const payload = await getSessionFromCookie(c);

      if (payload) {
        const user = await loadCurrentUser(c.env.DB, payload.sub);

        if (user) {
          c.set("user", user);
          c.set("session", {
            id: payload.sid,
            authenticatedAt: payload.iat,
            userId: user.id,
            email: user.email,
            name: user.name,
            expiresAt: payload.exp,
          });
        }
      }
    }
  } catch {
    // A storage outage must not turn a revocation attempt into successful logout.
    return c.json({ error: "Authentication is temporarily unavailable. Please try again." }, 503);
  }

  await next();
};

/**
 * Hono middleware that enforces authentication.
 * Must be applied after {@link sessionMiddleware}.
 *
 * Rejects unauthenticated requests with a `401 Unauthorized` JSON response
 * and stops further middleware execution. Authenticated requests are passed through.
 */
export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (
  c,
  next,
) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};

/** Requires browser players to finish their one-time username onboarding. */
export const requireCompletedOnboarding: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const user = c.get("user");

  if (!user || user.gamertag_selected !== 1) {
    return c.json({ error: "Choose your username before playing" }, 403);
  }

  await next();
};
