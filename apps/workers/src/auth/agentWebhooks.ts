import { requireRecentLogin } from "./session";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { gameRouteSlug } from "@llmgames/game-catalog";
import type { Env, Variables } from "../types";
import { credentialStorageReady } from "../agents/jevCredentials";
import {
  decryptWebhook,
  encryptWebhook,
  webhookInput,
  webhookMetadata,
  webhookUrl,
  type WebhookRow,
} from "../agents/webhooks";
import { isAllowedWebOrigin } from "./webOrigins";
import { enforceRateLimit } from "./oauthSecurity";
import { resolveRoomCode } from "../lib/activeRooms";
import { getRoomNamespace, ROOM_CODE_PATTERN } from "../lib/roomRouting";

export const agentWebhookRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

agentWebhookRoutes.onError((_error, c) => {
  c.header("Cache-Control", "no-store");

  return c.json({ error: "Could not complete the webhook request. Please try again." }, 503);
});

agentWebhookRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");

  if (!c.get("user") || !c.get("session") || c.get("mcpClientId") || c.req.header("Authorization"))
    return c.json({ error: "Sign in to manage agent webhooks." }, 401);

  if (c.req.method !== "GET") {
    const allowed = [
      new URL(c.req.url).origin,
      c.env.FRONTEND_URL,
      ...(c.env.ALLOWED_ORIGINS ?? "").split(","),
    ].filter(Boolean);

    if (!isAllowedWebOrigin(c.req.header("Origin"), allowed))
      return c.json({ error: "Request origin is not allowed." }, 403);
  }

  // Never log fetch exceptions, URLs, credentials or provider response bodies.
  await next();
});

agentWebhookRoutes.use(
  "*",
  bodyLimit({ maxSize: 8192, onError: (c) => c.json({ error: "Request is too large." }, 413) }),
);

agentWebhookRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM agent_webhooks WHERE owner_id = ? ORDER BY created_at, id",
  )
    .bind(c.get("user")!.id)
    .all<WebhookRow>();

  return c.json({
    available: await credentialStorageReady(c.env),
    webhooks: rows.results.map(webhookMetadata),
  });
});

agentWebhookRoutes.on(["POST", "PUT"], ["/", "/:id"], requireRecentLogin, async (c) => {
  const id = c.req.param("id");

  if ((c.req.method === "PUT") !== Boolean(id))
    return c.json({ error: "Invalid webhook operation." }, 400);

  if (!(await credentialStorageReady(c.env)))
    return c.json({ error: "Webhook storage is temporarily unavailable." }, 503);
  const parsed = webhookInput.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success)
    return c.json(
      { error: "Enter a name, a public HTTPS URL, and a valid authentication header." },
      400,
    );
  const owner = c.get("user")!.id;

  if (await enforceRateLimit(c.env.DB, owner, "webhook-save", 60, 3600))
    return c.json({ error: "Too many changes. Try again later." }, 429);

  const old = id
    ? await c.env.DB.prepare("SELECT * FROM agent_webhooks WHERE id = ? AND owner_id = ?")
        .bind(id, owner)
        .first<WebhookRow>()
    : null;

  if (id && !old) return c.json({ error: "Webhook not found." }, 404);
  const previous = old ? await decryptWebhook(c.env, old) : null;
  const url = parsed.data.url ?? previous?.url;

  if (!url) return c.json({ error: "Enter a public HTTPS webhook URL." }, 400);

  // A different path on the same provider may belong to another customer.
  // Header changes must not silently transfer a secret to a different auth scheme either.
  if (
    previous &&
    parsed.data.headerValue === undefined &&
    (url !== previous.url ||
      parsed.data.headerName.toLowerCase() !== old!.header_name.toLowerCase())
  ) {
    return c.json(
      {
        error:
          "Enter a new authentication value or choose to send without authentication when changing the URL or header name.",
      },
      400,
    );
  }

  const nextId = id ?? crypto.randomUUID();

  const encrypted = await encryptWebhook(c.env, owner, nextId, {
    url,
    headerValue: parsed.data.headerValue ?? previous?.headerValue ?? "",
  });

  const host = new URL(url).hostname;

  if (old) {
    await c.env.DB.prepare(
      "UPDATE agent_webhooks SET name = ?, hostname = ?, header_name = ?, ciphertext = ?, nonce = ?, key_version = ? WHERE id = ? AND owner_id = ?",
    )
      .bind(
        parsed.data.name,
        host,
        parsed.data.headerName,
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.key_version,
        nextId,
        owner,
      )
      .run();
  } else {
    const inserted =
      await c.env.DB.prepare(`INSERT INTO agent_webhooks (id, owner_id, name, hostname, header_name, ciphertext, nonce, key_version, created_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM agent_webhooks WHERE owner_id = ?) < 10 RETURNING id`)
        .bind(
          nextId,
          owner,
          parsed.data.name,
          host,
          parsed.data.headerName,
          encrypted.ciphertext,
          encrypted.nonce,
          encrypted.key_version,
          Date.now(),
          owner,
        )
        .first();

    if (!inserted)
      return c.json({ error: "You can save up to 10 webhooks. Remove one to add another." }, 409);
  }

  return c.json({ id: nextId });
});

