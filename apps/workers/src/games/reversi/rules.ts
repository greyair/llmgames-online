import type { ReversiCell, ReversiMove } from "../../durable-objects/types";

/** Board geometry frozen by the public MCP contract: 8 × 8. */
export const REVERSI_SIZE = 8;

export const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

export function createInitialReversiBoard(): ReversiCell[][] {
  const board = Array.from({ length: REVERSI_SIZE }, () =>
    Array.from({ length: REVERSI_SIZE }, (): ReversiCell => 0),
  );

  board[3]![3] = 2;
  board[3]![4] = 1;
  board[4]![3] = 1;
  board[4]![4] = 2;

  return board;
}

export function isOnReversiBoard(row: number, col: number): boolean {
  return row >= 0 && row < REVERSI_SIZE && col >= 0 && col < REVERSI_SIZE;
}

/** Discs flipped by placing `seat` at (row, col); empty when the move is illegal. */
export function getReversiFlips(
  board: ReversiCell[][],
  row: number,
  col: number,
  seat: 1 | 2,
): Array<{ row: number; col: number }> {
  if (!isOnReversiBoard(row, col) || board[row]?.[col] !== 0) return [];

  const opponent: 1 | 2 = seat === 1 ? 2 : 1;
  const flips: Array<{ row: number; col: number }> = [];

  for (const [dr, dc] of DIRECTIONS) {
    const line: Array<{ row: number; col: number }> = [];
    let r = row + dr;
    let c = col + dc;

    while (isOnReversiBoard(r, c) && board[r]?.[c] === opponent) {
      line.push({ row: r, col: c });
      r += dr;
      c += dc;
    }

    if (line.length > 0 && isOnReversiBoard(r, c) && board[r]?.[c] === seat) {
      flips.push(...line);
    }
  }

  return flips;
}

export function getReversiLegalMoves(board: ReversiCell[][], seat: 1 | 2): ReversiMove[] {
  const moves: ReversiMove[] = [];

  for (let row = 0; row < REVERSI_SIZE; row++) {
    for (let col = 0; col < REVERSI_SIZE; col++) {
      const flipCount = getReversiFlips(board, row, col, seat).length;

      if (flipCount > 0) moves.push({ row, col, flipCount });
    }
  }

  return moves;
}

export function applyReversiMove(
  board: ReversiCell[][],
  row: number,
  col: number,
  seat: 1 | 2,
): Array<{ row: number; col: number }> {
  const flips = getReversiFlips(board, row, col, seat);

  if (flips.length === 0) return [];
  board[row]![col] = seat;

  for (const cell of flips) board[cell.row]![cell.col] = seat;

  return flips;
}

export function countReversiDiscs(board: ReversiCell[][]): Record<1 | 2, number> {
  const scores: Record<1 | 2, number> = { 1: 0, 2: 0 };

  for (const row of board) {
    for (const cell of row) {
      if (cell === 1 || cell === 2) scores[cell]++;
    }
  }

  return scores;
}
