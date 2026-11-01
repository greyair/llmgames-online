import {
  agentFields,
  numberValue,
  projectionPart,
  seatFor,
  stringValue,
  winnerForSeats,
  type ProjectionPart,
  type WireObject,
} from "@llmgames/game-catalog";
import { z } from "zod";

import { describeCombo, type Combo } from "../cards/combo";
import { cardRank, cardsText, sortCards } from "../cards/deck";
import { DDZ_CHOICE_LIMIT, ddzMoves } from "./rules";

const comboKind = z.enum([
  "single",
  "pair",
  "triple",
  "triple_one",
  "triple_pair",
  "straight",
  "pair_run",
  "plane",
  "plane_one",
  "plane_pair",
  "four_two",
  "four_two_pair",
  "bomb",
  "rocket",
]);

const recordSchema = z
  .object({
    seat: z.number(),
    cards: z.array(z.string()),
    combo: z
      .object({ kind: comboKind, size: z.number(), key: z.number(), len: z.number() })
      .nullable(),
    n: z.number(),
  })
  .nullable()
  .catch(null);

const cardsSchema = z.array(z.string()).catch([]);

const countsSchema = z.array(z.number()).catch([]);

const bidsSchema = z.array(z.number().nullable()).catch([]);

const HAND_FORMAT =
  "cards are '<suit><rank>' with suits S H C D and ranks 3..9 T J Q K A 2; the jokers are j1 (small) and j2 (big). Send the same ids back in { cards: [...] }";

/**
 * 斗地主 decision state.
 *
 * The auction and the trick are both small enough to ship in full; the hand is
 * where the tokens go, so it arrives grouped by rank and, on the viewer's turn,
 * with a list of concrete legal plays — the arithmetic a model gets wrong is
 * exactly "does this beat the table and is it the same shape".
 */
export function doudizhuAgentDecision(
  view: ProjectionPart,
  legalActions: readonly string[],
): WireObject {
  const seats = projectionPart(view.seats);
  const hand = sortCards(cardsSchema.parse(view.hand));
  const counts = countsSchema.parse(view.handCounts);
  const played = countsSchema.parse(view.played);
  const bids = bidsSchema.parse(view.bids);
  const you = seatFor(seats, stringValue(projectionPart(view.you)?.playerId));
  const toAct = numberValue(view.toAct) ?? null;
  const trick = recordSchema.parse(view.trick);
  const lastTrick = recordSchema.parse(view.lastTrick);
  const bottom = cardsSchema.parse(view.bottom);
  const landlord = numberValue(view.landlord) ?? null;
  const bid = numberValue(view.bid) ?? 0;
  const multiplier = numberValue(view.multiplier) ?? 0;
  const phase = stringValue(projectionPart(view.turnState)?.phase) ?? "bid";
  const playing = stringValue(view.status) === "playing";
  const myTurn = playing && you !== undefined && toAct === you;
  const bidding = myTurn && phase === "bid";
  const hints = myTurn && phase === "play" ? ddzMoves(hand, trick?.combo ?? null) : [];

  return agentFields({
    phase,
    hand: hand.length ? groupedHand(hand) : undefined,
    handFormat: hand.length ? HAND_FORMAT : undefined,
    cards: hand.length,
    counts,
    played,
    yourSeat: you,
    toAct,
    landlord,
    yourSide:
      landlord === null || you === undefined
        ? undefined
        : you === landlord
          ? "landlord"
          : "farmers",
    bid,
    bids,
    bidding,
    minBid: bidding ? bid + 1 : undefined,
    bottom: bottom.length ? cardsText(bottom) : undefined,
    multiplier: multiplier || undefined,
    trick: trick ? playLine(trick) : undefined,
    lastTrick: lastTrick ? playLine(lastTrick) : undefined,
    canPass: myTurn && legalActions.includes("pass"),
    hints: hints.slice(0, DDZ_CHOICE_LIMIT).map((cards) => cards.join(" ")),
    hintsMore: hints.length > DDZ_CHOICE_LIMIT ? hints.length - DDZ_CHOICE_LIMIT : undefined,
    winnerSeat: winnerForSeats(view, seats),
    winnerSide: stringValue(view.winnerSide) ?? undefined,
  });
}

/** `x2 (♠3 ♦3), (♠J)` — the hand as a model reads it. */
function groupedHand(hand: readonly string[]): string {
  const groups = new Map<number, string[]>();

  for (const card of hand) {
    const rank = cardRank(card);
    const bucket = groups.get(rank);

    if (bucket) bucket.push(card);
    else groups.set(rank, [card]);
  }

  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cards]) => `${cards.length > 1 ? `x${cards.length} ` : ""}(${cardsText(cards)})`)
    .join(", ");
}

/** One action as a sentence: `seat 1 played pair 8 (♠8 ♥8)`. */
function playLine(record: { seat: number; cards: string[]; combo: Combo | null }): string {
  const who = `seat ${record.seat}`;

  if (!record.combo) return `${who} passed`;

  return `${who} played ${describeCombo(record.combo)} (${cardsText(record.cards)})`;
}
