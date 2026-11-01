import { Hono } from "hono";
import { z } from "zod";
import {
  isGameEnabled,
  jsonValueSchema,
  resolveGameOptions,
  ROOM_LIFETIME_MS,
} from "@llmgames/game-catalog";

import type { Env } from "../types";
import {
  generateSecureRoomCode,
  getRoomNamespace,
  normalizeGameType,
  roomIdFor,
} from "../lib/roomRouting";
import { activateRoomCode, releaseRoomCode, reserveRoomCode } from "../lib/activeRooms";
import { SANDBOX_MAX_SEATS, SANDBOX_SEAT_NAMES, sandboxEnabled, sandboxSeatId } from "../lib/sandbox";

/**
 * Live Sandbox HTTP surface (C3).
 *
 * Runs real rooms and real rules: the page creates a room, then reads the
 * server's own projection for whichever seat it is inspecting. Nothing here
 * re-implements a game.
 *
 * The whole router answers 404 unless {@link sandboxEnabled} holds, which
 * requires a non-production deployment that explicitly opted in. Production
 * defines neither variable, so these routes do not exist there.
 */
export const sandboxRoutes = new Hono<{ Bindings: Env }>();

sandboxRoutes.use("*", async (c, next) => {
  if (!sandboxEnabled(c.env)) return c.notFound();

  await next();
});

const createSchema = z
  .object({
    gameType: z.string().min(1).max(40),
    players: z.number().int().min(2).max(SANDBOX_MAX_SEATS).optional(),
    options: z.record(z.string().max(40), z.string().max(20)).optional(),
  })
  .strict();

const actionSchema = z
  .object({
    roomId: z.string().min(9).max(64),
    playerId: z.string().min(1).max(128),
    actionType: z.string().min(1).max(64),
    data: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

/** Room id (`go-ABC234`) → namespace lookup. */
function roomTarget(env: Env, roomId: string) {
  const match = roomId.match(/^(.+)-([A-HJ-NP-Z2-9]{6})$/i);

  if (!match) return null;

  const gameType = normalizeGameType(match[1]!);

  if (!gameType || !isGameEnabled(gameType)) return null;

  const namespace = getRoomNamespace(env, gameType);

  return { gameType, namespace, stub: namespace.get(namespace.idFromName(roomId)) };
}

sandboxRoutes.post("/rooms", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) return c.json({ error: "Invalid sandbox room request" }, 400);

  const gameType = normalizeGameType(parsed.data.gameType);

  if (!gameType) return c.json({ error: "Unsupported game type" }, 400);

  if (!isGameEnabled(gameType)) return c.json({ error: "Game type is unavailable" }, 404);

  const options = resolveGameOptions(gameType, parsed.data.options);

  if (!options.ok) return c.json({ error: options.error }, 400);

  const seats = Array.from({ length: parsed.data.players ?? 2 }, (_, index) => ({
    id: sandboxSeatId(index),
    name: SANDBOX_SEAT_NAMES[index] ?? `Sandbox ${index + 1}`,
  }));

  for (let attempt = 0; attempt < 5; attempt++) {
    const roomCode = generateSecureRoomCode();
    const roomId = roomIdFor(gameType, roomCode);

    const reservation = await reserveRoomCode(c.env.DB, gameType, roomCode, Date.now() + ROOM_LIFETIME_MS);

    if (!reservation) continue;

    const namespace = getRoomNamespace(c.env, gameType);
    const stub = namespace.get(namespace.idFromName(roomId));

    const created = await stub.fetch("https://do.internal/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: seats[0]!.id,
        hostName: seats[0]!.name,
        gameType,
        maxPlayers: seats.length,
        gameTotalTime: 30 * 60_000,
        turnTime: 120_000,
        roomCode,
        options: options.options,
        sandbox: true,
      }),
    });

    if (!created.ok) {
      await releaseRoomCode(c.env.DB, roomCode, roomId);

      return c.json({ error: "Sandbox room creation failed" }, 500);
    }

    const seeded = await stub.fetch("https://do.internal/sandbox/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seats,
        // A real spectator seat, so the page can show the watcher's own
        // projection instead of pretending by hiding panels.
        spectators: [{ id: "sandbox-spectator", name: "Watcher" }],
      }),
    });

    if (!seeded.ok) {
      await releaseRoomCode(c.env.DB, roomCode, roomId);

      return c.json({ error: "Sandbox seats could not be assigned" }, 500);
    }

    const body = await created.json<{ expiresAt?: number }>();

    await activateRoomCode(c.env.DB, roomCode, roomId, body.expiresAt ?? reservation.expiresAt);

    return c.json({ roomId, roomCode, gameType, options: options.options, seats });
  }

  return c.json({ error: "Could not allocate a room code" }, 503);
});

sandboxRoutes.get("/view", async (c) => {
  const roomId = c.req.query("roomId");
  const playerId = c.req.query("playerId");

  if (!roomId || !playerId) return c.json({ error: "roomId and playerId required" }, 400);
  const target = roomTarget(c.env, roomId);

  if (!target) return c.json({ error: "Unknown room" }, 404);

  const response = await target.stub.fetch(
    `https://do.internal/sandbox/view?playerId=${encodeURIComponent(playerId)}`,
  );

  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});

sandboxRoutes.get("/events", async (c) => {
  const roomId = c.req.query("roomId");

  if (!roomId) return c.json({ error: "roomId required" }, 400);
  const target = roomTarget(c.env, roomId);

  if (!target) return c.json({ error: "Unknown room" }, 404);

  const response = await target.stub.fetch("https://do.internal/sandbox/events");

  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});

sandboxRoutes.post("/action", async (c) => {
  const parsed = actionSchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) return c.json({ error: "Invalid sandbox action" }, 400);

  const target = roomTarget(c.env, parsed.data.roomId);

  if (!target) return c.json({ error: "Unknown room" }, 404);

  // The room decides, not this router: `/sandbox/action` answers only on a
  // sandbox room in a sandbox deployment, so a real room cannot be driven
  // through the debug API even if its roomId and a member's playerId leak.
  const response = await target.stub.fetch("https://do.internal/sandbox/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId: parsed.data.playerId,
      actionType: parsed.data.actionType,
      data: parsed.data.data ?? {},
    }),
  });

  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});
