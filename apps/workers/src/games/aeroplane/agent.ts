import { z } from "zod";
import {
  agentFields,
  isString,
  numberValue,
  projectionPart,
  seatFor,
  stringValue,
  winnerForSeats,
  type ProjectionPart,
  type WireObject,
} from "@llmgames/game-catalog";

import {
  AEROPLANE_CENTRE,
  AEROPLANE_COLOUR_NAMES,
  AEROPLANE_COLUMN_FIRST,
  aeroplaneSquare,
  aeroplaneWhere,
} from "./board";
import { countAeroplaneHome, planAeroplaneMove } from "./rules";

const BOARD_FORMAT =
  "boards[seat][plane-1] is a progress number: -1 hangar, 0 take-off square, 1-52 loop square, 53-58 home-column steps 1-6, 59 home.";

const MOVES_FORMAT =
  "one line per legal choice: '<verb> <plane> → <where> [HOME] [jump] [fly] [bounce] [capture <colour> <planes>]'. Send { plane }.";

/**
 * The projected table, decoded once at the I/O boundary.
 *
 * `ProjectionPart` carries every game field as `unknown`, so the whole board is
 * parsed here rather than probed field by field: a plane row that is not numbers
 * becomes an empty table instead of a half-read one.
 */
const planeRows = z.array(z.array(z.number())).catch([]);

const numberList = z.array(z.number()).catch([]);

/** Where a plane stands, in the fewest tokens that still disambiguate it. */
function placeLabel(colour: number, progress: number): string {
  const where = aeroplaneWhere(progress);

  if (where === "hangar") return "hangar";

  if (where === "start") return "takeoff";

  if (where === "loop") return `sq${aeroplaneSquare(colour, progress)}`;

  if (where === "column") return `runway${progress - AEROPLANE_COLUMN_FIRST + 1}`;

  return "home";
}

/**
 * Aeroplane Chess decision state.
 *
 * The board is fully public, so nothing is hidden — but 4 planes × 4 seats of
 * JSON objects costs a model most of its attention on punctuation. Progress
 * numbers keep each plane at a few characters, and the legal choices come with
 * their outcome already worked out: working out that landing on your own colour
 * jumps another four is exactly the arithmetic a model gets wrong.
 */
export function aeroplaneAgentDecision(
  view: ProjectionPart,
  _legalActions: readonly string[],
): WireObject {
  const seats = projectionPart(view.seats);
  const boards = planeRows.parse(view.planes);
  const colours = numberList.parse(view.colours);
  const takeoff = numberList.parse(view.takeoff);
  const roll = numberValue(view.roll) ?? null;
  const sixes = numberValue(view.sixes) ?? 0;
  const phase = stringValue(projectionPart(view.turnState)?.phase) ?? "roll";
  const turn = projectionPart(view.turnState);
  const you = seatFor(seats, stringValue(projectionPart(view.you)?.playerId));
  const current = seatFor(seats, stringValue(turn?.currentPlayerId));

  let moves: string[] = [];

  const seat: number | undefined = you === current ? you : undefined;

  if (seat !== undefined && view.status === "playing" && phase === "choose" && roll !== null) {
    const table = { colours, planes: boards, takeoff, roll, sixes };

    moves = (boards[seat] ?? []).flatMap((_progress: number, index: number) => {
      const plane = index + 1;
      const choice = planAeroplaneMove(table, seat, plane, roll);

      if (isString(choice)) return [];

      const colour = colours[seat] ?? 0;
      const parts = [placeLabel(colour, choice.to)];

      if (choice.kind === "launch") parts.splice(0, 1, "takeoff");

      if (choice.home) parts.push("HOME");

      if (choice.jump !== null) parts.push("jump");

      if (choice.fly !== null) parts.push("fly");

      if (choice.bounce) parts.push("bounce");

      if (choice.sentBack) parts.push("third6-reset");

      for (const victim of choice.captures)
        parts.push(`capture ${seatColour(victim.seat, colours)} ${victim.planes.join(",")}`);

      return [`${choice.kind === "launch" ? "launch" : "move"} ${plane} → ${parts.join(" ")}`];
    });
  }

  return agentFields({
    boards,
    boardFormat: boards.length ? BOARD_FORMAT : undefined,
    seats: colours.map(
      (colour, index) => `${index}:${AEROPLANE_COLOUR_NAMES[colour] ?? "unknown"}`,
    ),
    home: boards.map((planes) => countAeroplaneHome(planes)),
    takeoff,
    roll: roll ?? undefined,
    sixes: sixes || undefined,
    racesTo: boards.length ? AEROPLANE_CENTRE : undefined,
    yourSeat: you,
    moves,
    movesFormat: moves.length ? MOVES_FORMAT : undefined,
    winnerSeat: winnerForSeats(view, seats),
  });
}

function seatColour(seat: number, colours: readonly number[]): string {
  return ["red", "yellow", "blue", "green"][colours[seat] ?? 0] ?? "unknown";
}
