import { requireRecentLogin } from "./session";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Env, Variables } from "../types";
import { credentialStorageReady, encryptJevKey } from "../agents/jevCredentials";
import { isAllowedWebOrigin } from "./webOrigins";
import { enforceRateLimit } from "./oauthSecurity";

export const jevCredentialRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

jevCredentialRoutes.onError((_error, c) => {
  c.header("Cache-Control", "no-store");

  return c.json({ error: "Could not complete the TypeSafe request. Please try again." }, 503);
});

jevCredentialRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");

  if (!c.get("user") || !c.get("session") || c.get("mcpClientId") || c.req.header("Authorization"))
    return c.json({ error: "Sign in to manage your TypeSafe connection." }, 401);

  if (c.req.method !== "GET") {
    const allowed = [
      new URL(c.req.url).origin,
      c.env.FRONTEND_URL,
      ...(c.env.ALLOWED_ORIGINS ?? "").split(","),
    ].filter(Boolean);

    if (!isAllowedWebOrigin(c.req.header("Origin"), allowed))
      return c.json({ error: "Request origin is not allowed." }, 403);
  }

  await next();
});

jevCredentialRoutes.use(
  "*",
  bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: "Request is too large." }, 413) }),
);

jevCredentialRoutes.get("/", async (c) => {
  const ownerId = c.get("user")!.id;

  const [row, usage, usedTrial] = await Promise.all([
    c.env.DB.prepare("SELECT verified_at, daily_limit FROM jev_credentials WHERE owner_id = ?")
      .bind(ownerId)
      .first<{ verified_at: number; daily_limit: number }>(),
    c.env.DB.prepare("SELECT calls FROM jev_personal_usage WHERE owner_id = ? AND day = ?")
      .bind(ownerId, new Date().toISOString().slice(0, 10))
      .first<{ calls: number }>(),
    c.env.DB.prepare("SELECT owner_id FROM jev_trial_games WHERE owner_id = ?")
      .bind(ownerId)
      .first<{ owner_id: string }>(),
  ]);

  return c.json({
    available: await credentialStorageReady(c.env),
    connected: Boolean(row),
    trialAvailable: !usedTrial,
    verifiedAt: row?.verified_at ?? null,
    dailyLimit: row?.daily_limit ?? 10000,
    callsToday: usage?.calls ?? 0,
  });
});

const input = z
  .object({
    apiKey: z
      .string()
      .trim()
      .min(10)
      .max(512)
      .regex(/^[\x21-\x7e]+$/),
    dailyLimit: z.number().int().min(1).max(100000),
    consent: z.literal(true),
  })
  .strict();

jevCredentialRoutes.put("/", requireRecentLogin, async (c) => {
  if (!(await credentialStorageReady(c.env)))
    return c.json({ error: "TypeSafe connections are not available yet." }, 503);
  const parsed = input.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success)
    return c.json(
      {
        error:
          "Enter a valid API key, a daily limit from 1 to 100,000, and accept the billing notice.",
      },
      400,
    );
  const ownerId = c.get("user")!.id;

  if (await enforceRateLimit(c.env.DB, ownerId, "jev-key-validation", 10, 3600))
    return c.json({ error: "Too many attempts. Try again in an hour." }, 429);
  let response: Response;

  // Workers supports only follow/manual; manual keeps credentials off redirect targets.
  try {
    response = await fetch("https://api.typesafe.ai/v1/models", {
      headers: { Authorization: `Bearer ${parsed.data.apiKey}` },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return c.json(
      { error: "TypeSafe could not be reached. Your saved connection has not changed." },
      502,
    );
  }

  await response.body?.cancel();

  if (!response.ok)
    return c.json(
      {
        error:
          response.status === 401 || response.status === 403
            ? "TypeSafe did not accept this API key."
            : "TypeSafe could not verify the key right now. Try again later.",
      },
      400,
    );
  const id = crypto.randomUUID();
  const encrypted = await encryptJevKey(c.env, ownerId, id, parsed.data.apiKey);
  const verifiedAt = Date.now();
  await c.env.DB.prepare(`INSERT INTO jev_credentials (owner_id,id,ciphertext,nonce,key_version,verified_at,daily_limit) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(owner_id) DO UPDATE SET id=excluded.id,ciphertext=excluded.ciphertext,nonce=excluded.nonce,key_version=excluded.key_version,verified_at=excluded.verified_at,daily_limit=excluded.daily_limit`)
    .bind(
      ownerId,
      id,
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.key_version,
      verifiedAt,
      parsed.data.dailyLimit,
    )
    .run();

  return c.json({ connected: true, verifiedAt });
});

jevCredentialRoutes.delete("/", requireRecentLogin, async (c) => {
  await c.env.DB.prepare("DELETE FROM jev_credentials WHERE owner_id = ?")
    .bind(c.get("user")!.id)
    .run();

  return c.json({ connected: false });
});
