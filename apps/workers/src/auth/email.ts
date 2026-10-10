import { z } from "zod";
import { isString } from "@llmgames/game-catalog";

import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Env, Variables } from "../types";
import {
  browserLoginDestination,
  loginReturnDestination,
  sanitizeReturnTo,
  upsertUser,
} from "./google";
import { createSession, setSessionCookie } from "./session";
import { enforceRateLimit } from "./oauthSecurity";
import { isAllowedWebOrigin } from "./webOrigins";

type AuthContext = Context<{ Bindings: Env; Variables: Variables }>;

const TTL = 10 * 60;

const encoder = new TextEncoder();

function rateLimitResponse(c: AuthContext, limited: Response) {
  c.header("Retry-After", limited.headers.get("Retry-After") || "60");

  return c.json({ error: "Too many attempts. Please wait before trying again." }, 429);
}

export function startBrowserLogin(c: AuthContext, opts: { returnTo: string }) {
  const url = new URL("/login", c.env.FRONTEND_URL || "http://localhost:3000");
  url.searchParams.set("return_to", opts.returnTo);

  return c.redirect(url.toString(), 303);
}

async function digest(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function signInCodeEmail(code: string, frontendUrl = "http://localhost:3000") {
  const logo = `${new URL(frontendUrl).origin}/llmgames-apple-touch-v3.png`;
  const text = `${code} is your llmgames code.\n\nEnter it in the browser where you asked to sign in. It expires in 10 minutes.\n\nIf you did not request this, ignore the email. Never share the code.`;

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4f1ea;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:100%;max-width:480px;background:#fffdf6;border:2px solid #25262a;border-radius:12px;">
          <tr>
            <td style="padding:28px 28px 4px;font:700 22px/1.2 Georgia,'Times New Roman',serif;color:#25262a;">
              <img src="${logo}" width="28" height="28" alt="" style="display:inline-block;vertical-align:middle;margin-right:8px;border-radius:6px;">
              <span style="vertical-align:middle;">llmgames</span>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px 0;font:16px/1.5 Georgia,'Times New Roman',serif;color:#25262a;">
              Use this code to sign in. It expires in 10 minutes.
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#ffd43b;border:2px solid #25262a;border-radius:10px;padding:16px 22px;font:700 36px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:0.22em;color:#25262a;">
                    ${code}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;font:13px/1.55 Georgia,'Times New Roman',serif;color:#6a6b72;">
              If you did not request this, ignore the email. Never share the code.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject: `${code} is your llmgames code`, text, html };
}

function cookie(c: AuthContext, id: string, value: string, maxAge = TTL): string {
  return `email_login_${id}=${value}; Path=/api/v1/auth/email; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(c.req.url).protocol === "https:" ? "; Secure" : ""}`;
}

