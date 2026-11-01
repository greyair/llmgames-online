import { describe, expect, it } from "vitest";
import type { WireObject } from "@llmgames/game-catalog";
import { z } from "zod";

import { goPlugin } from "../../../games/go/plugin";
import {
  GO_BLACK,
  GO_WHITE,
  areaScore,
  fromGtp,
  groupAt,
  legalPoints,
  playStone,
  positionKey,
  toGtp,
  type GoPosition,
} from "../../../games/go/rules";
import type { GoGameState } from "../../../durable-objects/types";

const NOW = 1_800_000_000_000;

const SIZE = 9;

/** A started two-seat game on an empty 9×9 board. */
function table(): GoGameState {
  const state = goPlugin.createInitialState({ hostId: "p1", hostName: "P1", turnTime: 30_000 }, "GO1234", 0);

  state.status = "playing";
  state.players = [
    { id: "p1", name: "P1" },
    { id: "p2", name: "P2" },
  ];
  state.seats = { p1: 1, p2: 2 };
  state.turn = GO_BLACK;
  state.turnState.currentPlayerId = "p1";
  state.turnState.phase = "play";

  return state;
}

/** Black or White by seat, so a test reads as a game rather than as indices. */
function send(state: GoGameState, playerId: string, actionType: string, data: WireObject = {}) {
  return goPlugin.applyAction(state, playerId, { actionType, data }, NOW);
}

function play(state: GoGameState, playerId: string, point: string): string | null {
  const result = send(state, playerId, "place_go_stone", { point });

  return result.ok ? null : result.message;
}

function positionOf(points: Record<string, number>, history: string[] = []): GoPosition {
  const cells = new Array<number>(SIZE * SIZE).fill(0);

  for (const [name, color] of Object.entries(points)) {
    const index = fromGtp(name, SIZE);

    if (index === null) throw new Error(`bad point ${name}`);

    cells[index] = color;
  }

  return { size: SIZE, cells, playedAt: cells.map(() => 0), toPlay: GO_BLACK, history };
}

describe("go move rules", () => {
  it("maps points both ways", () => {
    expect(toGtp(0, SIZE)).toBe("A9");
    expect(toGtp(80, SIZE)).toBe("J1");
    expect(fromGtp("A9", SIZE)).toBe(0);
    expect(fromGtp("J1", SIZE)).toBe(80);
    // I is skipped in GTP, so I5 is not a point.
    expect(fromGtp("I5", SIZE)).toBeNull();
  });

  it("captures a stone with no liberties left", () => {
    // A white stone on E5 walled in on three sides; Black fills its last liberty.
    const position = positionOf({ E5: GO_WHITE, D5: GO_BLACK, F5: GO_BLACK, E4: GO_BLACK });
    const step = playStone(position, GO_BLACK, fromGtp("E6", SIZE) ?? 0, 1);

    expect(step.ok).toBe(true);

    if (!step.ok) return;

    expect(step.captured).toEqual([fromGtp("E5", SIZE)]);
    expect(step.cells[fromGtp("E5", SIZE) ?? 0]).toBe(0);
  });

  it("refuses suicide when nothing is captured", () => {
    const position = positionOf({ D5: GO_BLACK, E4: GO_BLACK, E6: GO_BLACK, F5: GO_BLACK });
    const step = playStone(position, GO_WHITE, fromGtp("E5", SIZE) ?? 0, 1);

    expect(step).toEqual({ ok: false, reason: "suicide" });
  });

  it("refuses a move that occupies a taken point", () => {
    const position = positionOf({ E5: GO_BLACK });
    const step = playStone(position, GO_WHITE, fromGtp("E5", SIZE) ?? 0, 1);

    expect(step).toEqual({ ok: false, reason: "occupied" });
  });

  it("refuses a move that rebuilds an earlier position", () => {
    const position = positionOf({ E5: GO_WHITE, D5: GO_BLACK, F5: GO_BLACK, E4: GO_BLACK });
    const step = playStone(position, GO_BLACK, fromGtp("E6", SIZE) ?? 0, 1);

    expect(step.ok).toBe(true);

    if (!step.ok) return;

    // The same move from the same board, with the result already in the record:
    // positional superko refuses to rebuild a position that has been seen.
    const blocked = playStone(
      { ...position, history: [positionKey(position.cells), step.key] },
      GO_BLACK,
      fromGtp("E6", SIZE) ?? 0,
      2,
    );

    expect(blocked).toEqual({ ok: false, reason: "ko" });
  });

  it("lists only legal points", () => {
    const position = positionOf({ D5: GO_BLACK, E4: GO_BLACK, E6: GO_BLACK, F5: GO_BLACK });
    const legal = legalPoints(position, GO_WHITE);

    expect(legal).not.toContain(fromGtp("E5", SIZE));
    expect(legal).toContain(fromGtp("A1", SIZE));
  });
});

