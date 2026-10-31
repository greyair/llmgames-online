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
  "zero-based rows top-to-bottom, columns left-to-right; 0 empty, 1 black man, 2 white man, 3 black king, 4 white king; seat 1 black moves toward row 0, seat 2 white toward row 7; kings move both ways";

/**
 * Checkers needs the piece legend in the state itself: the numbers mean
 * different things than they do on the other two boards, and a model that
 * guesses will move the wrong colour.
 */
export function checkersAgentDecision(view: ProjectionPart, legalActions: readonly string[]) {
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
    forcedPiece: state.forcedPiece,
    quietTurns: state.quietTurns,
    legalMoves: legalActions.includes("move_checker") ? state.legalMoves : [],
  });
}
