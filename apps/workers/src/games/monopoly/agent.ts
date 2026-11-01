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

import { MONOPOLY_SPACES, MONOPOLY_TOKENS, monopolySpace } from "./board";

const numbersSchema = z.array(z.number()).catch([]);

const ownersSchema = z.array(z.number().nullable()).catch([]);

const flagsSchema = z.array(z.boolean()).catch([]);

const diceSchema = z.array(z.number()).catch([]);

/** `name (index) · ¥price · owner · houses` for one space. */
function spaceLine(index: number, owners: readonly (number | null)[], houses: readonly number[]): string {
  const space = monopolySpace(index);
  const owner = owners[index] ?? null;
  const levels = houses[index] ?? 0;

  const parts = [`${space.name} (${index})`];

  if (space.price !== undefined) parts.push(`¥${space.price}`);

  if (owner === null) parts.push("bank");
  else parts.push(`${MONOPOLY_TOKENS[owner] ?? `seat ${owner}`}${levels > 0 ? ` +${levels}` : ""}`);

  return parts.join(" · ");
}

/**
 * 大富翁 decision state.
 *
 * The board is public, so the view ships the money, the owners and the dice.
 * What a model actually needs is the *situation*: whose turn it is, what it just
 * landed on, what it may do next, and which groups it is one space short of
 * completing.
 */
export function monopolyAgentDecision(
  view: ProjectionPart,
  legalActions: readonly string[],
): WireObject {
  const seats = projectionPart(view.seats);
  const cash = numbersSchema.parse(view.cash);
  const position = numbersSchema.parse(view.position);
  const owners = ownersSchema.parse(view.owners);
  const houses = numbersSchema.parse(view.houses);
  const jail = flagsSchema.parse(view.jail);
  const jailCards = numbersSchema.parse(view.jailCards);
  const bankrupt = flagsSchema.parse(view.bankrupt);
  const dice = diceSchema.parse(view.roll);
  const you = seatFor(seats, stringValue(projectionPart(view.you)?.playerId));
  const phase = stringValue(projectionPart(view.turnState)?.phase) ?? "roll";
  const current = seatFor(seats, stringValue(projectionPart(view.turnState)?.currentPlayerId));
  const landed = numberValue(view.landed) ?? null;
  const doubles = numberValue(view.doubles) ?? 0;

  const mine = you === undefined ? [] : MONOPOLY_SPACES.filter((space) => owners[space.index] === you);
  const canBuild = mine.filter((space) => (houses[space.index] ?? 0) < 3);

  return agentFields({
    phase,
    yourSeat: you,
    yourTurn: current !== undefined && current === you,
    cash,
    tokens: MONOPOLY_TOKENS.slice(0, cash.length),
    position,
    jail,
    jailCards,
    bankrupt,
    owners,
    houses,
    dice: dice.length === 2 ? dice : undefined,
    doubles: doubles || undefined,
    landed: landed === null ? undefined : spaceLine(landed, owners, houses),
    standOn: you === undefined ? undefined : spaceLine(position[you] ?? 0, owners, houses),
    yourProperties: mine.map((space) => spaceLine(space.index, owners, houses)),
    upgradeable: canBuild.map((space) => spaceLine(space.index, owners, houses)),
    legalActions: [...legalActions],
    winnerSeat: winnerForSeats(view, seats),
  });
}