agentWebhookRoutes.delete("/:id", requireRecentLogin, async (c) => {
  await c.env.DB.prepare("DELETE FROM agent_webhooks WHERE id = ? AND owner_id = ?")
    .bind(c.req.param("id"), c.get("user")!.id)
    .run();

  return c.json({ ok: true });
});

const inviteInput = z
  .object({ roomCode: z.string().toUpperCase().regex(ROOM_CODE_PATTERN) })
  .strict();

agentWebhookRoutes.post("/:id/invite", async (c) => {
  const parsed = inviteInput.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) return c.json({ error: "A valid room code is required." }, 400);
  const owner = c.get("user")!.id;

  const row = await c.env.DB.prepare("SELECT * FROM agent_webhooks WHERE id = ? AND owner_id = ?")
    .bind(c.req.param("id"), owner)
    .first<WebhookRow>();

  if (!row) return c.json({ error: "Webhook not found." }, 404);
  const room = await resolveRoomCode(c.env.DB, parsed.data.roomCode);

  if (!room) return c.json({ error: "Room not found or expired." }, 404);
  const ns = getRoomNamespace(c.env, room.gameType);

  const check = await ns
    .get(ns.idFromName(room.roomId))
    .fetch("https://do.internal/webhook-invite-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: owner }),
    });

  await check.body?.cancel();

  if (!check.ok)
    return c.json(
      { error: "Only the host can invite agents to a waiting room with an open seat." },
      409,
    );

  if (await enforceRateLimit(c.env.DB, owner, "webhook-invite", 30, 3600))
    return c.json({ error: "Invite limit reached. Try again later." }, 429);
  const secret = await decryptWebhook(c.env, row);
  const url = webhookUrl(secret.url);

  if (!url) return c.json({ error: "Replace this webhook with a public HTTPS URL." }, 400);
  const attempt = Date.now();

  const reserved =
    await c.env.DB.prepare(`UPDATE agent_webhooks SET last_attempt_at = ?, last_delivery = 'sending'
    WHERE id = ? AND owner_id = ? AND (last_attempt_at IS NULL OR last_attempt_at <= ?) RETURNING id`)
      .bind(attempt, row.id, owner, attempt - 60000)
      .first();

  if (!reserved)
    return c.json(
      { error: "An invite was recently sent. Wait a minute before sending another." },
      429,
    );
  const origin = (c.env.FRONTEND_URL || new URL(c.req.url).origin).replace(/\/$/, "");
  const eventId = crypto.randomUUID();

  const payload = {
    event: "llmgames.invite",
    version: 1,
    eventId,
    action: "join",
    roomCode: room.roomCode,
    gameType: room.gameType,
    joinUrl: `${origin}/${gameRouteSlug(room.gameType)}?roomCode=${room.roomCode}`,
    mcpUrl: `${origin}/api/v1/mcp`,
    expiresAt: room.expiresAt,
    notes:
      "Join this room through the connected LLM Games MCP. Discover tools, claim your own task controller, and play to completion. Stay silent during play and report the final result. If already playing another match, report that you are busy. If authentication fails, report the blocker.",
  };

  let delivery: "delivered" | "failed" | "unknown" = "unknown";

  try {
    const headers = new Headers({ "Content-Type": "application/json" });

    if (secret.headerValue) headers.set(row.header_name, secret.headerValue);

    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers,
      body: JSON.stringify(payload),
    });

    delivery = response.ok ? "delivered" : "failed";
    await response.body?.cancel();
  } catch {
    /* A timeout may happen after the receiver accepted the invite. Never retry automatically. */
  }

  await c.env.DB.prepare(
    "UPDATE agent_webhooks SET last_delivery = ? WHERE id = ? AND owner_id = ? AND last_attempt_at = ?",
  )
    .bind(delivery, row.id, owner, attempt)
    .run();

  if (delivery !== "delivered")
    return c.json(
      {
        error:
          delivery === "unknown"
            ? "Delivery could not be confirmed. Check your agent before sending another invite."
            : "The webhook rejected the invite. Check its URL and authentication header in Profile.",
      },
      502,
    );

  return c.json({ delivered: true, eventId });
});
