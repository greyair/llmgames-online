import { z } from "zod";

import { describe, expect, it, vi } from "vitest";

import { roomTestEnv } from "../fixtures/room-env";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { Connect4Room } from "../../durable-objects/Connect4Room";
import type { Connect4GameState } from "../../durable-objects/types";

/**
 * M3.2.1 — a finished match must be persisted exactly once, together with the
 * receipt that makes a retry a replay.
 *
 * Before this fix `match_ended` saved the state from inside `handleGameAction`,
 * i.e. before `dispatchAction` wrote the state + receipt pair. When only the
 * receipt write failed, the ended board was already on disk without a receipt:
 * a restart showed a finished match that could never be replayed, and the
 * client's retry was refused instead of acknowledged.
 *
 * M3.4.1 — the pending announcement must not outlive the write that carried it.
 * A rolled-back write restores `playing`, so the marker and the stopped clock
 * are undone with it; otherwise the next successful move of the same instance
 * announces the end of a match that is still running.
 */

class SeededConnect4Room extends Connect4Room {
  /** Terminal announcements this instance actually pushed, in order. */
  readonly endings: string[] = [];

  protected startingPlayerIndex(): number {
    return 0;
  }

  protected broadcastProjected(
    type: "game_started" | "game_ended",
    extra?: { reason?: string },
  ): void {
    if (type === "game_ended") this.endings.push(extra?.reason ?? "unknown");

    super.broadcastProjected(type, extra);
  }

  snapshot(): Connect4GameState {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }
}

function harness() {
  // Clone on write like real Durable Object storage: a rejected write must not
  // leave the previous snapshot half-mutated.
  const runtime = new MemoryRoomRuntime(new Map(), () => undefined, [], true);

  return { runtime, room: () => new SeededConnect4Room(runtime, roomTestEnv()) };
}

