import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { MonopolyGameState, Player } from "./types";
import { monopolyPlugin } from "../games/monopoly/plugin";

/**
 * 大富翁 room (M4.4).
 *
 * Everything the platform owns — seats, sockets, clocks, receipts, persistence,
 * archives and replay — stays in {@link BaseGameRoom}; the rules live in
 * {@link monopolyPlugin}. The dice and the chance deck are drawn inside the rule
 * module from the platform CSPRNG and stored, so an eviction cannot re-roll and a
 * restart resumes the same board.
 *
 * Phases: waiting → roll → buy → end → roll … → ended
 * Actions: roll, buy, skip, build { space }, pay, card, end
 */
export class MonopolyRoom extends BaseGameRoom<MonopolyGameState> {
  protected readonly roomLabel = "MonopolyRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return monopolyPlugin;
  }

  protected get minPlayersToStart(): number {
    return monopolyPlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return monopolyPlugin.initialTurnPhase;
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
  ): MonopolyGameState {
    return monopolyPlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    monopolyPlugin.start(this.gameState, {
      firstPlayerIndex: this.startingPlayerIndex(),
      now: Date.now(),
    });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...monopolyPlugin.turnActions(this.gameState, playerId, {
        isSpectator: this.isSpectator(playerId),
      }),
    ];
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (!this.gameState) return base;

    const viewer = { isSpectator: base.isSpectator };

    return {
      ...base,
      ...monopolyPlugin.seatIdentity(this.gameState, playerId, viewer),
      ...monopolyPlugin.youFields?.(this.gameState, playerId, viewer),
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = monopolyPlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }

  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    if (!this.gameState) return;

    this.applyGameEffects(
      monopolyPlugin.onTurnTimeout?.(this.gameState, playerId, Date.now()) ?? [],
    );
    await this.settleRuleTimeout();
  }
}
