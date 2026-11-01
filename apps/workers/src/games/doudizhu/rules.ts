/**
 * 斗地主 (Fight the Landlord) rule arithmetic, ported from West Window's
 * `doudizhu.ts` + `doudizhu-cards.ts` (MIT, SerenQi).
 *
 * Three seats, a 54-card deck, seventeen cards each and three face-down bottom
 * cards. What makes this game different from 跑得快 is not the shapes — those are
 * shared in `cards/` — but two things:
 *
 * - **Bidding.** Each seat gets one turn to bid 1, 2 or 3 or pass; a bid of 3
 *   ends the auction at once, and a deal nobody bids on is thrown in and dealt
 *   again with the next seat opening.
 * - **One against two.** The landlord alone plays against both farmers, so the
 *   result is a side, not a seat.
 */

import { DOUDIZHU_COMBOS, type Combo } from "../cards/combo";
import { doudizhuDeck, sortCards, type Card } from "../cards/deck";
import { legalMoves } from "../cards/moves";
import { shuffleInPlace } from "../../lib/csprng";

export const DDZ_SEATS = 3;

export const DDZ_HAND_SIZE = 17;

export const DDZ_BOTTOM_SIZE = 3;

/** How many candidate plays the agent view lists. */
export const DDZ_CHOICE_LIMIT = 28;

export interface DdzDeal {
  hands: Card[][];
  bottom: Card[];
}

/** Deal seventeen cards to each seat and three to the bottom. */
export function dealDoudizhu(): DdzDeal {
  const deck = doudizhuDeck();

  shuffleInPlace(deck);

  return {
    hands: Array.from({ length: DDZ_SEATS }, (_, index) =>
      sortCards(deck.slice(index * DDZ_HAND_SIZE, (index + 1) * DDZ_HAND_SIZE)),
    ),
    bottom: sortCards(deck.slice(DDZ_SEATS * DDZ_HAND_SIZE)),
  };
}

/** Every playable combination, cheapest first. */
export function ddzMoves(hand: readonly Card[], incumbent: Combo | null): Card[][] {
  return legalMoves(hand, incumbent, DOUDIZHU_COMBOS);
}

/** Cheapest play available, used when a seat times out. */
export function ddzForcedPlay(hand: readonly Card[], incumbent: Combo | null): Card[] | null {
  return ddzMoves(hand, incumbent)[0] ?? null;
}

/**
 * Hand score for a finished deal.
 *
 * The landlord stakes both farmers, so the base swings by two on either side;
 * every bomb and rocket doubles it, and a spring doubles it again.
 */
export function doudizhuScore(input: {
  bid: number;
  multiplier: number;
  landlordWon: boolean;
  spring: boolean;
}): number {
  const base = Math.max(input.bid, 1) * 2 ** Math.max(input.multiplier, 0) * (input.spring ? 2 : 1);

  return input.landlordWon ? base : -base;
}

/** True when every farmer finished without playing a card. */
export function isSpring(played: readonly number[], landlord: number): boolean {
  return played.every((count, seat) => seat === landlord || count === 0);
}

/**
 * Next seat that still has to bid, or null when the auction is over.
 *
 * Every seat acts once per deal, so this walks forward from `from` and stops at
 * the first seat whose `bids` entry is still null.
 */
export function nextBidder(
  bids: readonly (number | null)[],
  from: number,
  seats: number,
): number | null {
  for (let step = 1; step <= seats; step += 1) {
    const seat = (from + step) % seats;

    if (bids[seat] === null) return seat;
  }

  return null;
}
