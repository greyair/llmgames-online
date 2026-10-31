import {
  agentFields,
  encodeNumericBoard,
  projectionPart,
  seatFor,
  stringValue,
  winnerForSeats,
  type ProjectionPart,
} from "@llmgames/game-catalog";

const BOARD_FORMAT =
  "zero-based rows top-to-bottom, columns left-to-right; 0 empty, 1 seat 1, 2 seat 2";

/**
 * Reversi keeps the discs, the running count and the legal moves of the seat
 * whose turn it is. A move list for a seat that cannot move is a trap, so it is
 * only emitted while `place_disc` is legal.
 */
export function reversiAgentDecision(view: ProjectionPart, legalActions: readonly string[]) {
  const state = view;
  const seats = projectionPart(state.seats);
  const board = encodeNumericBoard(state.board);

  return agentFields({
    board,
    boardFormat: board ? BOARD_FORMAT : undefined,
    yourSeat: seatFor(seats, stringValue(projectionPart(state.you)?.playerId)),
    currentSeat: seatFor(seats, stringValue(projectionPart(state.turnState)?.currentPlayerId)),
    winnerSeat: winnerForSeats(state, seats),
    lastMove: state.lastMove,
    scores: state.scores,
    legalMoves: legalActions.includes("place_disc") ? state.legalMoves : [],
    lastPass: state.lastPass,
  });
}
