import { roomTestEnv } from "../../fixtures/room-env";
import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { describe, expect, it } from "vitest";

import { PokerRoom } from "../../../durable-objects/PokerRoom";
import type { PokerGameState } from "../../../durable-objects/types";

/**
 * A Durable Object can be evicted at any point, and the next request rebuilds it
 * from storage. Everything the table needs to finish the hand has to already be
 * in that stored state — including the commitment to the deck it shuffled.
 *
 * The runtime clones every write, so what these tests read back is exactly what
 * would have survived an eviction, not a live object that kept changing.
 */
class InspectablePokerRoom extends PokerRoom {
  commitment() {
    return this.gameState?.deckCommitHash;
  }
}

function runtime(values: Map<string, unknown>) {
  return new MemoryRoomRuntime(values, undefined, [], true);
}

function post<T>(room: PokerRoom, path: string, body: T) {
  return room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function dealFirstHand(values: Map<string, unknown>) {
  const room = new InspectablePokerRoom(runtime(values), roomTestEnv());

  await post(room, "/create", {
    hostId: "p1",
    hostName: "Player One",
    roomCode: "PK2345",
    turnTime: 30_000,
  });
  await post(room, "/agent/join", { playerId: "p2", assignedCodename: "SwiftAnchor" });

  expect((await post(room, "/agent/start", { playerId: "p1" })).status).toBe(200);

  return room;
}

describe("Poker after an eviction", () => {
  it("serves the same deck commitment from the stored state", async () => {
    const values = new Map<string, unknown>();
    const first = await dealFirstHand(values);

    const dealt = await runtime(values).storage.get<PokerGameState>("gameState");

    expect(dealt?.seats.every((seat) => seat.hole.length === 2)).toBe(true);

    // Web Crypto hashes off the event loop, so the write that dealt the hand can
    // precede its commitment. What matters is that the commitment is in storage
    // before the hand is played out: the next persisted action carries it.
    await new Promise((done) => setTimeout(done, 0));

    expect(first.commitment()).toMatch(/^[0-9a-f]{64}$/);

    expect(
      (
        await post(first, "/agent/action", {
          playerId: dealt!.actionPlayerId!,
          actionType: "call",
          data: {},
        })
      ).status,
    ).toBe(200);

    const stored = await runtime(values).storage.get<PokerGameState>("gameState");

    expect(stored?.deckCommitHash).toMatch(/^[0-9a-f]{64}$/);

    // A room rebuilt from that state — the eviction case — reads the same one.
    const rebuilt = new InspectablePokerRoom(runtime(values), roomTestEnv());

    await rebuilt.fetch(new Request("https://room.test/agent/view?playerId=p1"));

    expect(rebuilt.commitment()).toBe(stored!.deckCommitHash);
    expect(first.commitment()).toBe(stored!.deckCommitHash);

    await post(rebuilt, "/agent/action", { playerId: "p1", actionType: "end_game", data: {} });
  });
});
