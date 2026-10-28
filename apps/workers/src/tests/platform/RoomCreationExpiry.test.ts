import { roomTestEnv } from "../fixtures/room-env";
import { z } from "zod";

import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import type { RoomRuntime } from "../../durable-objects/runtime";
import {
  gameLifecycle,
  ROOM_INACTIVITY_MS,
  ROOM_LIFETIME_MS,
  TURN_TIME_MIN_MS,
} from "@llmgames/game-catalog";
import { describe, expect, it } from "vitest";
import type { Env } from "../../types";
import { BattleshipRoom } from "../../durable-objects/BattleshipRoom";
import { Connect4Room } from "../../durable-objects/Connect4Room";
import { PokerRoom } from "../../durable-objects/PokerRoom";
import { ReversiRoom } from "../../durable-objects/ReversiRoom";
import { ContextoRoom } from "../../durable-objects/ContextoRoom";
import type { BaseGameState } from "../../durable-objects/types";

type RoomInstance = { fetch(request: Request): Promise<Response> };

type RoomConstructor = new (state: RoomRuntime, env: Env) => RoomInstance;

const roomTypes: Array<[string, RoomConstructor]> = [
  ["connect4", Connect4Room],
  ["reversi", ReversiRoom],
  ["battleship", BattleshipRoom],
  ["poker", PokerRoom],
  ["contexto", ContextoRoom],
];

function createHarness(Room: RoomConstructor) {
  const storage = new Map<string, unknown>();
  let alarmAt: number | null = null;

  const state = new MemoryRoomRuntime(storage, (at) => {
    alarmAt = at;
  });

  return {
    room: new Room(state, roomTestEnv()),
    state,
    storage,
    getAlarm: () => alarmAt,
  };
}

describe("room creation expiry", () => {
  it.each(roomTypes)("adds fixed and inactivity expiry to %s rooms", async (gameType, Room) => {
    const harness = createHarness(Room);

    const response = await harness.room.fetch(
      new Request("https://room.test/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hostId: "host",
          hostName: "Host",
          roomCode: "ABC234",
          gameType,
          gameTotalTime: 10 * 60 * 1000,
          turnTime: 15_000,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json<{ expiresAt: number }>();
    const stored = (await harness.state.storage.get<BaseGameState>("gameState"))!;
    const expectedExpiry = stored.createdAt + ROOM_LIFETIME_MS;
    expect(stored.expiresAt).toBe(expectedExpiry);
    expect(body.expiresAt).toBe(expectedExpiry);

    const lastMeaningfulActivityAt = z
      .number()
      .parse(harness.storage.get("lastMeaningfulActivityAt"));

    expect(harness.getAlarm()).toBe(lastMeaningfulActivityAt + ROOM_INACTIVITY_MS);
    expect(stored.timerConfig.gameTotalTime).toBe(10 * 60 * 1000);
    expect(stored.timerConfig.turnTime).toBe(
      gameType === "contexto" ? 10 * 60 * 1000 : TURN_TIME_MIN_MS,
    );
  });
});

describe("per-game lifecycle budgets", () => {
  it("gives long games a match budget that no lobby wait can shorten", () => {
    const poker = gameLifecycle("poker");
    const connect4 = gameLifecycle("connect4");

    expect(poker.playingMs).toBeGreaterThan(connect4.playingMs);
    expect(poker.lobbyMs).toBe(ROOM_LIFETIME_MS);
    expect(gameLifecycle("not-a-game").playingMs).toBe(ROOM_LIFETIME_MS);
  });
});
