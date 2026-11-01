import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { GoGameState, Player } from "./types";
import { goPlugin } from "../games/go/plugin";

/**
 * 围棋 room (M4.5).
 *
 * Everything the platform owns — seats, sockets, clocks, receipts, persistence,
 * archives and replay — stays in {@link BaseGameRoom}; the rules live in
 * {@link goPlugin}. This adapter exists only because Durable Object classes
 * are a deployment shape, not a rule concept.
 *
 * Phases: waiting → play → scoring → ended
 * Actions: place_go_stone { point }, pass_turn, resign; then mark_dead, accept_score, resume_play
 */
export class GoRoom extends BaseGameRoom<GoGameState> {
  protected readonly roomLabel = "GoRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return goPlugin;
  }

  protected get minPlayersToStart(): number {
    return goPlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return goPlugin.initialTurnPhase;
  }

  protected createDefaultState(
    config: {
      hostId: string;
      hostName: string;
      maxPlayers?: number;
      gameTotalTime?: number;
      turnTime?: number;
      roomCode?: string;
    },
    roomCode: string,
  ): GoGameState {
    return goPlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    goPlugin.start(this.gameState, {
      firstPlayerIndex: this.startingPlayerIndex(),
      now: Date.now(),
    });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...goPlugin.turnActions(this.gameState, playerId, {
        isSpectator: this.isSpectator(playerId),
      }),
    ];
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (!this.gameState) return base;

    return {
      ...base,
      ...goPlugin.seatIdentity(this.gameState, playerId, { isSpectator: base.isSpectator }),
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = goPlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }
}
