import { Hono } from "hono";
import { z } from "zod";
import {
  gameRouteSlug,
  isGameEnabled,
  ROOM_LIFETIME_MS,
  TURN_TIME_MAX_MS,
  TURN_TIME_MIN_MS,
} from "@llmgames/game-catalog";
import type { Env, Variables } from "../types";
import {
  generateSecureRoomCode,
  getRoomNamespace,
  normalizeGameType,
  roomIdFor,
  ROOM_CODE_PATTERN,
} from "../lib/roomRouting";
import {
  activateRoomCode,
  releaseRoomCode,
  reserveRoomCode,
  resolveRoomCode,
} from "../lib/activeRooms";

export const roomsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const createSchema = z
  .object({
    gameType: z.string().min(1).max(40),
    maxPlayers: z.number().int().min(1).max(8).optional(),
    gameTotalTime: z.number().int().min(60_000).max(ROOM_LIFETIME_MS).optional(),
    turnTime: z.number().int().min(TURN_TIME_MIN_MS).max(TURN_TIME_MAX_MS).optional(),
    minBet: z.number().int().positive().max(1_000_000).optional(),
    maxBet: z.number().int().positive().max(10_000_000).optional(),
    startingChips: z.number().int().positive().max(100_000_000).optional(),
    fixedBet: z.number().int().positive().max(1_000_000).optional(),
  })
  .strict();

const joinSchema = z
  .object({
    roomCode: z
      .string()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(ROOM_CODE_PATTERN)),
    gameType: z.string().min(1).max(40).optional(),
  })
  .strict();

type PublicRoomState = {
  roomCode: string;
  status: string;
  players?: Array<{ id: string; name?: string }>;
  spectators?: Array<{ id: string; name?: string }>;
  maxPlayers?: number;
  expiresAt?: number;
};

function roomResponse(state: PublicRoomState, gameType: string, frontendUrl: string) {
  const playerCount = state.players?.length ?? 0;
  const maxPlayers = state.maxPlayers ?? 2;
  const canJoinAsPlayer = state.status === "waiting" && playerCount < maxPlayers;

  return {
    roomCode: state.roomCode,
    gameStatus: state.status,
    playerCount,
    maxPlayers,
    spectatorCount: state.spectators?.length ?? 0,
    expiresAt: state.expiresAt,
    canJoinAsPlayer,
    canSpectate: !canJoinAsPlayer,
    joinMode: canJoinAsPlayer ? "player" : "spectator",
    joinUrl: `${frontendUrl.replace(/\/$/, "")}/${gameRouteSlug(gameType)}?roomCode=${state.roomCode}`,
  };
}

roomsRoutes.post("/create", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) return c.json({ error: "Invalid room configuration" }, 400);
  const gameType = normalizeGameType(parsed.data.gameType);

  if (!gameType) return c.json({ error: "Unsupported game type" }, 400);

  if (!isGameEnabled(gameType)) return c.json({ error: "Game type is currently unavailable" }, 404);

  const user = c.get("user")!;
  const namespace = getRoomNamespace(c.env, gameType);

  for (let attempt = 0; attempt < 5; attempt++) {
    const roomCode = generateSecureRoomCode();
    const roomId = roomIdFor(gameType, roomCode);

    const reservation = await reserveRoomCode(
      c.env.DB,
      gameType,
      roomCode,
      Date.now() + ROOM_LIFETIME_MS,
    );

    if (!reservation) continue;

    const stub = namespace.get(namespace.idFromName(roomId));
    let response: Response;

    try {
      response = await stub.fetch("https://do.internal/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...parsed.data,
          gameType,
          hostId: user.id,
          hostName: user.gamertag || "Player",
          roomCode,
        }),
      });
    } catch (error) {
      console.error("Room Durable Object creation failed", error);
      await releaseRoomCode(c.env.DB, roomCode, roomId);

      return c.json({ error: "Room creation failed" }, 500);
    }

    if (response.status === 409) {
      await releaseRoomCode(c.env.DB, roomCode, roomId);
      continue;
    }

    if (!response.ok) {
      await releaseRoomCode(c.env.DB, roomCode, roomId);

      return c.json({ error: "Room creation failed" }, 400);
    }

    const created = await response.json<{ expiresAt?: number }>();
    const expiresAt = created.expiresAt ?? reservation.expiresAt;
    await activateRoomCode(c.env.DB, roomCode, roomId, expiresAt);
    const frontendUrl = c.env.FRONTEND_URL || "http://localhost:3000";

    return c.json({
      roomId,
      roomCode,
      gameType,
      expiresAt,
      wsUrl: `/api/v1/ws/games/${roomId}?roomCode=${roomCode}`,
      joinUrl: `${frontendUrl.replace(/\/$/, "")}/${gameRouteSlug(gameType)}?roomCode=${roomCode}`,
    });
  }

  return c.json({ error: "Could not allocate a unique room code" }, 503);
});

