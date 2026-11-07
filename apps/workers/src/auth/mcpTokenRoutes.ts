/**
 * MCP personal access token management (PAT v1).
 *
 * Session-only by construction: a request that carries `Authorization` or an MCP
 * client id is refused, so a PAT can never mint or revoke tokens — otherwise one
 * leaked token could reproduce itself and outlive its own revocation.
 *
 * Writes additionally require a recently authenticated session and an allowed
 * web origin, the same bar as the other saved-credential endpoints.
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import type { Env, Variables } from "../types";
import { isAllowedWebOrigin } from "./webOrigins";
import { enforceRateLimit } from "./oauthSecurity";
import { requireRecentLogin } from "./session";
import {
  PAT_DEFAULT_DAYS,
  PAT_MAX_ACTIVE,
  PAT_MAX_DAYS,
  createPersonalToken,
  listPersonalTokens,
  revokePersonalToken,
} from "./mcpPersonalTokens";

export const mcpTokenRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const TOKEN_ID = /^[0-9a-f]{16}$/;

mcpTokenRoutes.onError((_error, c) => {
  c.header("Cache-Control", "no-store");

  return c.json({ error: "Could not complete the token request. Please try again." }, 503);
});

mcpTokenRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");

  // `mcpClientId` is set for any bearer-authenticated request: OAuth or PAT.
  if (!c.get("user") || !c.get("session") || c.get("mcpClientId") || c.req.header("Authorization"))
    return c.json({ error: "Sign in to manage MCP tokens." }, 401);

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

mcpTokenRoutes.use(
  "*",
  bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: "Request is too large." }, 413) }),
);

mcpTokenRoutes.get("/", async (c) => {
  const tokens = await listPersonalTokens(c.env.DB, c.get("user")!.id);

  return c.json({
    tokens,
    maxActive: PAT_MAX_ACTIVE,
    defaultDays: PAT_DEFAULT_DAYS,
    maxDays: PAT_MAX_DAYS,
  });
});

const createInput = z
  .object({
    name: z.string().trim().min(1).max(40),
    expiresInDays: z.number().int().min(1).max(PAT_MAX_DAYS).optional(),
  })
  .strict();

mcpTokenRoutes.post("/", requireRecentLogin, async (c) => {
  const user = c.get("user")!;

  if (await enforceRateLimit(c.env.DB, user.id, "mcp-token-create", 20, 3600))
    return c.json({ error: "Too many token changes. Try again later." }, 429);

  const parsed = createInput.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success)
    return c.json({ error: "Send a name of 1–40 characters and an optional expiry in days." }, 400);

  const created = await createPersonalToken(c.env.DB, c.env.ENCRYPTION_SECRET, user.id, parsed.data);

  if (!created.ok) return c.json({ code: created.code, error: created.message }, 400);

  // The only time the secret exists outside the client: it is not recoverable.
  return c.json({ token: created.token, record: created.record }, 201);
});

mcpTokenRoutes.delete("/:id", requireRecentLogin, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id").toLowerCase();

  if (!TOKEN_ID.test(id)) return c.json({ error: "Unknown token." }, 404);

  if (await enforceRateLimit(c.env.DB, user.id, "mcp-token-revoke", 40, 3600))
    return c.json({ error: "Too many token changes. Try again later." }, 429);

  const revoked = await revokePersonalToken(c.env.DB, user.id, id);

  if (!revoked) return c.json({ error: "Unknown token." }, 404);

  return c.json({ revoked: true, id });
});
