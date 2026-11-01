/**
 * Candidate plays for a hand, shared by 跑得快 and 斗地主.
 *
 * The generator walks the shapes both games share and keeps whatever the
 * classifier accepts on top of the current trick. It is deliberately cheap —
 * a hand is at most twenty cards — because it runs for every agent decision and
 * every timeout, and because "what can I play" is the question a model gets
 * wrong most often.
 *
 * A game's own rules still apply, through `ComboRules`: a bare triple only
 * finishes a Run Fast hand, and Dou Dizhu never offers a shape it does not have.
 */

import { isString } from "@llmgames/game-catalog";

import { PAODEKUAI_COMBOS, beats, classify, type Combo, type ComboRules } from "./combo";
import { cardRank, sortCards, type Card } from "./deck";

/** The highest rank a straight, pair run or plane may reach: the ace. */
const CHAIN_TOP = 11;

/** Every card playable on this table, in the order a player usually reads them. */
export function legalMoves(
  hand: readonly Card[],
  incumbent: Combo | null,
  rules: ComboRules = PAODEKUAI_COMBOS,
): Card[][] {
  const byRank = groupByRank(hand);
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const moves: Card[][] = [];

  const keep = (cards: Card[]) => {
    if (cards.length === 0) return;

    const combo = classify(cards, rules);

    if (isString(combo)) return;

    // A bare triple may only finish the hand, where the game's rules say so.
    if (rules.bareTripleFinishes && combo.kind === "triple" && cards.length !== hand.length) return;

    if (incumbent && !beats(combo, incumbent)) return;

    moves.push(sortCards(cards));
  };

  for (const rank of ranks) {
    const cards = byRank.get(rank) ?? [];

    keep(cards.slice(0, 1));

    if (cards.length >= 2) keep(cards.slice(0, 2));

    if (cards.length >= 3) {
      const triple = cards.slice(0, 3);
      const single = cheapestSingles(byRank, ranks, 1, [rank]);
      const pair = cheapestPairs(byRank, ranks, 1, [rank]);

      keep(triple);

      if (single) keep([...triple, ...single]);

      if (pair) keep([...triple, ...pair]);
    }

    if (cards.length >= 4) {
      const quad = cards.slice(0, 4);

      keep(quad);

      if (rules.fourWithWings) {
        const two = cheapestSingles(byRank, ranks, 2, [rank]);
        const twoPairs = cheapestPairs(byRank, ranks, 2, [rank]);

        if (two) keep([...quad, ...two]);

        if (twoPairs) keep([...quad, ...twoPairs]);
      }
    }
  }

  if (rules.rocket && byRank.has(13) && byRank.has(14)) keep([...jokers(byRank)]);

  const runnable = ranks.filter((rank) => rank <= CHAIN_TOP);

  // Straights: every start rank, every length of five or more.
  for (const start of runnable)
    for (let len = 5; start + len - 1 <= CHAIN_TOP; len += 1) {
      const chain = consecutive(ranks, start, len);

      if (!chain) break;

      keep(firstOfEach(byRank, chain));
    }

  const paired = runnable.filter((rank) => (byRank.get(rank)?.length ?? 0) >= 2);

  for (const start of paired)
    for (let len = rules.minPairRun; start + len - 1 <= CHAIN_TOP; len += 1) {
      const chain = consecutive(paired, start, len);

      if (!chain) break;

      keep(chain.flatMap((rank) => (byRank.get(rank) ?? []).slice(0, 2)));
    }

  const tripled = runnable.filter((rank) => (byRank.get(rank)?.length ?? 0) >= 3);

  for (const start of tripled)
    for (let len = 2; start + len - 1 <= CHAIN_TOP; len += 1) {
      const chain = consecutive(tripled, start, len);

      if (!chain) break;

      const body = chain.flatMap((rank) => (byRank.get(rank) ?? []).slice(0, 3));
      const singles = cheapestSingles(byRank, ranks, len, chain);
      const pairs = cheapestPairs(byRank, ranks, len, chain);

      keep(body);

      if (singles) keep([...body, ...singles]);

      if (pairs) keep([...body, ...pairs]);
    }

  return moves;
}

function jokers(byRank: Map<number, Card[]>): Card[] {
  return [...(byRank.get(13) ?? []), ...(byRank.get(14) ?? [])].slice(0, 2);
}

function groupByRank(hand: readonly Card[]): Map<number, Card[]> {
  const byRank = new Map<number, Card[]>();

  for (const card of sortCards(hand)) {
    const rank = cardRank(card);
    const bucket = byRank.get(rank);

    if (bucket) bucket.push(card);
    else byRank.set(rank, [card]);
  }

  return byRank;
}

/** One card of each rank in `chain`, or nothing when one is missing. */
function firstOfEach(byRank: Map<number, Card[]>, chain: readonly number[]): Card[] {
  const cards: Card[] = [];

  for (const rank of chain) {
    const [card] = byRank.get(rank) ?? [];

    if (!card) return [];

    cards.push(card);
  }

  return cards;
}

/** `len` ranks starting at `start`, or null when the run is broken. */
function consecutive(ranks: readonly number[], start: number, len: number): number[] | null {
  const chain: number[] = [];

  for (let offset = 0; offset < len; offset += 1) {
    const rank = start + offset;

    if (!ranks.includes(rank)) return null;

    chain.push(rank);
  }

  return chain;
}

/** Cheapest `count` single cards from ranks outside `excluded`. */
function cheapestSingles(
  byRank: Map<number, Card[]>,
  ranks: readonly number[],
  count: number,
  excluded: readonly number[],
): Card[] | null {
  const skip = new Set(excluded);
  const picked: Card[] = [];

  for (const rank of ranks) {
    if (picked.length >= count) break;

    if (skip.has(rank)) continue;

    const [card] = byRank.get(rank) ?? [];

    if (!card) continue;

    picked.push(card);
    skip.add(rank);
  }

  return picked.length === count ? picked : null;
}

/** Cheapest `count` pairs from ranks outside `excluded`. */
function cheapestPairs(
  byRank: Map<number, Card[]>,
  ranks: readonly number[],
  count: number,
  excluded: readonly number[],
): Card[] | null {
  const skip = new Set(excluded);
  const picked: Card[] = [];

  for (const rank of ranks) {
    if (picked.length >= count * 2) break;

    if (skip.has(rank)) continue;

    const cards = byRank.get(rank) ?? [];

    if (cards.length < 2) continue;

    picked.push(...cards.slice(0, 2));
    skip.add(rank);
  }

  return picked.length === count * 2 ? picked : null;
}
