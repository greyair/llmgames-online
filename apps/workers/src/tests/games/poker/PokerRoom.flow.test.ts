import { roomTestEnv } from "../../fixtures/room-env";

import type { WireValue } from "@llmgames/game-catalog";
import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { describe, expect, it, vi } from "vitest";

import { PokerRoom } from "../../../durable-objects/PokerRoom";

class TestPokerRoom extends PokerRoom {
  snapshot() {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }
}

function createHarness() {
  const storage = new Map<string, unknown>();
  let alarmAt: number | null = null;

  const state = new MemoryRoomRuntime(storage, (at) => {
    alarmAt = at;
  });

  return { room: new TestPokerRoom(state, roomTestEnv()), storage };
}

async function post<T>(room: PokerRoom, path: string, body: T): Promise<Response> {
  return room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("Poker public flow", () => {
  it("deals blinds, accepts a call, settles a fold, and rotates into the next hand", async () => {
    const harness = createHarness();

    try {
      await post(harness.room, "/create", {
        hostId: "p1",
        hostName: "Player One",
        roomCode: "PK2345",
        turnTime: 30_000,
      });
      await post(harness.room, "/agent/join", {
        playerId: "p2",
        assignedCodename: "SwiftAnchor",
      });
      expect((await post(harness.room, "/agent/start", { playerId: "p1" })).status).toBe(200);

      let state = harness.room.snapshot();
      expect(state.turnState.phase).toBe("preflop");
      expect(state.seats).toHaveLength(2);
      expect(state.seats.every((seat) => seat.hole.length === 2)).toBe(true);
      expect(state.pot).toBe(15);
      expect(state.currentBet).toBe(10);

      const actor = state.actionPlayerId!;
      const other = state.seats.find((seat) => seat.playerId !== actor)!;

      const call = await post(harness.room, "/agent/action", {
        playerId: actor,
        actionType: "call",
        data: {},
      });

      expect(call.status).toBe(200);

      state = harness.room.snapshot();
      expect(state.pot).toBe(20);
      expect(state.actionPlayerId).toBe(other.playerId);
      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId: other.playerId,
            actionType: "fold",
            data: {},
          })
        ).status,
      ).toBe(200);

      state = harness.room.snapshot();
      expect(state.turnState.phase).toBe("hand_over");
      expect(state.pot).toBe(0);
      expect(state.lastHandResult).toMatchObject({
        reason: "fold",
        winners: [actor],
        pot: 20,
      });
      expect(state.seats.find((seat) => seat.playerId === actor)!.stack).toBe(1010);
      expect(state.seats.find((seat) => seat.playerId === other.playerId)!.stack).toBe(990);

      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId: actor,
            actionType: "next_hand",
            data: {},
          })
        ).status,
      ).not.toBe(200);
      expect(harness.room.snapshot().handNumber).toBe(1);
      vi.spyOn(Date, "now").mockReturnValue(state.lastHandResult!.finishedAt! + 5000);
      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId: actor,
            actionType: "next_hand",
            data: {},
          })
        ).status,
      ).toBe(200);
      vi.restoreAllMocks();
      state = harness.room.snapshot();
      expect(state.handNumber).toBe(2);
      expect(state.turnState.phase).toBe("preflop");
      expect(state.pot).toBe(15);
      expect(state.buttonIndex).toBe(1);
      expect(state.deck).toHaveLength(48);
    } finally {
      vi.restoreAllMocks();
      await post(harness.room, "/agent/action", {
        playerId: "p1",
        actionType: "end_game",
        data: {},
      });
    }
  });
});

it("requires BB-multiple street totals, allowing small-blind additions and exact all-ins/calls", async () => {
  const h = createHarness();
  await post(h.room, "/create", { hostId: "p1", hostName: "One", roomCode: "PK2345" });
  await post(h.room, "/agent/join", { playerId: "p2", assignedCodename: "SwiftAnchor" });
  await post(h.room, "/agent/start", { playerId: "p1" });
  const state = h.room.snapshot();
  const actor = state.actionPlayerId!;

  const action = (playerId: string, actionType: string, data: WireValue = {}) =>
    post(h.room, "/agent/action", { playerId, actionType, data });

  expect(state.seats.find((s) => s.playerId === actor)!.streetBet).toBe(5);
  expect((await action(actor, "raise", { raiseTo: 25 })).status).not.toBe(200);
  expect((await action(actor, "raise", { amount: 20 })).status).not.toBe(200);
  expect(state.currentBet).toBe(10);
  expect((await action(actor, "raise", { amount: 15 })).status).toBe(200);
  expect(state.currentBet).toBe(20);
  const next = state.seats.find((s) => s.playerId === state.actionPlayerId)!;
  next.stack = 37;
  expect((await action(next.playerId, "raise", { raiseTo: next.streetBet + 37 })).status).toBe(200);
  expect(state.currentBet).toBe(47);
  expect((await action(actor, "call")).status).toBe(200);
  await action("p1", "end_game");
});
