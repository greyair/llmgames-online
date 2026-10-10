import { describe, it, expect } from "vitest";
import { PokerPlayback } from "../src/game-ui/pokerPlayback";
import type { ClientView } from "../src/domain/game-state";

const frame = (count: number): ClientView => ({
  type: "poker",
  handNumber: 1,
  actionLog: Array.from({ length: count }, () => ({
    playerId: "p1",
    action: "check",
    street: "flop",
    handNumber: 1,
  })),
});

describe("poker turn playback", () => {
  it("shows rapid consecutive moves in order, ignoring timer-only updates", () => {
    const playback = new PokerPlayback(frame(0), 0);
    playback.push(frame(1));
    playback.push({ ...frame(1), gameTimeRemaining: 5000 });
    playback.push(frame(2));
    expect(playback.tick(1399).actionLog).toHaveLength(0);
    expect(playback.tick(1400).actionLog).toHaveLength(1);
    expect(playback.tick(2799).actionLog).toHaveLength(1);
    expect(playback.tick(2800).actionLog).toHaveLength(2);
    expect(playback.catchingUp).toBe(false);
  });
  it("holds the result before showing a new hand", () => {
    const result = { ...frame(2), lastHandResult: { winners: ["p1"], showdown: false } };
    const playback = new PokerPlayback(result, 0);
    playback.push({ ...frame(2), handNumber: 2 });
    expect(playback.tick(4999).lastHandResult).toEqual(result.lastHandResult);
    expect(playback.resultRemainingMs(4999)).toBe(1);
    expect(playback.tick(5000).handNumber).toBe(2);
    expect(playback.resultRemainingMs(5000)).toBe(0);
  });
});