roomsRoutes.post("/join", async (c) => {
  const parsed = joinSchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) return c.json({ error: "Invalid room code or game type" }, 400);
  const roomCode = parsed.data.roomCode;
  const directoryEntry = await resolveRoomCode(c.env.DB, roomCode);

  const gameType =
    directoryEntry?.gameType ??
    (parsed.data.gameType ? normalizeGameType(parsed.data.gameType) : null);

  if (!gameType) return c.json({ error: "Room not found" }, 404);

  if (!isGameEnabled(gameType)) return c.json({ error: "Room not found" }, 404);

  const roomId = directoryEntry?.roomId ?? roomIdFor(gameType, roomCode);
  const namespace = getRoomNamespace(c.env, gameType);

  const response = await namespace
    .get(namespace.idFromName(roomId))
    .fetch("https://do.internal/state");

  if (!response.ok) {
    if (directoryEntry && response.status === 404) {
      await releaseRoomCode(c.env.DB, roomCode, roomId);
    }

    return c.json({ error: "Room not found" }, 404);
  }

  const state = await response.json<PublicRoomState>();

  if (state.roomCode !== roomCode) return c.json({ error: "Room not found" }, 404);

  const frontendUrl = c.env.FRONTEND_URL || "http://localhost:3000";

  return c.json({
    roomId,
    gameType,
    ...roomResponse(state, gameType, frontendUrl),
    wsUrl: `/api/v1/ws/games/${roomId}?roomCode=${roomCode}`,
  });
});

roomsRoutes.get("/:roomCode", async (c) => {
  const roomCode = c.req.param("roomCode").toUpperCase();

  if (!ROOM_CODE_PATTERN.test(roomCode)) return c.json({ error: "Invalid room code" }, 400);
  const directoryEntry = await resolveRoomCode(c.env.DB, roomCode);
  const requestedGameType = c.req.query("gameType");

  const gameType =
    directoryEntry?.gameType ?? (requestedGameType ? normalizeGameType(requestedGameType) : null);

  if (!gameType) return c.json({ error: "Room not found" }, 404);

  if (!isGameEnabled(gameType)) return c.json({ error: "Room not found" }, 404);

  const roomId = directoryEntry?.roomId ?? roomIdFor(gameType, roomCode);
  const namespace = getRoomNamespace(c.env, gameType);

  const response = await namespace
    .get(namespace.idFromName(roomId))
    .fetch("https://do.internal/state");

  if (!response.ok) {
    if (directoryEntry && response.status === 404) {
      await releaseRoomCode(c.env.DB, roomCode, roomId);
    }

    return c.json({ error: "Room not found" }, 404);
  }

  const state = await response.json<PublicRoomState>();

  if (state.roomCode !== roomCode) return c.json({ error: "Room not found" }, 404);
  const frontendUrl = c.env.FRONTEND_URL || "http://localhost:3000";
  const { joinUrl: _joinUrl, ...summary } = roomResponse(state, gameType, frontendUrl);

  return c.json({ roomId, gameType, ...summary });
});
