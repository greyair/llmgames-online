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
import { PDK_CHOICE_LIMIT, pdkMoves } from "./rules";

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

const HAND_FORMAT =
  "cards are '<suit><rank>' with suits S H C D and ranks 3..9 T J Q K A 2; send the same ids back in { cards: [...] }";

/**
 * 跑得快 decision state.
 *
 * The hand is only 16 cards, but the part a model gets wrong is the shape
 * arithmetic: whether four cards make a bomb or a triple with a single, and
 * whether a run is long enough. So the view ships the hand grouped by rank and a
 * list of concrete legal plays, cheapest first, and the model picks one.
 */
export function paodekuaiAgentDecision(
  view: ProjectionPart,
  legalActions: readonly string[],
): WireObject {
  const seats = projectionPart(view.seats);
  const hand = sortCards(cardsSchema.parse(view.hand));
  const counts = countsSchema.parse(view.handCounts);
  const played = countsSchema.parse(view.played);
  const you = seatFor(seats, stringValue(projectionPart(view.you)?.playerId));
  const toPlay = numberValue(view.toPlay) ?? null;
  const trick = recordSchema.parse(view.trick);
  const lastTrick = recordSchema.parse(view.lastTrick);
  const mustLead = stringValue(view.mustLead) ?? null;
  const playing = stringValue(view.status) === "playing";
  const myTurn = playing && you !== undefined && toPlay === you;
  const hints = myTurn ? pdkMoves(hand, trick?.combo ?? null) : [];

  return agentFields({
    hand: hand.length ? groupedHand(hand) : undefined,
    handFormat: hand.length ? HAND_FORMAT : undefined,
    cards: hand.length,
    counts,
    played,
    yourSeat: you,
    toPlay,
    leading: myTurn && !trick,
    following: myTurn && Boolean(trick),
    trick: trick ? playLine(trick) : undefined,
    lastTrick: lastTrick ? playLine(lastTrick) : undefined,
    mustLead: mustLead ?? undefined,
    canPass: myTurn && legalActions.includes("pass"),
    hints: hints.slice(0, PDK_CHOICE_LIMIT).map((cards) => cards.join(" ")),
    hintsMore: hints.length > PDK_CHOICE_LIMIT ? hints.length - PDK_CHOICE_LIMIT : undefined,
    winnerSeat: winnerForSeats(view, seats),
  });
}

/** `3:2 (♠3 ♥3), 5:1 (♠5)` — the hand as a model reads it. */
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