describe("go scoring", () => {
  it("counts stones plus surrounded empty points, then adds komi", () => {
    // Black owns the left column area; White owns the right. No dead stones.
    const cells = new Array<number>(SIZE * SIZE).fill(0);

    for (let row = 0; row < SIZE; row += 1) {
      cells[row * SIZE + 2] = GO_BLACK;
      cells[row * SIZE + 6] = GO_WHITE;
    }

    const score = areaScore(cells, SIZE, [], 7.5);

    // Black: 9 stones + the 2 columns to the left (18 points) = 27.
    expect(score.blackStones).toBe(9);
    expect(score.blackTerritory).toBe(18);
    expect(score.black).toBe(27);
    // White: 9 stones + 2 columns on the right (18) + komi.
    expect(score.white).toBe(34.5);
    expect(score.winner).toBe(GO_WHITE);
    expect(score.margin).toBe(7.5);
  });

  it("lifts marked dead stones before counting", () => {
    const cells = new Array<number>(SIZE * SIZE).fill(0);
    const dead = fromGtp("A9", SIZE) ?? 0;

    cells[dead] = GO_WHITE;

    const withStones = areaScore(cells, SIZE, [], 0);

    expect(withStones.whiteStones).toBe(1);

    const lifted = areaScore(cells, SIZE, [dead], 0);

    expect(lifted.whiteStones).toBe(0);
  });
});

describe("go turn flow", () => {
  it("alternates colours and records captures per colour", () => {
    const state = table();

    expect(play(state, "p1", "E5")).toBeNull();
    expect(state.turn).toBe(GO_WHITE);
    expect(state.turnState.currentPlayerId).toBe("p2");
    expect(state.moves).toBe(1);
    expect(state.last).toEqual({ color: GO_BLACK, kind: "play", point: fromGtp("E5", SIZE) });
  });

  it("refuses a move from the wrong colour", () => {
    const state = table();
    const result = send(state, "p2", "place_go_stone", { point: "E5" });

    expect(result).toEqual({ ok: false, message: "Not your turn" });
  });

  it("opens scoring after two passes and ends it when both accept", () => {
    const state = table();

    expect(send(state, "p1", "pass_turn").ok).toBe(true);
    expect(state.stage).toBe("playing");
    expect(send(state, "p2", "pass_turn").ok).toBe(true);
    expect(state.stage).toBe("scoring");
    expect(state.turnState.phase).toBe("scoring");

    const first = send(state, "p1", "accept_score");

    expect(first.ok).toBe(true);
    expect(state.status).toBe("playing");

    const second = send(state, "p2", "accept_score");

    expect(second.ok).toBe(true);
    expect(state.status).toBe("ended");
    expect(state.stage).toBe("ended");
    expect(state.score).not.toBeNull();
    // An empty board is all neutral, so the komi decides it for White.
    expect(state.winner).toBe("p2");
  });

  it("clears acceptances when the dead marking changes", () => {
    const state = table();

    expect(play(state, "p1", "E5")).toBeNull();
    expect(send(state, "p2", "pass_turn").ok).toBe(true);
    expect(send(state, "p1", "pass_turn").ok).toBe(true);
    expect(state.stage).toBe("scoring");

    expect(send(state, "p2", "accept_score").ok).toBe(true);
    expect(state.accepted).toEqual([GO_WHITE]);

    expect(send(state, "p1", "mark_dead", { point: "E5" }).ok).toBe(true);
    expect(state.dead).toHaveLength(1);
    expect(state.accepted).toEqual([]);
  });

  it("returns to playing on resume", () => {
    const state = table();

    expect(send(state, "p1", "pass_turn").ok).toBe(true);
    expect(send(state, "p2", "pass_turn").ok).toBe(true);
    expect(state.stage).toBe("scoring");
    expect(send(state, "p1", "resume_play").ok).toBe(true);
    expect(state.stage).toBe("playing");
    expect(state.passes).toBe(0);
    expect(state.turnState.phase).toBe("play");
  });

  it("hands the match to the opponent on resignation", () => {
    const state = table();

    expect(send(state, "p1", "resign_go").ok).toBe(true);
    expect(state.status).toBe("ended");
    expect(state.winner).toBe("p2");
  });

  it("passes when the turn clock expires", () => {
    const state = table();

    goPlugin.onTurnTimeout?.(state, "p1", NOW);

    expect(state.passes).toBe(1);
    expect(state.turn).toBe(GO_WHITE);
    expect(state.status).toBe("playing");
  });

  it("hides the superko keys from the projection", () => {
    const state = table();

    const projected = z
      .object({ legal: z.array(z.string()).catch([]) })
      .loose()
      .parse(goPlugin.projectState?.(state, "p1") ?? {});

    const legal = projected.legal;

    expect("history" in projected).toBe(false);
    // Every point is empty and none of them is suicide or a repeat.
    expect(legal).toHaveLength(81);
    expect(legal).toContain("E5");
  });
});
