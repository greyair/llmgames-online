import type { Connect4Cell } from "../../durable-objects/types";

/** Board geometry frozen by the public MCP contract: 6 rows × 7 columns. */
export const CONNECT4_ROWS = 6;

export const CONNECT4_COLS = 7;

/** Winning run length. */
export const CONNECT4_WIN_LENGTH = 4;

export function emptyConnect4Board(): Connect4Cell[][] {
  return Array.from({ length: CONNECT4_ROWS }, () =>
    Array.from({ length: CONNECT4_COLS }, (): Connect4Cell => 0),
  );
}

/** Drop a disc into `col` for `seat`; returns the landing row, or null when full/off-board. */
export function dropInColumn(board: Connect4Cell[][], col: number, seat: 1 | 2): number | null {
  if (col < 0 || col >= CONNECT4_COLS) return null;

  for (let row = CONNECT4_ROWS - 1; row >= 0; row--) {
    if (board[row]![col] === 0) {
      board[row]![col] = seat;

      return row;
    }
  }

  return null;
}

export function hasConnect4(board: Connect4Cell[][], row: number, col: number): boolean {
  const seat = board[row]![col];

  if (!seat) return false;

  const directions: ReadonlyArray<readonly [number, number]> = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dr, dc] of directions) {
    let count = 1;

    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;

      while (
        r >= 0 &&
        r < CONNECT4_ROWS &&
        c >= 0 &&
        c < CONNECT4_COLS &&
        board[r]![c] === seat
      ) {
        count++;
        r += dr * sign;
        c += dc * sign;
      }
    }

    if (count >= CONNECT4_WIN_LENGTH) return true;
  }

  return false;
}

export function isConnect4BoardFull(board: Connect4Cell[][]): boolean {
  return board[0]!.every((cell) => cell !== 0);
}
