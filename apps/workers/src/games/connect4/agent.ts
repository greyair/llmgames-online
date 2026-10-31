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
 * Connect 4 keeps the board as rows of digits plus the columns still open.
 *
 * The open columns are derived from the top row of the same board the model
 * reads, so the two can never disagree.
 */
export function connect4AgentDecision(view: ProjectionPart, legalActions: readonly string[]) {
  const state = view;
  const seats = projectionPart(state.seats);
  const board = encodeNumericBoard(state.board);
  const top = board?.[0];

  return agentFields({
    board,
    boardFormat: board ? BOARD_FORMAT : undefined,
    yourSeat: seatFor(seats, stringValue(projectionPart(state.you)?.playerId)),
    currentSeat: seatFor(seats, stringValue(projectionPart(state.turnState)?.currentPlayerId)),
    winnerSeat: winnerForSeats(state, seats),
    lastMove: state.lastMove,
    legalColumns:
      top && legalActions.includes("drop_disc")
        ? [...top].flatMap((cell, col) => (cell === "0" ? [col] : []))
        : [],
  });
}
