import { isString } from "@llmgames/game-catalog";
import { describe, expect, it } from "vitest";

import {
  DOUDIZHU_COMBOS,
  PAODEKUAI_COMBOS,
  beats,
  classify,
  describeCombo,
  type Combo,
} from "../../../games/cards/combo";
import {
  BIG_JOKER,
  SMALL_JOKER,
  cardRank,
  cardText,
  doudizhuDeck,
  paodekuaiDeck,
  pickCards,
  sortCards,
} from "../../../games/cards/deck";

function read(cards: string[], rules = PAODEKUAI_COMBOS): Combo | string {
  return classify(cards, rules);
}

/** True when the cards are not a combination either game allows. */
function refused(cards: string[], rules = PAODEKUAI_COMBOS): boolean {
  return isString(read(cards, rules));
}

function combo(cards: string[], rules = PAODEKUAI_COMBOS): Combo {
  const result = classify(cards, rules);

  if (isString(result)) throw new Error(`not a combination: ${result}`);

  return result;
}

describe("Card deck", () => {
  it("deals 48 cards for Run Fast: no jokers, three deuces and the spade ace removed", () => {
    const deck = paodekuaiDeck();

    expect(deck).toHaveLength(48);
    expect(new Set(deck).size).toBe(48);
    expect(deck).not.toContain("H2");
    expect(deck).not.toContain("C2");
    expect(deck).not.toContain("D2");
    expect(deck).not.toContain("SA");
    expect(deck).toContain("S2");
  });

  it("deals 54 cards for Dou Dizhu, jokers included", () => {
    const deck = doudizhuDeck();

    expect(deck).toHaveLength(54);
    expect(deck).toContain(SMALL_JOKER);
    expect(deck).toContain(BIG_JOKER);
  });

  it("ranks 3 low, 2 above the ace, and the jokers above everything", () => {
    expect(cardRank("S3")).toBe(0);
    expect(cardRank("SK")).toBe(10);
    expect(cardRank("SA")).toBe(11);
    expect(cardRank("S2")).toBe(12);
    expect(cardRank(SMALL_JOKER)).toBe(13);
    expect(cardRank(BIG_JOKER)).toBe(14);
  });

  it("sorts weakest first and keeps suits in a stable order inside a rank", () => {
    expect(sortCards(["S5", "H3", "D3", "C3"])).toEqual(["H3", "C3", "D3", "S5"]);
  });

  it("labels cards for messages", () => {
    expect(cardText("S3")).toBe("♠3");
    expect(cardText("HT")).toBe("♥10");
    expect(cardText(BIG_JOKER)).toBe("J2");
  });
});

describe("Card requests", () => {
  const hand = ["S3", "H3", "C3", "S4", "HT"];

  it("resolves bare ranks to the weakest suits in hand", () => {
    expect(pickCards(hand, "3 3")).toEqual(["S3", "H3"]);
  });

  it("accepts exact card ids and the T/10 spelling", () => {
    expect(pickCards(hand, "S3")).toEqual(["S3"]);
    expect(pickCards(hand, "10")).toEqual(["HT"]);
  });

  it("refuses a rank the hand does not hold enough of", () => {
    expect(pickCards(hand, "4 4")).toBe("You only hold 1 × 4");
  });

  it("refuses an unknown token", () => {
    expect(pickCards(hand, "3 Z")).toBe("Not a card: Z");
  });
});

