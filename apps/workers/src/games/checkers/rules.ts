import type { CheckersCell, CheckersMove } from "../../durable-objects/types";

/** Board geometry frozen by the public MCP contract: 8 × 8, dark squares playable. */
export const CHECKERS_SIZE = 8;

/** Turns without a capture or a man move before the match is drawn. */
export const CHECKERS_QUIET_TURN_LIMIT = 80;

/** How often one position (side to move included) may repeat. */
export const CHECKERS_REPETITION_LIMIT = 3;

export function createInitialCheckersBoard(): CheckersCell[][] {
  return Array.from({ length: CHECKERS_SIZE }, (_, row) =>
    Array.from({ length: CHECKERS_SIZE }, (_, col) =>
      (row + col) % 2 === 0 ? 0 : row < 3 ? 2 : row > 4 ? 1 : 0,
    ),
  );
}

/** Owning seat of a piece: 1 black, 2 white, 0 empty. Kings are 3 and 4. */
export function checkersSeat(piece: number): 0 | 1 | 2 {
  return piece === 1 || piece === 3 ? 1 : piece === 2 || piece === 4 ? 2 : 0;
}

export function countCheckersPieces(board: CheckersCell[][]): Record<1 | 2, number> {
  const scores: Record<1 | 2, number> = { 1: 0, 2: 0 };

  for (const row of board)
    for (const piece of row) {
      const seat = checkersSeat(piece);

      if (seat) scores[seat]++;
    }

  return scores;
}

/** Return one-step intents. A capture chain is locked to its current piece. */
export function getCheckersLegalMoves(
  board: CheckersCell[][],
  seat: 1 | 2,
  forcedPiece: { row: number; col: number } | null = null,
): CheckersMove[] {
  const captures: CheckersMove[] = [],
    steps: CheckersMove[] = [];

  for (let fromRow = 0; fromRow < CHECKERS_SIZE; fromRow++)
    for (let fromCol = 0; fromCol < CHECKERS_SIZE; fromCol++) {
      const piece = board[fromRow]![fromCol]!;

      if (
        checkersSeat(piece) !== seat ||
        (forcedPiece && (forcedPiece.row !== fromRow || forcedPiece.col !== fromCol))
      )
        continue;

      for (const dr of piece > 2 ? [-1, 1] : [seat === 1 ? -1 : 1])
        for (const dc of [-1, 1]) {
          const row = fromRow + dr,
            col = fromCol + dc;

          if (board[row]?.[col] === 0 && !forcedPiece)
            steps.push({ fromRow, fromCol, row, col, capture: null });
          const other = checkersSeat(board[row]?.[col] ?? 0);

          if (other && other !== seat && board[row + dr]?.[col + dc] === 0)
            captures.push({
              fromRow,
              fromCol,
              row: row + dr,
              col: col + dc,
              capture: { row, col },
            });
        }
    }

  return captures.length ? captures : steps;
}

/** Position key used for repetition detection; includes the side to move. */
export function checkersPositionKey(board: CheckersCell[][], seat: 1 | 2): string {
  return `${seat}:${board.flat().join("")}`;
}

/** Promotion row for a seat: black crowns at row 0, white at row 7. */
export function checkersPromotionRow(seat: 1 | 2): number {
  return seat === 1 ? 0 : 7;
}
