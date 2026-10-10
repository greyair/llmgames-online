import type { ClientView } from "../../src/domain/game-state";

import { describe, expect, it } from "vitest";
import {
  buildReplayTimeline,
  replayFilename,
  type ReplayTimelineFrame,
} from "../../src/features/replay/replayTimeline";

function frame(index: number, label: string, state: ClientView = {}): ReplayTimelineFrame {
  return { index, label, state };
}

describe("replay MP4 timeline", () => {
  it("holds the opening and result longer than action frames", () => {
    const timeline = buildReplayTimeline([
      frame(0, "game_started"),
      frame(1, "drop_disc"),
      frame(2, "game_ended", { winner: "p1" }),
    ]);

    expect(timeline.entries.map((entry) => entry.duration)).toEqual([1.6, 1, 2.4]);
    expect(timeline.entries.map((entry) => entry.timestamp)).toEqual([0, 1.6, 2.6]);
    expect(timeline.duration).toBe(5);
    expect(timeline.sounds.map((sound) => sound.kind)).toEqual(["start", "drop", "win"]);
  });

  it("adds a delayed impact result after naval weapon sounds", () => {
    const timeline = buildReplayTimeline([
      frame(0, "game_started"),
      frame(1, "bomb", {
        shotLog: [
          { row: 0, col: 0, byPlayerId: "p1", hit: true, weapon: "bomb", sunkShipId: "destroyer" },
        ],
      }),
      frame(2, "game_ended", { winner: "p1" }),
    ]);

    expect(timeline.entries[1]?.sounds.map((sound) => sound.kind)).toEqual(["bomb", "sink"]);
    expect(timeline.entries[1]?.sounds[1]?.at).toBeGreaterThan(
      timeline.entries[1]?.sounds[0]?.at ?? 0,
    );
  });

  it("uses the whole newly added naval batch for bomb impact audio", () => {
    const timeline = buildReplayTimeline([
      frame(0, "game_started", {
        shotLog: [{ row: 0, col: 0, byPlayerId: "p1", sequence: 10, hit: false, weapon: "cannon" }],
      }),
      frame(1, "bomb", {
        shotLog: [
          { row: 0, col: 0, byPlayerId: "p1", sequence: 10, hit: false, weapon: "cannon" },
          { row: 1, col: 1, byPlayerId: "p1", sequence: 11, hit: true, weapon: "bomb" },
          { row: 1, col: 2, byPlayerId: "p1", sequence: 12, hit: false, weapon: "bomb" },
        ],
      }),
    ]);

    expect(timeline.entries[1]?.sounds.map((sound) => sound.kind)).toEqual(["bomb", "hit"]);
  });

  it("maps Codenames and Poker actions to distinct cues", () => {
    const timeline = buildReplayTimeline([
      frame(0, "game_started"),
      frame(1, "give_clue"),
      frame(2, "guess_word"),
      frame(3, "bet"),
      frame(4, "fold"),
      frame(5, "game_ended", { winnerTeam: "red" }),
    ]);

    expect(timeline.sounds.map((sound) => sound.kind)).toEqual([
      "start",
      "clue",
      "reveal",
      "chip",
      "cancel",
      "win",
    ]);
  });
  it("creates filesystem-safe MP4 names", () => {
    expect(replayFilename("poker", new Date("2026-08-19T12:34:56.000Z"))).toBe(
      "llm-games-poker-2026-08-19T12-34-56Z.mp4",
    );
  });
});
