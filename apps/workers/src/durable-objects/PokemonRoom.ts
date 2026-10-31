import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { GameRoomConfig, Player } from "./types";
import { pokemonPlugin } from "../games/pokemon/plugin";
import type { PokemonGameState } from "../games/pokemon/state";

/**
 * Pokémon room (M3.8).
 *
 * The Durable Object keeps the platform concerns — seats, sockets, clocks,
 * receipts, persistence, archives and replay — and forwards the rules to
 * {@link pokemonPlugin}. Class name, namespace and persisted state shape are
 * unchanged from the pre-plugin implementation.
 *
 * A turn is two sealed choices that resolve together, so `turnState.currentPlayerId`
 * stays null for the whole match and every seat is asked through `mayActNow`.
 *
 * Actions: pokemon_move { slot }, pokemon_switch { slot }
 */

export type { PokemonGameState } from "../games/pokemon/state";

export { parseBattle, playerInSeat, seatOf, syncBattle } from "../games/pokemon/rules";

export class PokemonRoom extends BaseGameRoom<PokemonGameState> {
  protected readonly roomLabel = "PokemonRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return pokemonPlugin;
  }

  protected get minPlayersToStart(): number {
    return pokemonPlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return pokemonPlugin.initialTurnPhase;
  }

  protected createDefaultState(
    config: GameRoomConfig & { roomCode?: string },
    roomCode: string,
  ): PokemonGameState {
    return pokemonPlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    pokemonPlugin.start(this.gameState, { firstPlayerIndex: 0, now: Date.now() });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...pokemonPlugin.turnActions(this.gameState, playerId, {
        isSpectator: this.isSpectator(playerId),
      }),
    ];
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = pokemonPlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }

  protected async onTurnTimeout(): Promise<void> {
    if (!this.gameState) return;

    this.applyGameEffects(pokemonPlugin.onTurnTimeout?.(this.gameState, null, Date.now()) ?? []);
    await this.settleRuleTimeout();
  }

  protected onGameTimeout(): void {
    if (!this.gameState) return;

    pokemonPlugin.onMatchTimeout?.(this.gameState, Date.now());
  }
}
