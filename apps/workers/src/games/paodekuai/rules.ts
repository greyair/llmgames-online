/**
 * 跑得快 (Run Fast) rule arithmetic, ported from West Window's
 * `paodekuai.ts` + `paodekuai-cards.ts` (MIT, SerenQi).
 *
 * Everything here is pure: a hand plus a table produces the legal plays, and
 * nothing reads a clock or a random source except {@link dealPaodekuai}.
 *
 * Two rules are easy to get wrong and are pinned by tests:
 *
 * - A bare triple is only legal as a seat's last cards; as a lead it is refused,
 *   because the source only allows it to finish.
 * - A trick ends when everyone else has passed **since the last play**, so the
 *   counter resets on every play, not every trick.
 */

import { isString } from "@llmgames/game-catalog";

import { PAODEKUAI_COMBOS, beats, classify, type Combo } from "../cards/combo";
import { cardRank, paodekuaiDeck, sortCards, type Card } from "../cards/deck";
import { shuffleInPlace } from "../../lib/csprng";
import type { CardActionRecord } from "../../durable-objects/types";

export const PDK_SEATS_MIN = 2;

export const PDK_SEATS_MAX = 3;

export const PDK_HAND_SIZE = 16;

export const PDK_FIRST_CARD = "S3";

/** How many candidate plays the agent view lists. */
export const PDK_CHOICE_LIMIT = 28;

/** The highest rank a straight, pair run or plane may reach: the ace. */
const CHAIN_TOP = 11;

export interface PdkDeal {
  hands: Card[][];
  unused: Card[];
  first: number;
  mustLead: Card | null;
}

/** Deal a fresh table. Three seats always hold the spade three. */
export function dealPaodekuai(seats: number): PdkDeal {
  const deck = paodekuaiDeck();

  shuffleInPlace(deck);

  const players = Math.min(Math.max(Math.trunc(seats), PDK_SEATS_MIN), PDK_SEATS_MAX);

  const hands = Array.from({ length: players }, (_, index) =>
    sortCards(deck.slice(index * PDK_HAND_SIZE, (index + 1) * PDK_HAND_SIZE)),
  );

  if (players === 2)
    return { hands, unused: deck.slice(players * PDK_HAND_SIZE), first: 0, mustLead: null };

  const first = hands.findIndex((hand) => hand.includes(PDK_FIRST_CARD));

  return { hands, unused: [], first: first === -1 ? 0 : first, mustLead: PDK_FIRST_CARD };
}

/** A play, ready to be stored on the table. */
export function pdkPlay(seat: number, cards: Card[], combo: Combo, n: number): CardActionRecord {
  return { seat, cards: [...cards], combo, n };
}

/** Every card playable on this table, cheapest first. */
export function pdkMoves(hand: readonly Card[], incumbent: Combo | null): Card[][] {
  const byRank = groupByRank(hand);
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const moves: Card[][] = [];

  const keep = (cards: Card[]) => {
    if (cards.length === 0) return;

    const combo = classify(cards, PAODEKUAI_COMBOS);

    if (isString(combo)) return;

    // A bare triple may only empty the hand, so it is never offered before then.
    if (combo.kind === "triple" && cards.length !== hand.length) return;

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

    if (cards.length >= 4) keep(cards.slice(0, 4));
  }

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
    for (let len = 2; start + len - 1 <= CHAIN_TOP; len += 1) {
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

/**
 * Cheapest play available, used when a seat times out.
 *
 * A leader that must open with a particular card plays exactly that card, so the
 * fallback never has to reason about the first-play rule as well.
 */
export function pdkForcedPlay(
  hand: readonly Card[],
  incumbent: Combo | null,
  mustLead: Card | null,
): Card[] | null {
  if (mustLead) return hand.includes(mustLead) ? [mustLead] : null;

  return pdkMoves(hand, incumbent)[0] ?? null;
}

/** True when every other seat has passed since the last play. */
export function trickIsOver(players: number, passes: number): boolean {
  return passes >= players - 1;
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
