import { roomTestEnv } from "../fixtures/room-env";

import { MemoryRoomRuntime } from "../fixtures/memory-runtime";

import { ROOM_INACTIVITY_MS } from "@llmgames/game-catalog";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Connect4Room } from "../../durable-objects/Connect4Room";

async function harness() {
  const storage = new Map<string, unknown>();
  let alarm: number | null = null;

  const state = new MemoryRoomRuntime(storage, (at) => {
    alarm = at;
  });

  const room = new InviteTestRoom(state, roomTestEnv());

  const created = await room.fetch(
    new Request("https://do.internal/create", {
      method: "POST",
      body: JSON.stringify({
        hostId: "host",
        hostName: "Host",
        roomCode: "ABC234",
        gameType: "connect4",
      }),
    }),
  );

  expect(created.status).toBe(200);

  const check = (ownerId = "host") =>
    room.fetch(
      new Request("https://do.internal/webhook-invite-check", {
        method: "POST",
        body: JSON.stringify({ ownerId }),
      }),
    );

  return { check, storage, game: room.snapshot() };
}

afterEach(() => vi.useRealTimers());

describe("authoritative webhook invite checks", () => {
  it("allows the lobby host without reserving a seat or renewing activity", async () => {
    const h = await harness();
    const before = JSON.stringify([...h.storage]);
    expect((await h.check()).status).toBe(200);
    expect(JSON.stringify([...h.storage])).toBe(before);
    expect((await h.check("guest")).status).toBe(409);
  });
  it("rejects full and started rooms", async () => {
    const h = await harness();
    h.game.maxPlayers = h.game.players.length;
    expect((await h.check()).status).toBe(409);
    h.game.maxPlayers = 2;
    h.game.status = "playing";
    expect((await h.check()).status).toBe(409);
  });
  it("rejects expired and inactive rooms without waiting for an alarm", async () => {
    vi.useFakeTimers();
    const h = await harness();
    vi.setSystemTime(Date.now() + ROOM_INACTIVITY_MS + 1);
    expect((await h.check()).status).toBe(404);
    const next = await harness();
    next.game.expiresAt = Date.now() - 1;
    expect((await next.check()).status).toBe(404);
  });
});

class InviteTestRoom extends Connect4Room {
  snapshot() {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }
}
