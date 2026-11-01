/**
 * Card shapes and strength comparison, shared by 跑得快 and 斗地主.
 *
 * One classifier recognises every shape both games use; each game then offers
 * only the shapes its rules allow (`ComboRules`). Keeping the recognition in one
 * place is what makes "same type, same length, higher key" a single comparison
 * instead of two nearly identical ladders.
 */

import type { CardCombo as Combo, CardComboKind as ComboKind } from "../../durable-objects/types";
import { RANK_BIG_JOKER, RANK_SMALL_JOKER, RANK_TWO, rankCounts, rankText } from "./deck";

export type { CardCombo as Combo, CardComboKind as ComboKind } from "../../durable-objects/types";

export interface ComboRules {
  /** 斗地主 allows the two-joker rocket. */
  rocket: boolean;
  /** 斗地主 allows four-with-two and four-with-two-pairs. */
  fourWithWings: boolean;
  /** Shortest consecutive-pair run: 2 for 跑得快, 3 for 斗地主. */
  minPairRun: number;
  /** 跑得快 only lets a bare triple finish a hand. */
  bareTripleFinishes: boolean;
}

export const PAODEKUAI_COMBOS: ComboRules = {
  rocket: false,
  fourWithWings: false,
  minPairRun: 2,
  bareTripleFinishes: true,
};

export const DOUDIZHU_COMBOS: ComboRules = {
  rocket: true,
  fourWithWings: true,
  minPairRun: 3,
  bareTripleFinishes: false,
};

/** Highest rank a chain may contain: a run stops at the ace. */
const CHAIN_TOP = RANK_TWO - 1;

const COMBO_NAMES: Readonly<Record<ComboKind, string>> = {
  single: "single",
  pair: "pair",
  triple: "triple",
  triple_one: "triple with one",
  triple_pair: "triple with a pair",
  straight: "straight",
  pair_run: "consecutive pairs",
  plane: "plane",
  plane_one: "plane with singles",
  plane_pair: "plane with pairs",
  four_two: "four with two",
  four_two_pair: "four with two pairs",
  bomb: "bomb",
  rocket: "rocket",
};

export function comboName(kind: ComboKind): string {
  return COMBO_NAMES[kind];
}

/** English description of a shape, for refusals and agent briefings. */
export function describeCombo(combo: Combo): string {
  if (combo.kind === "rocket") return "rocket (two jokers)";

  const name = comboName(combo.kind);

  if (combo.len > 1) {
    const top = combo.key + combo.len - 1;

    return `${name} ${rankText(combo.key)}–${rankText(top)}`;
  }

  return `${name} ${rankText(combo.key)}`;
}

/** A run of `len` consecutive ranks ending no higher than the ace. */
function isRun(ranks: readonly number[], len: number): boolean {
  if (ranks.length !== len) return false;

  const sorted = [...ranks].sort((a, b) => a - b);
  const first = sorted[0];

  if (first === undefined || first + len - 1 > CHAIN_TOP) return false;

  return sorted.every((rank, index) => rank === first + index);
}

/**
 * Recognise `cards` as a shape, or explain why it is not one.
 *
 * `rules` decides which shapes exist at all, so the same pair of kings is a
 * legal play in both games while a rocket only exists in 斗地主.
 */
export function classify(cards: readonly string[], rules: ComboRules): Combo | string {
  const size = cards.length;

  if (size === 0) return "Play at least one card";

  const counts = rankCounts(cards);
  const ranks = [...counts.keys()].sort((a, b) => a - b);
  const withCount = (wanted: number) => ranks.filter((rank) => counts.get(rank) === wanted);
  const singles = withCount(1);
  const pairs = withCount(2);
  const triples = withCount(3);
  const quads = withCount(4);

  if (
    rules.rocket &&
    size === 2 &&
    counts.get(RANK_SMALL_JOKER) === 1 &&
    counts.get(RANK_BIG_JOKER) === 1
  )
    return { kind: "rocket", size, key: RANK_BIG_JOKER, len: 1 };

  // The two jokers are only ever a rocket, so no shape may carry them as wings.
  if (
    rules.rocket &&
    counts.has(RANK_SMALL_JOKER) &&
    counts.has(RANK_BIG_JOKER) &&
    size !== 2
  )
    return "The two jokers can only be played as a rocket";

  if (quads.length === 1) {
    const quad = quads[0] ?? 0;

    if (size === 4) return { kind: "bomb", size, key: quad, len: 1 };

    if (rules.fourWithWings && size === 6 && singles.length === 2)
      return { kind: "four_two", size, key: quad, len: 1 };

    if (rules.fourWithWings && size === 8 && pairs.length === 2)
      return { kind: "four_two_pair", size, key: quad, len: 1 };

    return "A four-of-a-kind can only be played as a bomb, or with two singles or two pairs";
  }

  if (triples.length > 0) {
    const len = triples.length;
    const key = triples[0] ?? 0;

    if (!isRun(triples, len)) return "Triples must be consecutive ranks";

    if (size === 3 * len)
      return len === 1 ? { kind: "triple", size, key, len } : { kind: "plane", size, key, len };

    if (size === 4 * len && singles.length === len)
      return len === 1
        ? { kind: "triple_one", size, key, len }
        : { kind: "plane_one", size, key, len };

    if (size === 5 * len && pairs.length === len)
      return len === 1
        ? { kind: "triple_pair", size, key, len }
        : { kind: "plane_pair", size, key, len };

    return "That is not a shape: check the cards around the triple";
  }

  if (size === 1) return { kind: "single", size, key: ranks[0] ?? 0, len: 1 };

  if (size === 2) {
    if (pairs.length === 1) return { kind: "pair", size, key: pairs[0] ?? 0, len: 1 };

    return "Two cards must be the same rank";
  }

  if (size === 3) return "Three cards must be the same rank";

  if (singles.length === size && size >= 5 && isRun(singles, size))
    return { kind: "straight", size, key: singles[0] ?? 0, len: size };

  if (pairs.length === size / 2 && pairs.length >= rules.minPairRun && isRun(pairs, pairs.length))
    return { kind: "pair_run", size, key: pairs[0] ?? 0, len: pairs.length };

  return "That combination is not a shape this game allows";
}

/** True when `candidate` may be played on top of `incumbent`. */
export function beats(candidate: Combo, incumbent: Combo): boolean {
  if (candidate.kind === "rocket") return incumbent.kind !== "rocket";

  if (incumbent.kind === "rocket") return false;

  if (candidate.kind === "bomb" && incumbent.kind !== "bomb") return true;

  if (incumbent.kind === "bomb" && candidate.kind !== "bomb") return false;

  if (candidate.kind !== incumbent.kind) return false;

  if (candidate.size !== incumbent.size) return false;

  return candidate.key > incumbent.key;
}

/** What a follower has to produce to beat `incumbent`, in one sentence. */
export function beatRequirement(incumbent: Combo): string {
  if (incumbent.kind === "rocket") return "nothing beats a rocket";

  if (incumbent.kind === "bomb") return `a bomb higher than ${rankText(incumbent.key)}`;

  return `a ${comboName(incumbent.kind)} of ${incumbent.size} cards with a higher key than ${rankText(incumbent.key)}, or any bomb`;
}
