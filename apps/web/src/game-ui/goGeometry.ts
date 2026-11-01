/**
 * Go board geometry (C2 follow-up).
 *
 * The board used to be a fixed 9×9 drawing: one CELL, one 380-unit viewBox and
 * five star points. Once `go.size` became a room option the server could open
 * a 13×13 or 19×19 room, but the viewBox stayed at nine columns, so every
 * point past column 8 was drawn outside the canvas — invisible and unclickable.
 *
 * Keeping the maths here (rather than inline in the component) makes the
 * three sizes testable without a browser.
 */

/** Grid spacing in SVG units; the whole board scales from this. */
export const GO_CELL = 40;

/** Padding between the outermost line and the board edge. */
export const GO_MARGIN = 30;

/** Coordinate of one grid index, in SVG units. */
export function goPointAt(index: number): number {
  return GO_MARGIN + index * GO_CELL;
}

/** Side length of the square viewBox that holds a size×size board. */
export function goExtent(size: number): number {
  return (size - 1) * GO_CELL + GO_MARGIN * 2;
}

/**
 * Star points for a board size, in grid coordinates.
 *
 * 9×9 uses the five-point pattern, 13×13 the five-point one at the fourth line,
 * 19×19 the standard nine. Any other size gets none rather than a wrong guess.
 */
export function goStars(size: number): ReadonlyArray<readonly [number, number]> {
  if (size === 9)
    return [
      [2, 2],
      [6, 2],
      [4, 4],
      [2, 6],
      [6, 6],
    ];

  if (size === 13)
    return [
      [3, 3],
      [9, 3],
      [6, 6],
      [3, 9],
      [9, 9],
    ];

  if (size === 19)
    return [
      [3, 3],
      [9, 3],
      [15, 3],
      [3, 9],
      [9, 9],
      [15, 9],
      [3, 15],
      [9, 15],
      [15, 15],
    ];

  return [];
}
