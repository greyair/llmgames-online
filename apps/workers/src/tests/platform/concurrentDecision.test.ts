import { z } from "zod";

import { describe, expect, it } from "vitest";

import { roomTestEnv } from "../fixtures/room-env";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { MinimalGameRoom } from "../fixtures/minimal-game/room";
import { minimalGamePlugin } from "../fixtures/minimal-game/plugin";

/**
 * M3.3 capability check for multi-phase / simultaneous games.
 *
 * Battleship (concurrent fleet placement), Codenames (every operative on the
 * active team may guess) and Pokémon (both players seal a choice) all need more
 * than "the seat in `currentPlayerId`". The contract answers that with the
 * optional `mayActNow` hook, and the platform must route `wait_for_turn` and the
 * projected `isYourTurn` flag through it.
 */

/** Both seats decide at once, like fleet placement. */
class ConcurrentRoom extends MinimalGameRoom {
  protected gameRules() {
    return {
      ...minimalGamePlugin,
      mayActNow: (state: Parameters<NonNullable<typeof minimalGamePlugin.turnActions>>[0], playerId: string) =>
        state.status === "playing" && state.players.some((player) => player.id === playerId),
    };
  }
}

const viewSchema = z.object({
  you: z.object({ playerId: z.string(), isYourTurn: z.boolean(), legalActions: z.array(z.string()) }),
});

const waitSchema = z.object({
  timedOut: z.boolean(),
  reason: z.string(),
});

async function startedRoom(Room: typeof MinimalGameRoom) {
  const runtime = new MemoryRoomRuntime(new Map());
  const room = new Room(runtime, roomTestEnv());

  await runtime.initialized;

  const post = (path: string, body: Record<string, string | number>) =>
    room.fetch(
      new Request(`https://minimal.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  await post("/create", { hostId: "host", hostName: "Host", roomCode: "CNC234", turnTime: 30_000 });
  await post("/agent/join", { playerId: "guest", assignedCodename: "SwiftAnchor" });
  expect((await post("/agent/start", { playerId: "host" })).status).toBe(200);

  const view = async (playerId: string) => {
    const response = await room.fetch(
      new Request(`https://minimal.test/agent/view?playerId=${encodeURIComponent(playerId)}`),
    );

    return viewSchema.parse((await response.json<{ state: object }>()).state);
  };

  const wait = async (playerId: string, timeoutMs = 500) => {
    const response = await post("/agent/wait-turn", { playerId, timeoutMs });

    return waitSchema.parse(await response.json());
  };

  return { room, view, wait };
}

describe("concurrent decisions", () => {
  it("wakes every seat the rule module allows, not just the current player", async () => {
    const harness = await startedRoom(ConcurrentRoom);

    try {
      const host = await harness.view("host");
      const guest = await harness.view("guest");

      expect(host.you.isYourTurn).toBe(true);
      expect(guest.you.isYourTurn).toBe(true);

      // Neither request blocks: both seats are deciding at once.
      const hostWait = await harness.wait("host");
      const guestWait = await harness.wait("guest");

      expect(hostWait).toEqual({ timedOut: false, reason: "your_turn" });
      expect(guestWait).toEqual({ timedOut: false, reason: "your_turn" });
    } finally {
      harness.room.stopForTest();
    }
  });

  it("keeps the single-seat default when a game does not widen it", async () => {
    const harness = await startedRoom(MinimalGameRoom);

    try {
      const host = await harness.view("host");
      const guest = await harness.view("guest");
      const current = host.you.isYourTurn ? "host" : "guest";
      const waiting = current === "host" ? "guest" : "host";

      expect((await harness.view(current)).you.isYourTurn).toBe(true);
      expect((await harness.view(waiting)).you.isYourTurn).toBe(false);
      expect(guest.you.playerId).toBe("guest");

      const blocked = await harness.wait(waiting, 300);

      expect(blocked.timedOut).toBe(true);
    } finally {
      harness.room.stopForTest();
    }
  });
});
