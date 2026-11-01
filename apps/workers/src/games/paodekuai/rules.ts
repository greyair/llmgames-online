/**
 * 跑得快 (Run Fast) rule arithmetic, ported from West Window's
 * `paodekuai.ts` + `paodekuai-cards.ts` (MIT, SerenQi).
 *
 * Everything here is pure: a hand plus a table produces the legal plays, and
 * nothing reads a clock or a random source except {@link dealPaodekuai}. The
 * shape walk itself lives in `cards/moves.ts`, shared with 斗地主.
 *
 * Two rules are easy to get wrong and are pinned by tests:
 *
 * - A bare triple is only legal as a seat's last cards; as a lead it is refused,
 *   because the source only allows it to finish.
 * - A trick ends when everyone else has passed **since the last play**, so the
 *   counter resets on every play, not every trick.
 */

import { PAODEKUAI_COMBOS, type Combo } from "../cards/combo";
import { paodekuaiDeck, sortCards, type Card } from "../cards/deck";
import { legalMoves } from "../cards/moves";
import { shuffleInPlace } from "../../lib/csprng";
import type { CardActionRecord } from "../../durable-objects/types";

export const PDK_SEATS_MIN = 2;

export const PDK_SEATS_MAX = 3;

export const PDK_HAND_SIZE = 16;

export const PDK_FIRST_CARD = "S3";

/** How many candidate plays the agent view lists. */
export const PDK_CHOICE_LIMIT = 28;

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
  return legalMoves(hand, incumbent, PAODEKUAI_COMBOS);
}

/** Cheapest play available, used when a seat times out. */
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
