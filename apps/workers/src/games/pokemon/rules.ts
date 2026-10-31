import { Battle } from "@pkmn/sim";

import type { PokemonGameState } from "./state";
import type { BattleSeat } from "./engine";

/**
 * Battle snapshot handling.
 *
 * The simulator is only ever read through a snapshot: the state holds JSON, and
 * rule calls parse it, act, then serialize it back. Parsing is the expensive
 * part of every view and every action, so the last parsed battle is memoized by
 * its snapshot string. The snapshot fully determines the battle, so the cache
 * cannot leak one room's battle into another's answer.
 */

let cachedSnapshot: string | null = null;

let cachedBattle: Battle | null = null;

export function parseBattle(snapshot: string | null): Battle | null {
  if (!snapshot) return null;

  if (cachedSnapshot === snapshot) return cachedBattle;

  cachedBattle = Battle.fromJSON(snapshot);
  cachedSnapshot = snapshot;

  return cachedBattle;
}

export function seatOf(state: PokemonGameState, playerId: string): BattleSeat | null {
  return state.battleSeats?.[playerId] ?? null;
}

/** The player holding a seat, used to translate the simulator's winner back to an id. */
export function playerInSeat(state: PokemonGameState, seat: BattleSeat): string | null {
  return (
    Object.entries(state.battleSeats ?? {}).find(([, assigned]) => assigned === seat)?.[0] ?? null
  );
}

export interface SyncOptions {
  /** A fresh decision just opened, so the decision clock restarts. */
  newDecision: boolean;
  now: number;
  /** Reason recorded in the audit log when the battle is over. */
  reason?: string;
}

/**
 * Write a battle back into the state.
 *
 * Returns `true` when this sync ended the match, so the caller can attach the
 * platform effects (stop timers, record the end, persist the archive).
 */
export function syncBattle(
  state: PokemonGameState,
  battle: Battle,
  { newDecision, now }: SyncOptions,
): boolean {
  state.battleSnapshot = JSON.stringify(battle.toJSON());
  state.turnState.turnNumber = battle.turn;
  state.turnState.currentPlayerId = null;

  if (newDecision) {
    state.turnState.startedAt = now;
    state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
  }

  if (!battle.ended) {
    state.turnState.phase = "battle";

    return false;
  }

  const winnerSeat: BattleSeat | null =
    battle.winner === "p1" ? "p1" : battle.winner === "p2" ? "p2" : null;

  state.status = "ended";
  state.turnState.phase = "ended";
  state.winner = winnerSeat ? playerInSeat(state, winnerSeat) : "draw";

  return true;
}
