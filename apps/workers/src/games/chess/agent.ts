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

import { FILES, material, squareName } from "./rules";

const boardSchema = z.string().catch("");

const movesSchema = z.array(z.string()).catch([]);

const flagsSchema = z.boolean().catch(false);

/**
 * One rank of the board, files a-h, with "." for an empty square: `r n b q k b n r`.
 *
 * A 64-character string is unreadable at a glance and easy to miscount; eight
 * spaced rows are the same information in a shape a model can actually scan.
 */
function rankLines(board: string): string[] {
  const rows: string[] = [];

  for (let rank = 0; rank < 8; rank++) {
    const row = board.slice(rank * 8, rank * 8 + 8).split("");

    rows.push(`${8 - rank} ${row.join(" ")}`);
  }

  return rows;
}

const BOARD_FORMAT = `8 rows, rank 8 first; files ${FILES.split("").join(" ")}. Uppercase PNBRQK are White (seat 1), lowercase are Black (seat 2), "." is empty.`;

/**
 * Chess's compact decision state.
 *
 * Everything on a chessboard is public, so nothing is withheld. What a model
 * needs instead of the raw grid is the situation: whose move it is, whether
 * anyone is in check, what the last move was and — the expensive part — the
 * legal moves already worked out, so it never has to derive castling rights or
 * pin geometry on its own.
 */
export function chessAgentDecision(view: ProjectionPart, legalActions: readonly string[]): WireObject {
  const seats = projectionPart(view.seats);
  const board = boardSchema.parse(view.board);
  const turn = stringValue(view.turn) ?? "w";
  const legal = movesSchema.parse(view.legal);
  const check = flagsSchema.parse(view.check);
  const castling = stringValue(view.castling) ?? "";
  const ep = numberValue(view.ep);
  const halfmove = numberValue(view.halfmove) ?? 0;
  const fullmove = numberValue(view.fullmove) ?? 1;
  const last = projectionPart(view.last);
  const result = projectionPart(view.result);
  const you = seatFor(seats, stringValue(projectionPart(view.you)?.playerId));
  const current = seatFor(seats, stringValue(projectionPart(view.turnState)?.currentPlayerId));
  const tally = material(board);

  return agentFields({
    boardFormat: board ? BOARD_FORMAT : undefined,
    board: board ? rankLines(board) : undefined,
    fen: stringValue(view.fen),
    yourSeat: you,
    yourColor: you === 1 ? "white" : you === 2 ? "black" : undefined,
    turn,
    sideToMove: turn === "w" ? "white" : "black",
    yourTurn: current !== undefined && current === you,
    fullmove,
    halfmove,
    castling: castling || undefined,
    enPassant: ep === null || ep === undefined ? undefined : squareName(ep),
    check,
    checkSquare: numberValue(view.checkSquare),
    material: { white: tally.w, black: tally.b },
    captured: projectionPart(view.captured),
    lastMove: last?.san ? `${last.san} (${stringValue(last.uci) ?? ""})` : undefined,
    legalMoves: legal,
    legalCount: legal.length,
    /** Castling and promotions are the two moves a model most often mangles. */
    specialMoves: legal.filter((uci) => uci.length > 4 || isCastle(uci)),
    canMove: legalActions.includes("move"),
    ending: result ? `${stringValue(result.reason) ?? "ended"}: ${stringValue(result.winner) ?? "draw"}` : undefined,
    winnerSeat: winnerForSeats(view, seats),
  });
}

/** A king moving two squares along its own rank, which is what castling looks like in UCI. */
function isCastle(uci: string): boolean {
  const from = uci.slice(0, 2).toLowerCase();
  const to = uci.slice(2, 4).toLowerCase();

  return (
    (from === "e1" && (to === "g1" || to === "c1")) || (from === "e8" && (to === "g8" || to === "c8"))
  );
}