export const emailRequestGuard: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (
  c,
  next,
) => {
  c.header("Cache-Control", "no-store");
  const origin = c.req.header("Origin");

  const allowed = [
    new URL(c.req.url).origin,
    new URL(c.env.FRONTEND_URL || "http://localhost:3000").origin,
  ];

  if (!isAllowedWebOrigin(origin, allowed)) return c.json({ error: "Invalid request origin" }, 403);

  if (!c.req.header("Content-Type")?.startsWith("application/json"))
    return c.json({ error: "Expected JSON" }, 415);

  if ((await c.req.text()).length > 4096) return c.json({ error: "Request too large" }, 413);

  try {
    await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const limited = await enforceRateLimit(
    c.env.DB,
    c.req.header("CF-Connecting-IP"),
    `email-${c.req.path.endsWith("/verify") ? "verify" : "request"}`,
    c.req.path.endsWith("/verify") ? 60 : 20,
    3600,
  );

  if (limited) return rateLimitResponse(c, limited);
  await next();
};

export async function requestEmailCode(c: AuthContext) {
  if (!c.env.EMAIL || !c.env.EMAIL_FROM)
    return c.json({ error: "Email sign-in is not available yet. Please use Google." }, 503);
  const body = await c.req.json<{ email?: unknown; returnTo?: unknown }>();
  const email = isString(body?.email) ? body.email.trim().toLowerCase() : "";

  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
    return c.json({ error: "Enter a valid email address" }, 400);
  const emailKey = await digest(c.env.ENCRYPTION_SECRET, `email:${email}`);

  for (const [bucket, limit, window] of [
    ["email-cooldown", 1, 60],
    ["email-hour", 5, 3600],
  ] as const) {
    const limited = await enforceRateLimit(c.env.DB, emailKey, bucket, limit, window);

    if (limited) return rateLimitResponse(c, limited);
  }

  const id = crypto.randomUUID();
  const browser = crypto.randomUUID();
  // Rejection sampling avoids modulo bias in the six-digit code.
  const random = new Uint32Array(1);
  let value = 0;

  do {
    crypto.getRandomValues(random);
    value = random[0] ?? 0;
  } while (value >= 4294000000);

  const code = String(value % 1000000).padStart(6, "0");
  const codeHash = await digest(c.env.ENCRYPTION_SECRET, `code:${id}:${code}`);
  const browserHash = await digest(c.env.ENCRYPTION_SECRET, `browser:${browser}`);
  const now = Math.floor(Date.now() / 1000);

  const returnTo = sanitizeReturnTo(
    isString(body.returnTo) ? body.returnTo : null,
    new URL(c.req.url).origin,
  );

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM email_login_codes WHERE expires_at < ?").bind(now),
    c.env.DB.prepare(
      "INSERT INTO email_login_codes (id, email, code_hash, browser_hash, return_to, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id, email, codeHash, browserHash, returnTo, now + TTL),
  ]);

  try {
    const message = signInCodeEmail(code, c.env.FRONTEND_URL);
    await c.env.EMAIL.send({
      from: c.env.EMAIL_FROM,
      to: email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } catch {
    await c.env.DB.prepare("DELETE FROM email_login_codes WHERE id = ?").bind(id).run();

    return c.json({ error: "Unable to send a code. Please try again in a minute." }, 502);
  }

  const response = c.json({ challengeId: id, expiresIn: TTL, resendAfter: 60 });
  response.headers.append("Set-Cookie", cookie(c, id, browser));

  return response;
}

export async function verifyEmailCode(c: AuthContext) {
  const body = await c.req.json<{ challengeId?: unknown; code?: unknown }>();
  const id = isString(body?.challengeId) ? body.challengeId : "";
  const code = isString(body?.code) ? body.code.trim() : "";

  if (!/^[a-f0-9-]{36}$/.test(id) || !/^\d{6}$/.test(code))
    return c.json({ error: "Enter the six-digit code from your email" }, 400);
  const browser = getCookie(c, `email_login_${id}`);

  if (!browser) return c.json({ error: "Request a new code in this browser" }, 400);
  const browserHash = await digest(c.env.ENCRYPTION_SECRET, `browser:${browser}`);
  const codeHash = await digest(c.env.ENCRYPTION_SECRET, `code:${id}:${code}`);
  const now = Math.floor(Date.now() / 1000);

  // D1 batches are transactions: increment attempts and consume once atomically.
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE email_login_codes SET attempts = attempts + 1 WHERE id = ? AND browser_hash = ? AND expires_at > ? AND attempts <= 5",
    ).bind(id, browserHash, now),
    c.env.DB.prepare(
      "DELETE FROM email_login_codes WHERE id = ? AND browser_hash = ? AND code_hash = ? AND expires_at > ? AND attempts <= 5 RETURNING email, return_to",
    ).bind(id, browserHash, codeHash, now),
  ]);

  const row = z
    .object({ email: z.string(), return_to: z.string().nullable() })
    .optional()
    .parse(results[1]?.results[0]);

  if (!row)
    return c.json(
      { error: "Code is incorrect or expired. After five attempts, request a new code." },
      400,
    );
  const user = await upsertUser(c, { email: row.email, verified_email: true });
  const session = await createSession(c, user);
  const origin = new URL(c.req.url).origin;
  const returnTo = sanitizeReturnTo(row.return_to, origin);
  const frontendUrl = c.env.FRONTEND_URL || "http://localhost:3000";

  const response = c.json({
    redirectUrl: returnTo
      ? loginReturnDestination(returnTo, origin, frontendUrl)
      : browserLoginDestination(frontendUrl, user),
  });

  setSessionCookie(response, session, { secure: new URL(c.req.url).protocol === "https:" });
  response.headers.append("Set-Cookie", cookie(c, id, "", 0));

  return response;
}
