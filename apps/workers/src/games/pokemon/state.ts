import type { BaseGameState } from "../../durable-objects/types";
import type { BattleSeat } from "./engine";

/**
 * Persisted Pokémon state.
 *
 * The battle itself lives in `battleSnapshot` — the simulator's own JSON — so a
 * Durable Object can be recycled mid-match without losing the battle. Seats are
 * recorded once at start and survive roster changes for the whole match.
 */
export interface PokemonGameState extends BaseGameState {
  type: "pokemon";
  /** Serialized `@pkmn/sim` battle. Server-only: never projected. */
  battleSnapshot: string | null;
  battleSeats?: Record<string, BattleSeat>;
  winner: string | null;
}
