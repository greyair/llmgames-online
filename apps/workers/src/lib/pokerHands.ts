/**
 * Texas Hold'em 7→5 hand evaluation.
 * Higher score wins; equal scores are ties.
 */

import type { CardRank, CardSuit } from "../durable-objects/types";

export interface PokerCard {
  rank: CardRank;
  suit: CardSuit;
}

const RANK_VAL: Record<CardRank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

type HandCategory =
  | "high_card"
  | "pair"
  | "two_pair"
  | "three_of_a_kind"
  | "straight"
  | "flush"
  | "full_house"
  | "four_of_a_kind"
  | "straight_flush"
  | "royal_flush";

export interface HandEval {
  category: HandCategory;
  score: number;
  label: string;
  ranks: number[];
}

const CAT: Record<HandCategory, number> = {
  high_card: 0,
  pair: 1,
  two_pair: 2,
  three_of_a_kind: 3,
  straight: 4,
  flush: 5,
  full_house: 6,
  four_of_a_kind: 7,
  straight_flush: 8,
  royal_flush: 9,
};

function combos<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];

  if (arr.length < k) return [];
  const [head, ...tail] = arr;
  const withHead = combos(tail, k - 1).map((c) => [head!, ...c]);
  const without = combos(tail, k);

  return [...withHead, ...without];
}

/** Pack category + up to 5 kickers into one comparable number */
function pack(category: number, kickers: number[]): number {
  let s = category * 1e10;
  const k = [...kickers].slice(0, 5);

  while (k.length < 5) k.push(0);

  for (let i = 0; i < 5; i++) {
    s += k[i]! * Math.pow(15, 4 - i);
  }

  return s;
}

/** Straight high card for exactly 5 distinct ranks, or null */
function fiveStraightHigh(vals: number[]): number | null {
  const u = [...new Set(vals)].sort((a, b) => a - b);

  if (u.length !== 5) return null;

  // Wheel A-2-3-4-5
  if (u[0] === 2 && u[1] === 3 && u[2] === 4 && u[3] === 5 && u[4] === 14) {
    return 5;
  }

  for (let i = 1; i < 5; i++) {
    if (u[i] !== u[0]! + i) return null;
  }

  return u[4]!;
}

function evalFive(cards: PokerCard[]): HandEval {
  const vals = cards.map((c) => RANK_VAL[c.rank]).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const flush = suits.every((s) => s === suits[0]);
  const sHigh = fiveStraightHigh(vals);
  const isStraight = sHigh != null;

  const counts = new Map<number, number>();

  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);

  const byCount = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];

    return b[0] - a[0];
  });

  if (flush && isStraight) {
    const cat: HandCategory = sHigh === 14 ? "royal_flush" : "straight_flush";

    return {
      category: cat,
      score: pack(CAT[cat], [sHigh!]),
      label: cat === "royal_flush" ? "Royal flush" : `Straight flush (${sHigh})`,
      ranks: [sHigh!],
    };
  }

  if (byCount[0]![1] === 4) {
    const quad = byCount[0]![0];
    const kicker = byCount[1]![0];

    return {
      category: "four_of_a_kind",
      score: pack(CAT.four_of_a_kind, [quad, kicker]),
      label: `Four of a kind (${quad})`,
      ranks: [quad, kicker],
    };
  }

  if (byCount[0]![1] === 3 && byCount[1]?.[1] === 2) {
    const t = byCount[0]![0];
    const p = byCount[1]![0];

    return {
      category: "full_house",
      score: pack(CAT.full_house, [t, p]),
      label: `Full house (${t} over ${p})`,
      ranks: [t, p],
    };
  }

  if (flush) {
    return {
      category: "flush",
      score: pack(CAT.flush, vals),
      label: "Flush",
      ranks: vals,
    };
  }

  if (isStraight) {
    return {
      category: "straight",
      score: pack(CAT.straight, [sHigh!]),
      label: `Straight (${sHigh})`,
      ranks: [sHigh!],
    };
  }

  if (byCount[0]![1] === 3) {
    const t = byCount[0]![0];

    const kickers = byCount
      .slice(1)
      .map((x) => x[0])
      .sort((a, b) => b - a);

    return {
      category: "three_of_a_kind",
      score: pack(CAT.three_of_a_kind, [t, ...kickers]),
      label: `Three of a kind (${t})`,
      ranks: [t, ...kickers],
    };
  }

  if (byCount[0]![1] === 2 && byCount[1]?.[1] === 2) {
    const p1 = Math.max(byCount[0]![0], byCount[1]![0]);
    const p2 = Math.min(byCount[0]![0], byCount[1]![0]);
    const kicker = byCount[2]![0];

    return {
      category: "two_pair",
      score: pack(CAT.two_pair, [p1, p2, kicker]),
      label: `Two pair (${p1} & ${p2})`,
      ranks: [p1, p2, kicker],
    };
  }

  if (byCount[0]![1] === 2) {
    const p = byCount[0]![0];

    const kickers = byCount
      .slice(1)
      .map((x) => x[0])
      .sort((a, b) => b - a);

    return {
      category: "pair",
      score: pack(CAT.pair, [p, ...kickers]),
      label: `Pair of ${p}`,
      ranks: [p, ...kickers],
    };
  }

  return {
    category: "high_card",
    score: pack(CAT.high_card, vals),
    label: `High card ${vals[0]}`,
    ranks: vals,
  };
}

/** Best 5-card hand from 5–7 cards */
export function evaluateHoldem(cards: PokerCard[]): HandEval {
  if (cards.length < 5) {
    return {
      category: "high_card",
      score: 0,
      label: "Incomplete",
      ranks: cards.map((c) => RANK_VAL[c.rank]),
    };
  }

  if (cards.length === 5) return evalFive(cards);

  let best: HandEval | null = null;

  for (const five of combos(cards, 5)) {
    const e = evalFive(five);

    if (!best || e.score > best.score) best = e;
  }

  return best!;
}
