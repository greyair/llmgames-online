import {
  agentFields,
  numberValue,
  projectionPart,
  seatFor,
  stringValue,
  winnerForSeats,
  type ProjectionPart,
  type WireObject,
} from "@llmgames/game-catalog";
import { z } from "zod";

import { XIANGQI_FILES, XIANGQI_RANKS, glyphOf, squareName } from "./rules";

const boardSchema = z.array(z.string()).catch([]);

const movesSchema = z.array(z.string()).catch([]);

const flagsSchema = z.boolean().catch(false);

/**
 * The board as ten rows, rank 9 (Black's back rank) first.
 *
 * A 90-cell array of empty strings is 90 tokens of punctuation. Rows of one
 * character per point — `.` for empty, 車 for a Red chariot, 車 for Black's —
 * are the same board in a shape a model can read at a glance. Red and Black
 * share a character for several pieces, so the case of the *letter* is what the
 * legend below keys on, not the glyph.
 */
function rowsOf(board: readonly string[]): string[] {
  const rows: string[] = [];

  for (let rank = XIANGQI_RANKS - 1; rank >= 0; rank -= 1) {
    const cells: string[] = [];

    for (let file = 0; file < 9; file += 1) {
      const piece = board[rank * 9 + file] ?? "";

      cells.push(piece === "" ? "." : piece);
    }

    rows.push(`${rank} ${cells.join(" ")}`);
  }

  return rows;
}

const BOARD_FORMAT = `10 rows, rank 9 (Black's back rank) first, files ${XIANGQI_FILES.split("").join(" ")} left to right from Red's side. One character per point, "." empty. Uppercase = Red (seat 1), lowercase = Black (seat 2). K/k general, A/a advisor, B/b elephant, N/n horse, R/r chariot, C/c cannon, P/p soldier.`;

/**
 * Xiangqi's compact decision state.
 *
 * Everything is public, so nothing is withheld. The useful work is turning the
 * board into readable rows and shipping the legal move list already generated:
 * hobby-horse legs, cannon screens and the flying-general rule are exactly the
 * things a model gets wrong when it has to derive them.
 */
export function xiangqiAgentDecision(
  view: ProjectionPart,
  legalActions: readonly string[],
): WireObject {
  const seats = projectionPart(view.seats);
  const board = boardSchema.parse(view.board);
  const legal = movesSchema.parse(view.legal);
  const turn = stringValue(view.turn) ?? "r";
  const check = flagsSchema.parse(view.check);
  const checkSquare = numberValue(view.checkSquare);
  const plies = numberValue(view.plies) ?? 0;
  const quiet = numberValue(view.quiet) ?? 0;
  const last = projectionPart(view.last);
  const result = projectionPart(view.result);
  const you = seatFor(seats, stringValue(projectionPart(view.you)?.playerId));
  const current = seatFor(seats, stringValue(projectionPart(view.turnState)?.currentPlayerId));
  const captured = z.array(z.string()).catch([]).parse(view.captured);

  return agentFields({
    boardFormat: board.length === 0 ? undefined : BOARD_FORMAT,
    board: board.length === 0 ? undefined : rowsOf(board),
    yourSeat: you,
    yourSide: you === 1 ? "red" : you === 2 ? "black" : undefined,
    turn,
    sideToMove: turn === "r" ? "red" : "black",
    yourTurn: current !== undefined && current === you,
    plies,
    quiet,
    quietLimit: 120,
    check,
    checkSquare: checkSquare === undefined ? undefined : squareName(checkSquare),
    lastMove: last?.text ? `${stringValue(last.text) ?? ""} (${stringValue(last.iccs) ?? ""})` : undefined,
    captured: captured.map((piece) => glyphOf(piece)),
    legalMoves: legal,
    legalCount: legal.length,
    canMove: legalActions.includes("move"),
    ending: result
      ? `${stringValue(result.reason) ?? "ended"}: ${stringValue(result.winner) ?? "draw"}`
      : undefined,
    winnerSeat: winnerForSeats(view, seats),
  });
}
