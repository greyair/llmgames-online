import { z } from "zod";

import type { GomokuCell } from "../../durable-objects/types";

/**
 * Freestyle gomoku, ported from West Window's `gomoku.ts`.
 *
 * The source plays on a 15×15 board where five **or more** in a row wins and a
 * full board is a draw. That is the whole rule set: no forbidden moves, no
 * swap2 opening, no overline penalty. Keeping "or more" matters — a strict
 * "exactly five" rule would silently reject a legal overline win.
 */
export const GOMOKU_SIZE = 15;

export const GOMOKU_WIN_LENGTH = 5;

/** Columns of the source's GTP-style labels. `I` is skipped, as in Go. */
const GOMOKU_COLUMNS = "ABCDEFGHJKLMNOP";

/**
 * A projected board, parsed at the boundary.
 *
 * Digit rows reach here as JSON from another process, so the shape is checked
 * with a schema instead of trusted casts; anything that is not 0/1/2 reads as
 * an empty point rather than throwing a view away.
 */
export const gomokuProjectedBoard = z
  .array(z.array(z.number().int()))
  .catch([])
  .transform((rows) =>
    rows.map((row) => row.map((cell): GomokuCell => (cell === 1 ? 1 : cell === 2 ? 2 : 0))),
  );

export interface GomokuPoint {
  row: number;
  col: number;
}

/** Rows of four cells, so a board is addressable as `board[row][col]` everywhere. */
export function emptyGomokuBoard(): GomokuCell[][] {
  return Array.from({ length: GOMOKU_SIZE }, () =>
    Array.from({ length: GOMOKU_SIZE }, (): GomokuCell => 0),
  );
}

export function isGomokuPointOnBoard(row: number, col: number): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < GOMOKU_SIZE &&
    col >= 0 &&
    col < GOMOKU_SIZE
  );
}

/**
 * Human label for a point, in the source's coordinate system: column letter
 * (A–O, no I) and a row counted from the bottom.
 *
 * It exists so an agent that learned the game from West Window's rules text
 * reads the same squares here; structured actions still use zero-based row/col.
 */
export function gomokuCoordinate(row: number, col: number): string {
  return `${GOMOKU_COLUMNS[col] ?? "?"}${GOMOKU_SIZE - row}`;
}

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * The winning run through `(row, col)`, or null.
 *
 * Returns every stone of the run (not just five) so the board can highlight the
 * whole line even when the player connected six.
 */
export function gomokuWinLine(
  board: readonly (readonly GomokuCell[])[],
  row: number,
  col: number,
): GomokuPoint[] | null {
  const seat = board[row]?.[col];

  if (!seat) return null;

  for (const [dr, dc] of DIRECTIONS) {
    const line: GomokuPoint[] = [{ row, col }];

    for (const sign of [1, -1] as const) {
      let r = row + dr * sign;
      let c = col + dc * sign;

      while (r >= 0 && r < GOMOKU_SIZE && c >= 0 && c < GOMOKU_SIZE && board[r]![c] === seat) {
        line.push({ row: r, col: c });
        r += dr * sign;
        c += dc * sign;
      }
    }

    if (line.length >= GOMOKU_WIN_LENGTH) {
      // Sorted so the client can highlight a stable order, and so a test can
      // compare the line without caring which end the scan started from.
      return line.sort((a, b) => a.row - b.row || a.col - b.col);
    }
  }

  return null;
}

export function isGomokuBoardFull(board: readonly (readonly GomokuCell[])[]): boolean {
  return board.every((row) => row.every((cell) => cell !== 0));
}

export function countGomokuStones(board: readonly (readonly GomokuCell[])[]): number {
  return board.reduce((total, row) => total + row.filter((cell) => cell !== 0).length, 0);
}

/**
 * Empty points where `seat` would complete five immediately.
 *
 * The source exposes the same list to its AI ("you can win now at: …"), and it
 * is public information: both players can read the board and see the threat.
 */
export function gomokuWinningCells(
  board: readonly (readonly GomokuCell[])[],
  seat: 1 | 2,
): GomokuPoint[] {
  const points: GomokuPoint[] = [];

  for (let row = 0; row < GOMOKU_SIZE; row++) {
    for (let col = 0; col < GOMOKU_SIZE; col++) {
      if (board[row]![col] !== 0) continue;

      const probe = board.map((line) => [...line]);
      probe[row]![col] = seat;

      if (gomokuWinLine(probe, row, col)) points.push({ row, col });
    }
  }

  return points;
}
