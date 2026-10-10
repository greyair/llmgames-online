import { Hono } from "hono";
import { isGameEnabled } from "@llmgames/game-catalog";
import type { Env, Variables } from "../types";
import { getRoomNamespace, normalizeGameType, ROOM_CODE_PATTERN } from "../lib/roomRouting";

export const wsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

wsRoutes.get("/games/:gameId", async (c) => {
  const gameId = c.req.param("gameId");
  const match = gameId.match(/^(.+)-([A-HJ-NP-Z2-9]{6})$/i);

  if (!match) return c.json({ error: "Invalid room id" }, 400);
  const gameType = normalizeGameType(match[1]!);
  const roomCode = match[2]!.toUpperCase();

  if (!gameType || !isGameEnabled(gameType) || !ROOM_CODE_PATTERN.test(roomCode)) {
    return c.json({ error: "Invalid room id" }, 400);
  }

  const canonicalRoomId = `${gameType}-${roomCode}`;
  const namespace = getRoomNamespace(c.env, gameType);
  const stub = namespace.get(namespace.idFromName(canonicalRoomId));
  const user = c.get("user")!;
  const url = new URL(c.req.url);
  url.searchParams.set("roomCode", roomCode);
  const request = new Request(url.toString(), c.req.raw);
  request.headers.set("x-user-id", user.id);
  request.headers.set("x-user-name", user.gamertag || "Player");
  request.headers.set("x-seat-channel", "browser");

  return stub.fetch(request);
});
