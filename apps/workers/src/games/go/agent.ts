import {
  agentFields,
  isNumber,
  numberValue,
  projectionPart,
  seatFor,
  stringValue,
  winnerForSeats,
  type ProjectionPart,
  type WireObject,
} from "@llmgames/game-catalog";
import { z } from "zod";

import { GO_COLUMNS, GO_EMPTY, isColor, toGtp, type GoColor } from "./rules";

const cellsSchema = z.array(z.number()).catch([]);

const numbersSchema = z.array(z.number()).catch([]);

const lastSchema = z
  .object({
    color: z.number().optional(),
    kind: z.string().optional(),
    point: z.number().nullable().optional(),
  })
  .catch({});

/**
 * The board as `size` rows, top rank first, one character per intersection.
 *
 * `X` black, `O` white, `.` empty. A row is prefixed with its GTP rank number so
 * a model can name a point without counting — on 9×9, row "9" is the top.
 */
function rowsOf(cells: readonly number[], size: number): string[] {
  const rows: string[] = [];

  for (let row = 0; row < size; row += 1) {
    const marks: string[] = [];

    for (let col = 0; col < size; col += 1) {
      const cell = cells[row * size + col] ?? GO_EMPTY;

      marks.push(cell === GO_EMPTY ? "." : cell === 1 ? "X" : "O");
    }

    rows.push(`${size - row} ${marks.join(" ")}`);
  }

  return rows;
}

/**
 * Go's compact decision state.
 *
 * The board is public, so nothing is withheld. What a model cannot derive
 * cheaply is the legal-move set — suicide, captures and the superko make every
 * empty point a separate judgement — so it ships already worked out, and the
 * two phases are named plainly because "pass twice, then mark dead stones and
 * accept" is the step people (and models) get wrong.
 */
export function goAgentDecision(view: ProjectionPart): WireObject {
  const seats = projectionPart(view.seats);
  const cells = cellsSchema.parse(view.cells);
  const size = numberValue(view.boardSize) ?? 9;
  const turn = numberValue(view.turn) ?? 1;
  const stage = stringValue(view.stage) ?? "playing";
  const passes = numberValue(view.passes) ?? 0;
  const moves = numberValue(view.moves) ?? 0;
  const komi = numberValue(view.komi) ?? 7.5;
  const captures = numbersSchema.parse(view.captures);
  const dead = numbersSchema.parse(view.dead);
  const accepted = numbersSchema.parse(view.accepted);
  const last = lastSchema.parse(view.last);
  const score = projectionPart(view.score);
  const you = seatFor(seats, stringValue(projectionPart(view.you)?.playerId));
  const current = seatFor(seats, stringValue(projectionPart(view.turnState)?.currentPlayerId));
  const yourColor: GoColor | undefined = you === 1 ? 1 : you === 2 ? 2 : undefined;
  const color: GoColor = isColor(turn) ? turn : 1;

  // The projection already resolved legality, superko included.
  const playable = stage === "playing" ? z.array(z.string()).catch([]).parse(view.legal) : [];

  const columnHeader = `${"  "}${GO_COLUMNS.slice(0, size).split("").join(" ")}`;

  return agentFields({
    boardFormat:
      cells.length === 0
        ? undefined
        : `${size} rows, top rank first, columns ${GO_COLUMNS.slice(0, size).split("").join(" ")} (GTP: I is skipped). X black, O white, "." empty. Play with a GTP point such as D4, or pass.`,
    board: cells.length === 0 ? undefined : [columnHeader, ...rowsOf(cells, size)],
    boardSize: size,
    komi,
    yourSeat: you,
    yourColor: yourColor === 1 ? "black" : yourColor === 2 ? "white" : undefined,
    sideToMove: color === 1 ? "black" : "white",
    yourTurn: current !== undefined && current === you,
    stage,
    moves,
    passes,
    captures: { black: captures[1] ?? 0, white: captures[2] ?? 0 },
    legalMoves: playable,
    legalCount: playable.length,
    lastMove:
      last.kind === "pass"
        ? "pass"
        : last.kind === "play" && isNumber(last.point)
          ? toGtp(last.point, size)
          : undefined,
    deadStones: dead.map((point) => toGtp(point, size)),
    acceptedBy: accepted.map((value) => (value === 1 ? "black" : "white")),
    scoringHelp:
      stage === "scoring"
        ? "Mark dead chains with mark_dead { point }, then accept_score. A change to the marking clears both acceptances; resume_play goes back to playing."
        : undefined,
    score: score === null || score === undefined ? undefined : projectionPart(score),
    winnerSeat: winnerForSeats(view, seats),
  });
}
