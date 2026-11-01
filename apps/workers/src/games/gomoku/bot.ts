import { z } from "zod";

import type { GameIntent, RuleBotDecisionView, RuleBotStrategy } from "../contract";
import { GOMOKU_SIZE, gomokuCoordinate } from "./rules";

/**
 * Gomoku rule bot (C4).
 *
 * Heuristic, deterministic and cheap: win now, block a loss now, then score
 * every empty point by the runs it participates in. It is not a game-tree
 * engine — it never looks past one ply — because a bot that burns a Durable
 * Object's CPU budget to play a casual room is worse than a bot that plays
 * decently.
 *
 * The priority order is the one that matters in practice: an immediate five,
 * then the opponent's immediate five, then a threat of our own, then the
 * opponent's, then shape near the centre.
 */

/** Points that make five in a row, or that complete a run of four. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** Scores by run length for the side that owns the run. */
const RUN_SCORE = [0, 1, 12, 90, 900, 10_000] as const;

type Board = number[][];

/** The projection is JSON that arrived from another isolate: parse it. */
const boardSchema = z.array(z.array(z.number())).catch([]);

const seatSchema = z.record(z.string(), z.number()).catch({});

function readBoard(view: RuleBotDecisionView["view"]): Board | null {
  const rows = boardSchema.parse(view.board);

  if (rows.length !== GOMOKU_SIZE) return null;

  const board: Board = [];

  for (const row of rows) {
    if (row.length !== GOMOKU_SIZE) return null;

    board.push([...row]);
  }

  return board;
}

/** Run length through (row, col) for `seat`, assuming that point holds `seat`. */
function runThrough(board: Board, row: number, col: number, seat: number): number {
  let best = 0;

  for (const [dr, dc] of DIRECTIONS) {
    let length = 1;

    for (const sign of [1, -1] as const) {
      let r = row + dr * sign;
      let c = col + dc * sign;

      while (r >= 0 && r < GOMOKU_SIZE && c >= 0 && c < GOMOKU_SIZE && board[r]![c] === seat) {
        length += 1;
        r += dr * sign;
        c += dc * sign;
      }
    }

    best = Math.max(best, length);
  }

  return best;
}

/** Distance from the centre, used only to break ties between equal lines. */
function centrality(row: number, col: number): number {
  const mid = (GOMOKU_SIZE - 1) / 2;

  return -(Math.abs(row - mid) + Math.abs(col - mid));
}

export const gomokuRuleBot: RuleBotStrategy = {
  id: "gomoku.heuristic.v1",

  chooseAction({ view, legalActions, playerId }: RuleBotDecisionView): GameIntent | null {
    if (!legalActions.includes("place_stone")) return null;

    const board = readBoard(view);

    if (!board) return null;

    const colour = seatSchema.parse(view.seats)[playerId];

    if (colour !== 1 && colour !== 2) return null;

    const rival = colour === 1 ? 2 : 1;

    let best: { row: number; col: number; score: number } | null = null;

    for (let row = 0; row < GOMOKU_SIZE; row++) {
      for (let col = 0; col < GOMOKU_SIZE; col++) {
        if (board[row]![col] !== 0) continue;

        // Pretend this point is ours, then score both sides of the line.
        board[row]![col] = colour;

        const mine = runThrough(board, row, col, colour);

        board[row]![col] = rival;

        const theirs = runThrough(board, row, col, rival);

        board[row]![col] = 0;

        if (mine >= 5) return { actionType: "place_stone", data: { row, col } };

        // Winning is worth more than blocking; blocking is worth more than shape.
        const score =
          (mine >= 5 ? 100_000 : 0) +
          (theirs >= 5 ? 50_000 : 0) +
          (RUN_SCORE[Math.min(mine, 5)] ?? 0) * 2 +
          (RUN_SCORE[Math.min(theirs, 5)] ?? 0) +
          centrality(row, col);

        if (!best || score > best.score) best = { row, col, score };
      }
    }

    if (!best) return null;

    return { actionType: "place_stone", data: { row: best.row, col: best.col } };
  },
};

/** Human-readable point, used by tests and diagnostics. */
export function gomokuBotPoint(row: number, col: number): string {
  return gomokuCoordinate(row, col);
}
