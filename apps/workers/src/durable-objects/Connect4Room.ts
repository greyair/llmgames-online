import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { Connect4GameState, Player } from "./types";
import { connect4Plugin } from "../games/connect4/plugin";

/**
 * Connect 4 room (M3 pilot).
 *
 * The Durable Object keeps everything the platform owns — seats, sockets,
 * clocks, receipts, persistence, archives and replay — and forwards the rules
 * to {@link connect4Plugin}. The class name, namespace, persisted state shape
 * and every public behaviour are unchanged from the pre-plugin implementation.
 *
 * Actions: drop_disc { col: 0-6 }
 */
export class Connect4Room extends BaseGameRoom<Connect4GameState> {
  protected readonly roomLabel = "Connect4Room";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return connect4Plugin;
  }

  protected get minPlayersToStart(): number {
    return connect4Plugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return connect4Plugin.initialTurnPhase;
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
  ): Connect4GameState {
    return connect4Plugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    connect4Plugin.start(this.gameState, {
      firstPlayerIndex: this.startingPlayerIndex(),
      now: Date.now(),
    });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...connect4Plugin.turnActions(this.gameState, playerId, {
        isSpectator: this.isSpectator(playerId),
      }),
    ];
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (!this.gameState) return base;

    return {
      ...base,
      ...connect4Plugin.seatIdentity(this.gameState, playerId, { isSpectator: base.isSpectator }),
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = connect4Plugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }
}
