import { describe, expect, it } from "vitest";
import {
  latestRoundShots,
  latestShotSequence,
  scoreForPlayer,
  type ScoreShot,
} from "../../src/features/battleship/score";

function shot(sequence: number, overrides: Partial<ScoreShot> = {}): ScoreShot {
  return {
    sequence,
    hit: false,
    byPlayerId: "p1",
    row: sequence % 10,
    col: sequence % 10,
    ...overrides,
  };
}

describe("Battleship shot windows", () => {
  it("detects a new shot after the server's 40-entry window slides", () => {
    const firstWindow = Array.from({ length: 40 }, (_, index) => shot(index + 1));
    const previousSequence = latestShotSequence(firstWindow);
    const nextWindow = Array.from({ length: 40 }, (_, index) => shot(index + 2));

    expect(latestRoundShots(nextWindow, previousSequence)).toEqual([shot(41)]);
  });

  it("keeps scoring sink bonuses for a full cumulative log fallback", () => {
    expect(
      scoreForPlayer(
        [shot(1, { hit: true }), shot(2, { hit: true, sunkShipId: "destroyer" })],
        "p1",
      ),
    ).toBe(60);
  });
});

it("scores the current 22-cell fleet consistently with the server", () => {
  const sizes = { carrier: 6, dreadnought: 5, cruiser: 4, submarine: 4, destroyer: 3 };

  const shots = Object.entries(sizes).flatMap(([id, length]) =>
    Array.from({ length }, (_, index) =>
      shot(index + 1, { hit: true, sunkShipId: index === length - 1 ? id : undefined }),
    ),
  );

  expect(scoreForPlayer(shots, "p1")).toBe(455);
  expect(scoreForPlayer(shots, "p2")).toBe(0);
});
