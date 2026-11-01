/**
 * 大富翁 rule arithmetic, ported from West Window's `monopoly.ts` (MIT, SerenQi).
 *
 * Everything here is pure. Settlement is the part worth reading twice: a payment
 * first sells house levels at half cost, then hands properties back to the bank
 * at half price, and only then declares bankruptcy — so a player who *can* pay
 * always does, and the order is the cheapest-first one the source uses.
 */

import {
  MONOPOLY_GROUPS,
  MONOPOLY_MAX_HOUSES,
  MONOPOLY_SPACES,
  monopolySpace,
} from "./board";
import type { MonopolyGameState } from "../../durable-objects/types";

/** Rent owed for landing on `index`, given who owns it. */
export function rentFor(state: MonopolyGameState, index: number): number {
  const space = monopolySpace(index);

  if (space.kind !== "property" || space.rent === undefined) return 0;

  const owner = state.owners[index] ?? null;

  if (owner === null) return 0;

  const level = Math.min(state.houses[index] ?? 0, MONOPOLY_MAX_HOUSES);
  const base = space.rent[level] ?? space.rent[0];

  // A full group with no houses doubles the base rent.
  if (level === 0 && ownsGroup(state, owner, space.group ?? -1)) return base * 2;

  return base;
}

/** True when `seat` owns every space in `group`. */
export function ownsGroup(state: MonopolyGameState, seat: number, group: number): boolean {
  if (group < 0) return false;

  const spaces = MONOPOLY_SPACES.filter((space) => space.group === group);

  return spaces.length > 0 && spaces.every((space) => state.owners[space.index] === seat);
}

/** Cash plus property prices plus what the houses cost to build. */
export function netWorth(state: MonopolyGameState, seat: number): number {
  let total = state.cash[seat] ?? 0;

  MONOPOLY_SPACES.forEach((space) => {
    if (state.owners[space.index] !== seat) return;

    total += space.price ?? 0;
    total += (space.houseCost ?? 0) * (state.houses[space.index] ?? 0);
  });

  return total;
}

/** House levels a seat owns, for the repair card. */
export function houseLevels(state: MonopolyGameState, seat: number): number {
  return MONOPOLY_SPACES.reduce(
    (total, space) => (state.owners[space.index] === seat ? total + (state.houses[space.index] ?? 0) : total),
    0,
  );
}

/**
 * Take `amount` from `seat`, raising cash if needed.
 *
 * Returns true when the seat went bankrupt. The caller keeps any transfers (rent,
 * a card's gift) outside this, because those follow the same order but pay
 * somebody rather than the bank.
 */
export function charge(state: MonopolyGameState, seat: number, amount: number): boolean {
  state.cash[seat] = (state.cash[seat] ?? 0) - amount;

  if (state.cash[seat]! >= 0) return false;

  raiseCash(state, seat);

  return state.cash[seat]! < 0;
}

/** Sell houses, then properties, cheapest first, until the balance is covered. */
function raiseCash(state: MonopolyGameState, seat: number): void {
  const owned = MONOPOLY_SPACES.filter((space) => state.owners[space.index] === seat).sort(
    (a, b) => (a.price ?? 0) - (b.price ?? 0),
  );

  for (const space of owned) {
    const levels = state.houses[space.index] ?? 0;

    if (levels > 0) {
      state.houses[space.index] = 0;
      state.cash[seat] = (state.cash[seat] ?? 0) + Math.floor(((space.houseCost ?? 0) * levels) / 2);
    }
  }

  for (const space of owned) {
    if (state.cash[seat]! >= 0) break;

    state.owners[space.index] = null;
    state.houses[space.index] = 0;
    state.cash[seat] = (state.cash[seat] ?? 0) + Math.floor((space.price ?? 0) / 2);
  }
}

/** Bankruptcy: everything returns to the bank and the seat leaves the board. */
export function bankrupt(state: MonopolyGameState, seat: number): void {
  MONOPOLY_SPACES.forEach((space) => {
    if (state.owners[space.index] !== seat) return;

    state.owners[space.index] = null;
    state.houses[space.index] = 0;
  });

  state.cash[seat] = 0;
  state.jailCards[seat] = 0;
  state.bankrupt[seat] = true;
}

/** Seats still playing. */
export function solvent(state: MonopolyGameState): number[] {
  return state.bankrupt.flatMap((out, seat) => (out ? [] : [seat]));
}

/** The only seat left, or null while the game is still on. */
export function lastStanding(state: MonopolyGameState): number | null {
  const alive = solvent(state);

  return alive.length === 1 ? (alive[0] ?? null) : null;
}

/** Highest net worth among the seats still playing; several may tie. */
export function richest(state: MonopolyGameState): number[] {
  const alive = solvent(state);

  if (alive.length === 0) return [];

  const best = Math.max(...alive.map((seat) => netWorth(state, seat)));

  return alive.filter((seat) => netWorth(state, seat) === best);
}

/** Price per house level in `group`, or 0 when the space has no group. */
export function houseCostFor(index: number): number {
  const group = monopolySpace(index).group;

  return group === undefined ? 0 : (MONOPOLY_GROUPS[group]?.houseCost ?? 0);
}

/** The parts of the board a build decision needs. */
export interface BuildBoard {
  cash: readonly number[];
  owners: readonly (number | null)[];
  houses: readonly number[];
}

/** Every space `seat` could put a house on right now. */
export function buildableSpaces(board: BuildBoard, seat: number): number[] {
  return MONOPOLY_SPACES.filter((space) => {
    if (space.group === undefined) return false;

    if (board.owners[space.index] !== seat) return false;

    if ((board.houses[space.index] ?? 0) >= MONOPOLY_MAX_HOUSES) return false;

    const group = MONOPOLY_SPACES.filter((other) => other.group === space.group);

    if (!group.every((other) => board.owners[other.index] === seat)) return false;

    return (board.cash[seat] ?? 0) >= (space.houseCost ?? 0);
  }).map((space) => space.index);
}

/**
 * Whether `seat` may build on `index`.
 *
 * The source allows uneven building, so the only requirements are a full group,
 * a house level below the cap and enough cash.
 */
export function canBuild(state: MonopolyGameState, seat: number, index: number): boolean {
  return buildableSpaces(state, seat).includes(index);
}
