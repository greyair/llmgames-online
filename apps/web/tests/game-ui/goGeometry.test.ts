import { describe, expect, it } from "vitest";

import { GO_CELL, GO_MARGIN, goExtent, goPointAt, goStars } from "../../src/game-ui/goGeometry";

/**
 * `go.size` became a room option (9 / 13 / 19), so the board drawing has to
 * follow the size. Before this file existed the viewBox was pinned to nine
 * columns, which drew every point past column 8 outside the canvas.
 */
describe("go board geometry", () => {
  it("keeps the 9×9 board exactly where it was", () => {
    expect(goExtent(9)).toBe(380);
    expect(goPointAt(0)).toBe(GO_MARGIN);
    expect(goPointAt(8)).toBe(GO_MARGIN + 8 * GO_CELL);
  });

  it("grows the canvas with the board so no point falls outside", () => {
    for (const size of [9, 13, 19]) {
      const extent = goExtent(size);
      const last = goPointAt(size - 1);

      // The outermost line must still leave the margin visible inside the box.
      expect(last).toBe(extent - GO_MARGIN);
      expect(extent).toBe((size - 1) * GO_CELL + GO_MARGIN * 2);
    }

    // The old fixed 380-unit viewBox is why 13 and 19 were clipped.
    expect(goPointAt(18)).toBeGreaterThan(goExtent(9));
  });

  it("places a full set of star points on the offered sizes", () => {
    const nine = goStars(9);
    const thirteen = goStars(13);
    const nineteen = goStars(19);

    expect(nine).toHaveLength(5);
    expect(nine).toContainEqual([4, 4]);
    expect(thirteen).toHaveLength(5);
    expect(thirteen).toContainEqual([6, 6]);
    expect(nineteen).toHaveLength(9);
    expect(nineteen).toContainEqual([9, 9]);

    for (const [size, stars] of [
      [9, nine],
      [13, thirteen],
      [19, nineteen],
    ] as const)
      for (const [x, y] of stars) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(size);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(size);
      }
  });

  it("draws no star points on a size it does not know", () => {
    expect(goStars(11)).toEqual([]);
  });
});
