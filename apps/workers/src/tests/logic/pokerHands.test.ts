import { z } from "zod";
import { describe, expect, it } from "vitest";

import { evaluateHoldem, type PokerCard } from "../../lib/pokerHands";

function cards(value: string): PokerCard[] {
  return value.split(" ").map((token) => ({
    rank: z
      .enum(["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"])
      .parse(token.slice(0, -1)),
    suit: z.enum(["S", "H", "D", "C"]).parse(token.slice(-1)),
  }));
}

describe("Texas Hold'em hand evaluation", () => {
  it.each([
    ["high card", "AS KH 9D 5C 2S", "high_card", [14, 13, 9, 5, 2]],
    ["pair", "AS AH KD 9C 2S", "pair", [14, 13, 9, 2]],
    ["two pair", "AS AH KD KC 2S", "two_pair", [14, 13, 2]],
    ["three of a kind", "10S 10H 10D AC KS", "three_of_a_kind", [10, 14, 13]],
    ["straight", "5S 6H 7D 8C 9S", "straight", [9]],
    ["flush", "AS JS 8S 4S 2S", "flush", [14, 11, 8, 4, 2]],
    ["full house", "QS QH QD 7C 7S", "full_house", [12, 7]],
    ["four of a kind", "9S 9H 9D 9C AS", "four_of_a_kind", [9, 14]],
    ["straight flush", "5H 6H 7H 8H 9H", "straight_flush", [9]],
    ["royal flush", "10C JC QC KC AC", "royal_flush", [14]],
  ] as const)("recognizes a %s", (_name, encoded, category, ranks) => {
    const result = evaluateHoldem(cards(encoded));

    expect(result.category).toBe(category);
    expect(result.ranks).toEqual(ranks);
  });

  it("uses the best five cards from a seven-card Hold'em hand", () => {
    const result = evaluateHoldem(cards("AS AH 2D 3C 4S 5H KD"));

    expect(result.category).toBe("straight");
    expect(result.ranks).toEqual([5]);
  });

  it("orders wheel straights below six-high straights", () => {
    const wheel = evaluateHoldem(cards("AS 2H 3D 4C 5S"));
    const sixHigh = evaluateHoldem(cards("2S 3H 4D 5C 6S"));

    expect(wheel.category).toBe("straight");
    expect(wheel.ranks).toEqual([5]);
    expect(sixHigh.score).toBeGreaterThan(wheel.score);
  });

  it("uses kickers to break ties within the same category", () => {
    const acePair = evaluateHoldem(cards("AS AH KD 9C 2S"));
    const kingPair = evaluateHoldem(cards("KS KH AD 9C 2S"));
    const betterFlush = evaluateHoldem(cards("AS JS 8S 4S 2S"));
    const weakerFlush = evaluateHoldem(cards("AH 10H 8H 4H 2H"));

    expect(acePair.score).toBeGreaterThan(kingPair.score);
    expect(betterFlush.score).toBeGreaterThan(weakerFlush.score);
  });

  it("returns an incomplete result instead of inventing a five-card hand", () => {
    const result = evaluateHoldem(cards("AS KH"));

    expect(result).toMatchObject({ category: "high_card", score: 0, label: "Incomplete" });
    expect(result.ranks).toEqual([14, 13]);
  });
});
