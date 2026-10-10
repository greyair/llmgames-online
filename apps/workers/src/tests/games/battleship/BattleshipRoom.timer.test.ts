import { roomTestEnv } from "../../fixtures/room-env";

import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BATTLESHIP_PLACEMENT_TIME_MS,
  BattleshipRoom,
} from "../../../durable-objects/BattleshipRoom";

class TimerTestBattleshipRoom extends BattleshipRoom {
  snapshot() {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }

  expirePlacement(): Promise<void> {
    return this.onTurnTimeout(null);
  }
}

function createHarness() {
  const storage = new Map<string, unknown>();
  let alarmAt: number | null = null;

  const state = new MemoryRoomRuntime(storage, (at) => {
    alarmAt = at;
  });

  return {
    room: new TimerTestBattleshipRoom(state, roomTestEnv()),
    storage,
  };
}

async function post<T>(room: TimerTestBattleshipRoom, path: string, body: T): Promise<Response> {
  return room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("Battleship phase timers", () => {
  // Exact duration assertions must not lose milliseconds to asynchronous setup.
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("uses five minutes for placement, then the configured battle turn time", async () => {
    const harness = createHarness();
    await post(harness.room, "/create", {
      hostId: "host",
      hostName: "Host",
      roomCode: "SEA234",
      gameTotalTime: 30 * 60 * 1000,
      turnTime: 15_000,
    });
    await post(harness.room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });
    await post(harness.room, "/agent/start", { playerId: "host" });

    try {
      let stored = harness.room.snapshot();
      expect(stored.turnState.phase).toBe("placement");
      expect(stored.turnState.currentPlayerId).toBeNull();
      expect(stored.turnState.turnTimeRemaining).toBe(BATTLESHIP_PLACEMENT_TIME_MS);

      await harness.room.expirePlacement();

      stored = harness.room.snapshot();
      expect(stored.turnState.phase).toBe("battle");
      expect(["host", "guest"]).toContain(stored.turnState.currentPlayerId);
      expect(stored.turnState.turnTimeRemaining).toBe(30_000);
      expect(stored.boards).toHaveLength(2);

      for (const board of stored.boards) {
        expect(board.ready).toBe(true);
        expect(board.ships).toHaveLength(5);
        expect(board.cells.flat().filter(Boolean)).toHaveLength(22);
      }

      expect(stored.lastAnnouncement).toContain("auto-deployed");
      const first = stored.turnState.currentPlayerId;
      expect(stored.boards.find((b) => b.playerId === first)?.munitionPoints).toBe(2);
      await harness.room.expirePlacement();
      expect(stored.turnState.currentPlayerId).not.toBe(first);
      expect(stored.boards.every((b) => b.munitionPoints === 2)).toBe(true);
    } finally {
      await post(harness.room, "/agent/action", {
        playerId: "host",
        actionType: "end_game",
        data: {},
      });
    }
  });
});
