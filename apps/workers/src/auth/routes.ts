import { isBoolean, isString } from "@llmgames/game-catalog";

import { refreshFeaturedVods } from "../lib/featuredGames";
import { jevCredentialRoutes } from "./jevCredentials";
import { agentWebhookRoutes } from "./agentWebhooks";
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { googleAuth, googleCallback, logout, startGoogleOAuth } from "./google";
import { requestEmailCode, verifyEmailCode, emailRequestGuard } from "./email";
import { verifyTurnstile } from "./turnstile";
import { enforceRateLimit } from "./oauthSecurity";
import { selectInitialGamertag } from "./gamertags";
import {
  deleteAllOwnedMcpAgentSeats,
  deleteOwnedMcpAgentSeatByCodename,
  listManagedMcpAgentSeats,
} from "./mcpAgentSeats";
import { getOwnedAgentGameLogKey, listOwnedAgentGameLogs } from "./gameLogs";

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

authRoutes.route("/users/me/typesafe", jevCredentialRoutes);

authRoutes.route("/users/me/agent-webhooks", agentWebhookRoutes);

authRoutes.post("/email/request", emailRequestGuard, verifyTurnstile, requestEmailCode);

authRoutes.post("/email/verify", emailRequestGuard, verifyEmailCode);

// Google OAuth initiation (web app JSON flow)
// In development, Turnstile is optional (checked inside middleware)
authRoutes.post("/oauth/google", verifyTurnstile, googleAuth);

// Browser start (MCP OAuth / deep links) — no Turnstile; return_to must be same-origin path
authRoutes.get("/oauth/google/start", async (c) => {
  const limited = await enforceRateLimit(
    c.env.DB,
    c.req.header("CF-Connecting-IP"),
    "google-oauth-start",
    60,
    3600,
  );

  if (limited) return limited;
  const returnTo = c.req.query("return_to") || c.req.query("returnTo") || undefined;

  return startGoogleOAuth(c, { returnTo, mode: "redirect" });
});

// Google OAuth callback (no Turnstile needed - comes from Google)
authRoutes.get("/oauth/google/callback", async (c) => {
  const limited = await enforceRateLimit(
    c.env.DB,
    c.req.header("CF-Connecting-IP"),
    "google-oauth-callback",
    120,
    3600,
  );

  if (limited) return limited;

  return googleCallback(c);
});

// Session management
authRoutes.post("/sessions/logout", logout);

authRoutes.post("/sessions/logout-all", logout);

// Get current user
authRoutes.get("/users/me", (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ user: null }, 200);
  }

  return c.json({ user });
});

// Stored MCP identities for the signed-in owner's management page.
// The browser gets the public codename, never the private agentId.
authRoutes.get("/users/me/agents", async (c) => {
  const current = c.get("user");

  if (!current) return c.json({ error: "Authentication required" }, 401);
  const seats = await listManagedMcpAgentSeats(c.env.DB, current.id);

  return c.json({
    agents: seats.map((seat) => ({
      codename: seat.codename,
      environmentLabel: seat.environmentLabel,
      createdAt: seat.createdAt,
      lastUsedAt: seat.lastUsedAt,
      hasRoomHistory: seat.hasRoomHistory,
      isActive: seat.isActive,
    })),
  });
});

authRoutes.delete("/users/me/agents", async (c) => {
  const current = c.get("user");

  if (!current) return c.json({ error: "Authentication required" }, 401);
  const result = await deleteAllOwnedMcpAgentSeats(c.env.DB, current.id);

  return c.json({
    deleted: true,
    ...result,
    message:
      result.preservedActiveCount > 0
        ? `Deleted ${result.deletedCount} identities. Kept ${result.preservedActiveCount} in live rooms.`
        : `Deleted ${result.deletedCount} identities.`,
  });
});

