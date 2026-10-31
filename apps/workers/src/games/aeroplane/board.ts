/**
 * Board arithmetic for 飞行棋 (Aeroplane Chess), ported from West Window's
 * `aeroplane-board.ts` (MIT, SerenQi).
 *
 * Only what the rules need lives here. The 15×15 cell coordinates the board is
 * drawn from stay in the browser component: the server never draws, and shipping
 * 52 lattice points across the wire would buy nothing.
 *
 * Progress of one plane of colour `c`:
 *
 * ```text
 *  -1      hangar (机场)
 *   0      take-off square (起飞点)
 *   1..52  loop square, global index g = (13c + p - 1) mod 52
 *   53..58 home column (跑道) steps 1..6
 *   59     the centre (终点): home
 * ```
 *
 * Every fourth loop square carries its owner's colour, which is what the jump
 * rule keys off: a move ending on one of them jumps four more. Step 52 is the
 * owner's own arm tip — its entrance to the home column — and is exempt.
 */

export const AEROPLANE_LOOP = 52;

export const AEROPLANE_ENTRY = 52;

/** First home-column step, one past the loop. */
export const AEROPLANE_COLUMN_FIRST = 53;

export const AEROPLANE_CENTRE = 59;

export const AEROPLANE_FLY_FROM = 20;

export const AEROPLANE_FLY_TO = 32;

export const AEROPLANE_HANGAR = -1;

export const AEROPLANE_START = 0;

export const AEROPLANE_PLANES = 4;

/** Seat count and plane count a table must reach before the first roll. */
export const AEROPLANE_MIN_SEATS = 2;

export const AEROPLANE_MAX_SEATS = 4;

/** The four board colours, in colour-index order. */
export const AEROPLANE_COLOUR_NAMES = ["red", "yellow", "blue", "green"] as const;

export type AeroplaneWhere = "hangar" | "start" | "loop" | "column" | "done";

/**
 * Board colours for a table of `seats` players, in seat order.
 *
 * Two players take opposite corners so both still have a full board; three
 * leave the fourth colour unused.
 */
export function aeroplaneColours(seats: number): number[] {
  if (seats <= 2) return [0, 2];

  return [0, 1, 2, 3].slice(0, Math.min(seats, AEROPLANE_MAX_SEATS));
}

/** Global loop index 0..51 for a plane of `colour` at loop progress `p` (1..52). */
export function aeroplaneGlobal(colour: number, p: number): number {
  return (((13 * colour + p - 1) % AEROPLANE_LOOP) + AEROPLANE_LOOP) % AEROPLANE_LOOP;
}

/** Loop square number 1..52 shown to players, or null off the loop. */
export function aeroplaneSquare(colour: number, p: number): number | null {
  return isAeroplaneOnLoop(p) ? aeroplaneGlobal(colour, p) + 1 : null;
}

export function isAeroplaneOnLoop(p: number): boolean {
  return p >= 1 && p <= AEROPLANE_LOOP;
}

/** True when loop progress `p` sits on a square owned by its own colour. */
export function isAeroplaneOwnColour(p: number): boolean {
  return isAeroplaneOnLoop(p) && p % 4 === 0;
}

export function aeroplaneWhere(p: number): AeroplaneWhere {
  if (p < 0) return "hangar";

  if (p === 0) return "start";

  if (p <= AEROPLANE_LOOP) return "loop";

  return p < AEROPLANE_CENTRE ? "column" : "done";
}