async function post<T>(room: Connect4Room, path: string, body: T): Promise<Response> {
  return room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const outcomeSchema = z.object({
  ok: z.boolean().optional(),
  replayed: z.boolean().optional(),
  error: z.object({ message: z.string() }).optional(),
});

/** Seat two players and start; seat 1 is the host because the fixture is seeded. */
async function startedRoom(room: Connect4Room): Promise<void> {
  expect(
    (await post(room, "/create", { hostId: "p1", hostName: "One", roomCode: "WNA234", turnTime: 30_000 }))
      .status,
  ).toBe(200);
  expect(
    (await post(room, "/agent/join", { playerId: "p2", assignedCodename: "SwiftAnchor" })).status,
  ).toBe(200);
  expect((await post(room, "/agent/start", { playerId: "p1" })).status).toBe(200);
}

/** p1 fills columns 0..2 on the bottom row; p2 answers in the same columns. */
const SETUP_MOVES: ReadonlyArray<readonly [string, number]> = [
  ["p1", 0],
  ["p2", 0],
  ["p1", 1],
  ["p2", 1],
  ["p1", 2],
  ["p2", 2],
];

async function playSetupMoves(room: Connect4Room): Promise<void> {
  for (const [playerId, col] of SETUP_MOVES)
    expect(
      (await post(room, "/agent/action", { playerId, actionType: "drop_disc", data: { col } })).status,
    ).toBe(200);
}

function playWinningMove(room: Connect4Room, requestId: string): Promise<Response> {
  return post(room, "/agent/action", {
    playerId: "p1",
    actionType: "drop_disc",
    data: { col: 3 },
    requestId,
  });
}

describe("finished match persistence", () => {
  it("persists the ended state and its receipt before announcing the result", async () => {
    const { room, runtime } = harness();
    const game = room();

    await startedRoom(game);
    await playSetupMoves(game);

    expect((await playWinningMove(game, "win-request-1")).status).toBe(200);
    expect(game.snapshot().status).toBe("ended");
    expect(game.snapshot().winner).toBe("p1");

    // A restart reads both halves of the same write: the result and the receipt.
    const restarted = new SeededConnect4Room(runtime, roomTestEnv());

    await runtime.initialized;

    expect(restarted.snapshot().status).toBe("ended");
    expect(restarted.snapshot().winner).toBe("p1");

    const replay = await playWinningMove(restarted, "win-request-1");

    expect(replay.status).toBe(200);
    expect(outcomeSchema.parse(await replay.json()).replayed).toBe(true);
    expect(restarted.snapshot().board[5]![3]).toBe(1);
    expect(restarted.snapshot().board[4]![3]).toBe(0);
  });

  it("keeps no ended state when the receipt cannot be written, then applies once on retry", async () => {
    const { room, runtime } = harness();
    const game = room();

    await startedRoom(game);
    await playSetupMoves(game);
    runtime.storage.failWriteContaining = "ackedActionRecords";

    const failed = await playWinningMove(game, "win-request-1");

    expect(failed.status).toBe(500);
    expect((await failed.json<{ error: { message: string } }>()).error.message).toBeTruthy();

    // The in-memory state rolled back with the failed write.
    expect(game.snapshot().status).toBe("playing");
    expect(game.snapshot().winner).toBeNull();

    runtime.storage.failWriteContaining = null;

    const restarted = new SeededConnect4Room(runtime, roomTestEnv());

    await runtime.initialized;

    // Nothing about the finished match survived: no result without a receipt.
    expect(restarted.snapshot().status).toBe("playing");
    expect(restarted.snapshot().winner).toBeNull();
    expect(restarted.snapshot().board[5]![3]).toBe(0);

    const retried = await playWinningMove(restarted, "win-request-1");

    expect(retried.status).toBe(200);
    expect(restarted.snapshot().status).toBe("ended");
    expect(restarted.snapshot().winner).toBe("p1");
    expect(restarted.snapshot().board[5]![3]).toBe(1);
  });

  it("keeps the clock running after a rolled-back result", async () => {
    const { room, runtime } = harness();
    const game = room();

    await startedRoom(game);
    await playSetupMoves(game);
    runtime.storage.failWriteContaining = "ackedActionRecords";

    expect((await playWinningMove(game, "win-request-1")).status).toBe(500);
    expect(game.snapshot().status).toBe("playing");

    runtime.storage.failWriteContaining = null;

    const turnsBefore = game.snapshot().turnState.turnNumber;
    const clock = vi.spyOn(Date, "now");
    let now = Date.now();

    clock.mockImplementation(() => now);

    try {
      // The winning move stopped the timers before its write failed. Left
      // stopped, the next tick re-anchors on `now` and this missed turn silently
      // never expires; re-armed on the durable write, it expires as usual.
      now += 40_000;
      await game.alarm();

      expect(game.snapshot().status).toBe("playing");
      expect(game.snapshot().turnState.turnNumber).toBeGreaterThan(turnsBefore);
    } finally {
      clock.mockRestore();
    }
  });

  it("does not announce a rolled-back result on a later action", async () => {
    const { room, runtime } = harness();
    const game = room();

    await startedRoom(game);
    await playSetupMoves(game);
    runtime.storage.failWriteContaining = "ackedActionRecords";

    expect((await playWinningMove(game, "win-request-1")).status).toBe(500);
    expect(game.endings).toEqual([]);

    runtime.storage.failWriteContaining = null;

    const current = game.snapshot().turnState.currentPlayerId;

    expect(current).toBe("p1");

    // Same instance, and a move that decides nothing: the rolled-back end must
    // not be delivered here. Before M3.4.1 this broadcast `game_ended` while the
    // board was still mid-match.
    const followUp = await post(game, "/agent/action", {
      playerId: current,
      actionType: "drop_disc",
      data: { col: 4 },
    });

    expect(followUp.status).toBe(200);
    expect(game.snapshot().status).toBe("playing");
    expect(game.snapshot().winner).toBeNull();
    expect(game.endings).toEqual([]);
  });
});