authRoutes.delete("/users/me/agents/:codename", async (c) => {
  const current = c.get("user");

  if (!current) return c.json({ error: "Authentication required" }, 401);
  const codename = c.req.param("codename");

  if (!/^[A-Za-z0-9]{3,80}$/.test(codename)) {
    return c.json({ error: "Invalid agent identity" }, 400);
  }

  const result = await deleteOwnedMcpAgentSeatByCodename(c.env.DB, current.id, codename);

  if (result.deleted) {
    return c.json({
      deleted: true,
      codename: result.seat.codename,
      message: "Agent identity deleted. This cannot be undone.",
    });
  }

  if (result.reason === "active_room") {
    return c.json(
      {
        error: "This agent identity is in a live room and cannot be deleted yet.",
        code: "MCP_AGENT_ALREADY_ACTIVE",
      },
      409,
    );
  }

  return c.json({ error: "Agent identity not found" }, 404);
});

// Completed games involving the signed-in player or one of their MCP agents.
authRoutes.get("/users/me/game-logs", async (c) => {
  const current = c.get("user");

  if (!current) return c.json({ error: "Authentication required" }, 401);
  const rawLimit = Number(c.req.query("limit") ?? 20);
  const rawBefore = c.req.query("before");

  let { games, nextCursor } = await listOwnedAgentGameLogs(c.env.DB, current.id, {
    limit: Number.isFinite(rawLimit) ? rawLimit : 20,
    before: rawBefore ?? undefined,
  });

  if (c.env.TWITCH_CLIENT_ID && games.some((game) => game.featured && !game.featured.recording)) {
    try {
      const resolved = await refreshFeaturedVods(
        c.env,
        games.map((game) => game.id),
      );

      if (resolved.size) {
        // Read the saved offsets and URLs into this response, not the next visit.
        ({ games, nextCursor } = await listOwnedAgentGameLogs(c.env.DB, current.id, {
          limit: Number.isFinite(rawLimit) ? rawLimit : 20,
          before: rawBefore ?? undefined,
        }));
      }
    } catch {
      console.error("Could not refresh stream recordings");
    }
  }

  return c.json({ games, nextCursor });
});

// The browser receives the stored gzip stream; fetch transparently decodes it.
authRoutes.get("/users/me/game-logs/:gameId", async (c) => {
  const current = c.get("user");

  if (!current) return c.json({ error: "Authentication required" }, 401);
  const gameId = c.req.param("gameId");
  const key = await getOwnedAgentGameLogKey(c.env.DB, current.id, gameId);

  if (!key) return c.json({ error: "Game log not found" }, 404);
  const object = await c.env.GAME_LOGS.get(key);

  if (!object) return c.json({ error: "Game log is unavailable" }, 404);

  const headers = new Headers({
    "Cache-Control": "private, max-age=300",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Encoding": "gzip",
    ETag: object.httpEtag,
  });

  return new Response(object.body, { headers, encodeBody: "manual" });
});

authRoutes.post("/users/me/onboarding", async (c) => {
  const current = c.get("user");

  if (!current) return c.json({ error: "Authentication required" }, 401);

  const body = await c.req
    .json<{ username?: unknown; broadcastAllowed?: unknown }>()
    .catch(() => null);

  if (!body || !isString(body.username)) {
    return c.json({ error: "Username must be a string" }, 400);
  }

  if (body.broadcastAllowed !== undefined && !isBoolean(body.broadcastAllowed))
    return c.json({ error: "Broadcast permission must be a boolean" }, 400);

  try {
    const user = await selectInitialGamertag(c.env.DB, current, body.username, false);

    return c.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save username";
    const status = message.includes("already") || message.includes("taken") ? 409 : 400;

    return c.json({ error: message }, status);
  }
});

authRoutes.patch("/users/me/broadcast", async (c) => {
  const current = c.get("user");

  if (!current) return c.json({ error: "Authentication required" }, 401);
  const body = await c.req.json<{ allowed?: unknown }>().catch(() => null);

  if (!isBoolean(body?.allowed))
    return c.json({ error: "Broadcast permission must be a boolean" }, 400);
  await c.env.DB.prepare(
    "UPDATE users SET broadcast_allowed = ?, updated_at = unixepoch() WHERE id = ?",
  )
    .bind(0, current.id)
    .run();

  return c.json({ user: { ...current, broadcast_allowed: 0 } });
});
