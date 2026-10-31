/**
 * Rule arithmetic for 飞行棋 (Aeroplane Chess), ported from West Window's
 * `aeroplane.ts` (MIT, SerenQi).
 *
 * Everything here answers "what would this roll do to this plane?" without
 * touching state: {@link planAeroplaneMove} returns either the full consequence
 * of a choice or the message that refuses it, so the plugin can both validate an
 * intent and list legal ones with one function.
 *
 * Two behaviours are worth knowing before changing anything:
 *
 * - Overshooting the centre **bounces** a plane back by the extra steps, so
 *   reaching home always needs the exact number.
 * - Each colour's step 20 is a fly square that jumps to step 32, and every own-
 *   colour loop square jumps four more. A move may chain one jump then one fly,
 *   never two of either, and never inside the home column.
 */

import {
  AEROPLANE_CENTRE,
  AEROPLANE_ENTRY,
  AEROPLANE_FLY_FROM,
  AEROPLANE_FLY_TO,
  AEROPLANE_HANGAR,
  AEROPLANE_PLANES,
  aeroplaneGlobal,
  isAeroplaneOnLoop,
  isAeroplaneOwnColour,
} from "./board";
import { isString } from "@llmgames/game-catalog";
import type { AeroplaneCaptures } from "../../durable-objects/types";

export interface AeroplanePlaneState {
  seat: number;
  colour: number;
  progress: number;
}

export interface AeroplaneTable {
  colours: readonly number[];
  planes: readonly (readonly number[])[];
  takeoff: readonly number[];
  roll: number | null;
  sixes: number;
}

export interface AeroplaneChoice {
  /** Which plane 1..4 this is, as players number them. */
  plane: number;
  kind: "launch" | "move";
  from: number;
  /** Where the roll lands the plane, before jump or fly and after a bounce. */
  land: number;
  jump: number | null;
  fly: number | null;
  /** Final progress, or the hangar when a third six sends it back. */
  to: number;
  bounce: boolean;
  home: boolean;
  sentBack: boolean;
  captures: AeroplaneCaptures[];
}

/** Planes of every other seat standing on loop square `g`. */
function planesOnSquare(table: AeroplaneTable, seat: number, g: number): AeroplaneCaptures[] {
  const victims: AeroplaneCaptures[] = [];

  table.planes.forEach((other, otherSeat) => {
    if (otherSeat === seat) return;

    const hit: number[] = [];

    other.forEach((progress, index) => {
      if (isAeroplaneOnLoop(progress) && aeroplaneGlobal(table.colours[otherSeat]!, progress) === g)
        hit.push(index + 1);
    });

    if (hit.length) victims.push({ seat: otherSeat, planes: hit });
  });

  return victims;
}

/**
 * What using `roll` on plane `n` would do, or the message that refuses it.
 *
 * The hangar and arrival checks come straight from the source; only the wording
 * is English, because the platform reports one message to every client.
 */
export function planAeroplaneMove(
  table: AeroplaneTable,
  seat: number,
  plane: number,
  roll: number,
): AeroplaneChoice | string {
  const from = table.planes[seat]?.[plane - 1];

  if (from === undefined) return `Plane number must be 1-${AEROPLANE_PLANES}`;

  if (from === AEROPLANE_CENTRE) return `Plane ${plane} is already home`;

  const sentBack = roll === 6 && table.sixes >= 3;

  if (from === AEROPLANE_HANGAR) {
    if (!table.takeoff.includes(roll))
      return table.takeoff.length > 1
        ? "A plane leaves the hangar on a 5 or a 6"
        : "A plane leaves the hangar on a 6";

    return {
      plane,
      kind: "launch",
      from,
      land: 0,
      jump: null,
      fly: null,
      to: sentBack ? AEROPLANE_HANGAR : 0,
      bounce: false,
      home: false,
      sentBack,
      captures: [],
    };
  }

  let land = from + roll;
  const bounce = land > AEROPLANE_CENTRE;

  if (bounce) land = 2 * AEROPLANE_CENTRE - land;

  let to = land;
  let jump: number | null = null;
  let fly: number | null = null;

  if (isAeroplaneOwnColour(land) && land !== AEROPLANE_ENTRY) {
    if (land === AEROPLANE_FLY_FROM) fly = AEROPLANE_FLY_TO;
    else {
      jump = land + 4;

      if (jump === AEROPLANE_FLY_FROM) fly = AEROPLANE_FLY_TO;
    }

    to = fly ?? jump ?? land;
  }

  if (sentBack) {
    return {
      plane,
      kind: "move",
      from,
      land,
      jump: null,
      fly: null,
      to: AEROPLANE_HANGAR,
      bounce,
      home: false,
      sentBack: true,
      captures: [],
    };
  }

  const captures = isAeroplaneOnLoop(to)
    ? planesOnSquare(table, seat, aeroplaneGlobal(table.colours[seat]!, to))
    : [];

  return {
    plane,
    kind: "move",
    from,
    land,
    jump,
    fly,
    to,
    bounce,
    home: to === AEROPLANE_CENTRE,
    sentBack: false,
    captures,
  };
}

/** Legal choices for `seat` with the roll already on the table. */
export function aeroplaneChoices(
  table: AeroplaneTable,
  seat: number,
  roll: number,
): AeroplaneChoice[] {
  const choices: AeroplaneChoice[] = [];

  for (let plane = 1; plane <= AEROPLANE_PLANES; plane += 1) {
    const choice = planAeroplaneMove(table, seat, plane, roll);

    if (!isString(choice)) choices.push(choice);
  }

  return choices;
}

export function countAeroplaneHome(planes: readonly number[]): number {
  return planes.filter((progress) => progress === AEROPLANE_CENTRE).length;
}

/** Steps still to fly before the plane may enter the home column. */
export function aeroplaneStepsToEntry(progress: number): number {
  if (progress < 0) return AEROPLANE_ENTRY + 7;

  if (progress >= AEROPLANE_ENTRY) return 0;

  return AEROPLANE_ENTRY - progress;
}
