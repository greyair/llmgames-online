import { describe, expect, it } from "vitest";
import { remainingAt } from "../../src/game-ui/useMatchClock";
import type { ClientView } from "../../src/domain/game-state";

const state: ClientView = {
  status: "playing",
  gameTimeRemaining: 60_000,
  turnState: { currentPlayerId: "a", phase: "play", turnNumber: 1, turnTimeRemaining: 30_000 },
  clock: {
    serverTime: 1_800_000_000_000,
    gameEndsAt: 1_800_000_060_000,
    turnEndsAt: 1_800_000_030_000,
  },
  clockReceivedAt: 100,
};

describe("timestamp countdown", () => {
  it("advances without messages and catches up after a suspended tab", () => {
    expect(remainingAt(state, 1100)).toEqual({ game: 59_000, turn: 29_000 });
    expect(remainingAt(state, 25_100)).toEqual({ game: 35_000, turn: 5_000 });
    expect(remainingAt(state, 90_100)).toEqual({ game: 0, turn: 0 });
  });
  it("rebases a new turn without extending the match", () => {
    const next = {
      ...state,
      clockReceivedAt: 10_100,
      clock: {
        serverTime: 1_800_000_010_000,
        gameEndsAt: 1_800_000_060_000,
        turnEndsAt: 1_800_000_040_000,
      },
    };

    expect(remainingAt(next, 11_100)).toEqual({ game: 49_000, turn: 29_000 });
  });
  it("keeps replay and ended snapshots fixed", () => {
    for (const fixed of [
      { ...state, replayReadOnly: true },
      { ...state, status: "ended" },
    ]) {
      expect(remainingAt(fixed, 90_100)).toEqual({ game: 60_000, turn: 30_000 });
    }
  });
});
