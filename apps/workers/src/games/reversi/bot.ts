import { z } from "zod";

import type { GameIntent, RuleBotDecisionView, RuleBotStrategy } from "../contract";
import { REVERSI_SIZE } from "./rules";

/**
 * Reversi rule bot (C4).
 *
 * Weighted greedy: corners are permanent, the squares next to a corner usually
 * hand it away, and flipping more discs is worth more than flipping fewer. No
 * search — one evaluation per legal move, so a decision costs microseconds and
 * stays inside the room's CPU budget.
 */
const CORNER_BONUS = 120;

/** Squares diagonally or orthogonally next to a corner are liabilities. */
const DANGER_NEAR_CORNER = -28;

/** Edge squares are stable-ish; interior squares are ordinary. */
const EDGE_BONUS = 8;

function isCorner(row: number, col: number): boolean {
  return (
    (row === 0 || row === REVERSI_SIZE - 1) && (col === 0 || col === REVERSI_SIZE - 1)
  );
}

function isNearCorner(row: number, col: number): boolean {
  const near = (value: number) => value <= 1 || value >= REVERSI_SIZE - 2;

  return near(row) && near(col) && !isCorner(row, col);
}

interface LegalMove {
  row: number;
  col: number;
  flipCount: number;
}

/** The projection is JSON from another isolate, so the list is parsed. */
const movesSchema = z
  .array(z.object({ row: z.number(), col: z.number(), flipCount: z.number() }))
  .catch([]);

function readMoves(view: RuleBotDecisionView["view"]): LegalMove[] {
  return movesSchema.parse(view.legalMoves);
}

export const reversiRuleBot: RuleBotStrategy = {
  id: "reversi.weighted-greedy.v1",

  chooseAction({ view, legalActions }: RuleBotDecisionView): GameIntent | null {
    if (!legalActions.includes("place_disc") && !legalActions.includes("place")) return null;

    const moves = readMoves(view);

    if (moves.length === 0) return null;

    let best: { move: LegalMove; score: number } | null = null;

    for (const move of moves) {
      const score =
        move.flipCount +
        (isCorner(move.row, move.col) ? CORNER_BONUS : 0) +
        (isNearCorner(move.row, move.col) ? DANGER_NEAR_CORNER : 0) +
        (move.row === 0 ||
        move.col === 0 ||
        move.row === REVERSI_SIZE - 1 ||
        move.col === REVERSI_SIZE - 1
          ? EDGE_BONUS
          : 0);

      if (!best || score > best.score) best = { move, score };
    }

    if (!best) return null;

    return {
      actionType: legalActions.includes("place_disc") ? "place_disc" : "place",
      data: { row: best.move.row, col: best.move.col },
    };
  },
};
