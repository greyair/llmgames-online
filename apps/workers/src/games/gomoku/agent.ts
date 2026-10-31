import {
  agentFields,
  encodeNumericBoard,
  projectionPart,
  seatFor,
  stringValue,
  winnerForSeats,
  type ProjectionPart,
  type WireObject,
} from "@llmgames/game-catalog";

import { GOMOKU_SIZE, gomokuCoordinate, gomokuProjectedBoard, gomokuWinningCells } from "./rules";

const BOARD_FORMAT =
  "15 rows top-to-bottom, 15 columns left-to-right; 0 empty, 1 black (seat 1, moves first), 2 white (seat 2). Place with { row, col }.";

/**
 * Gomoku's compact decision state.
 *
 * The board is public, so the whole grid ships — but 15×15 of nested numbers is
 * 225 tokens of punctuation for a model that only needs the digits. Rows become
 * strings, and the two lists a model actually reasons about (its own immediate
 * wins and the opponent's) are precomputed instead of making it rescan 225
 * points on every turn. Empty points are derivable from the board, so they are
 * not repeated.
 */
export function gomokuAgentDecision(
  view: ProjectionPart,
  legalActions: readonly string[],
): WireObject {
  const state = view;
  const seats = projectionPart(state.seats);
  const board = encodeNumericBoard(state.board);
  const cells = gomokuProjectedBoard.parse(state.board);
  const you = seatFor(seats, stringValue(projectionPart(state.you)?.playerId));
  const canPlace = legalActions.includes("place_stone") && state.status === "playing";
  const seat: 1 | 2 | null = you === 1 || you === 2 ? you : null;

  const winning =
    canPlace && seat && cells.length === GOMOKU_SIZE
      ? gomokuWinningCells(cells, seat).map((point) => gomokuCoordinate(point.row, point.col))
      : [];

  const blocking =
    canPlace && seat && cells.length === GOMOKU_SIZE
      ? gomokuWinningCells(cells, seat === 1 ? 2 : 1).map((point) =>
          gomokuCoordinate(point.row, point.col),
        )
      : [];

  return agentFields({
    board,
    boardFormat: board ? BOARD_FORMAT : undefined,
    yourSeat: seat ?? undefined,
    currentSeat: seatFor(seats, stringValue(projectionPart(state.turnState)?.currentPlayerId)),
    winnerSeat: winnerForSeats(state, seats),
    lastMove: state.lastMove,
    winLine: state.winLine,
    winningMoves: winning,
    blockingMoves: blocking,
  });
}