describe("Card shapes", () => {
  it("recognises the fixed shapes", () => {
    expect(read(["S3"])).toMatchObject({ kind: "single", size: 1, key: 0 });
    expect(read(["S3", "H3"])).toMatchObject({ kind: "pair", size: 2, key: 0 });
    expect(read(["S3", "H3", "C3"])).toMatchObject({ kind: "triple", size: 3 });
    expect(read(["S3", "H3", "C3", "S4"])).toMatchObject({ kind: "triple_one", size: 4 });
    expect(read(["S3", "H3", "C3", "S4", "H4"])).toMatchObject({
      kind: "triple_pair",
      size: 5,
    });
  });

  it("treats four of a kind as a bomb", () => {
    expect(read(["S3", "H3", "C3", "D3"])).toMatchObject({ kind: "bomb", key: 0 });
  });

  it("needs five consecutive ranks for a straight and stops at the ace", () => {
    expect(read(["S3", "H4", "C5", "D6", "S7"])).toMatchObject({ kind: "straight", len: 5 });
    expect(read(["S3", "H4", "C5", "D6"])).toBe("That combination is not a shape this game allows");
    expect(refused(["SJ", "HQ", "CK", "DA", "S2"])).toBe(true);
  });

  it("takes pair runs from two pairs in Run Fast and three in Dou Dizhu", () => {
    const twoPairs = ["S3", "H3", "S4", "H4"];

    expect(read(twoPairs)).toMatchObject({ kind: "pair_run", len: 2 });
    expect(refused(twoPairs, DOUDIZHU_COMBOS)).toBe(true);
    expect(read(["S3", "H3", "S4", "H4", "S5", "H5"], DOUDIZHU_COMBOS)).toMatchObject({
      kind: "pair_run",
      len: 3,
    });
  });

  it("builds planes bare, with singles and with pairs", () => {
    const body = ["S3", "H3", "C3", "S4", "H4", "C4"];

    expect(read(body)).toMatchObject({ kind: "plane", len: 2, key: 0 });
    expect(read([...body, "S7", "H8"])).toMatchObject({ kind: "plane_one", size: 8 });
    expect(read([...body, "S7", "H7", "S8", "H8"])).toMatchObject({
      kind: "plane_pair",
      size: 10,
    });
  });

  it("only offers four-with-two and the rocket where the rules allow them", () => {
    const four = ["S3", "H3", "C3", "D3", "S7", "H8"];
    const rocket = [SMALL_JOKER, BIG_JOKER];

    expect(refused(four)).toBe(true);
    expect(read(four, DOUDIZHU_COMBOS)).toMatchObject({ kind: "four_two", key: 0 });
    expect(refused(rocket)).toBe(true);
    expect(read(rocket, DOUDIZHU_COMBOS)).toMatchObject({ kind: "rocket" });
  });

  it("refuses a chain that skips a rank", () => {
    expect(refused(["S3", "H4", "C5", "D7", "S8"])).toBe(true);
  });
});

describe("Card comparison", () => {
  it("beats only the same shape and length with a higher key", () => {
    expect(beats(combo(["S4", "H4"]), combo(["S3", "H3"]))).toBe(true);
    expect(beats(combo(["S3", "H3"]), combo(["S4", "H4"]))).toBe(false);
    expect(beats(combo(["S4"]), combo(["S3", "H3"]))).toBe(false);
    expect(
      beats(combo(["S4", "H5", "C6", "D7", "S8"]), combo(["S3", "H4", "C5", "D6", "S7"])),
    ).toBe(true);
  });

  it("lets a bomb beat any non-bomb and a higher bomb beat a lower one", () => {
    const bomb3 = combo(["S3", "H3", "C3", "D3"]);
    const bomb5 = combo(["S5", "H5", "C5", "D5"]);

    expect(beats(bomb3, combo(["S3", "H4", "C5", "D6", "S7"]))).toBe(true);
    expect(beats(bomb5, bomb3)).toBe(true);
    expect(beats(bomb3, bomb5)).toBe(false);
    expect(beats(combo(["S9"]), bomb3)).toBe(false);
  });

  it("lets the rocket beat everything and nothing beat the rocket", () => {
    const rocket = combo([SMALL_JOKER, BIG_JOKER], DOUDIZHU_COMBOS);
    const bomb = combo(["S3", "H3", "C3", "D3"], DOUDIZHU_COMBOS);

    expect(beats(rocket, bomb)).toBe(true);
    expect(beats(bomb, rocket)).toBe(false);
  });

  it("describes a shape for messages", () => {
    expect(describeCombo(combo(["S3"]))).toBe("single 3");
    expect(describeCombo(combo(["S4", "H5", "C6", "D7", "S8"]))).toBe("straight 4–8");
  });
});
