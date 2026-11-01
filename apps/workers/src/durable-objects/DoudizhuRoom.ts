import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { DoudizhuGameState, Player } from "./types";
import { doudizhuPlugin } from "../games/doudizhu/plugin";

/**
 * 斗地主 room (M4.3).
 *
 * Everything the platform owns — seats, sockets, clocks, receipts, persistence,
 * archives and replay — stays in {@link BaseGameRoom}; the rules live in
 * {@link doudizhuPlugin}. Both deals and the auction are state, so an eviction,
 * a repeated `requestId` or a restart resumes the same table and the same bids.
 *
 * Phases: waiting → bid → play → ended
 * Actions: bid { value: 0-3 }, play_cards { cards: [...] }, pass
 */
export class DoudizhuRoom extends BaseGameRoom<DoudizhuGameState> {
  protected readonly roomLabel = "DoudizhuRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return doudizhuPlugin;
  }

  protected get minPlayersToStart(): number {
    return doudizhuPlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return doudizhuPlugin.initialTurnPhase;
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
  ): DoudizhuGameState {
    return doudizhuPlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    doudizhuPlugin.start(this.gameState, {
      firstPlayerIndex: this.startingPlayerIndex(),
      now: Date.now(),
    });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...doudizhuPlugin.turnActions(this.gameState, playerId, {
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
      ...doudizhuPlugin.seatIdentity(this.gameState, playerId, viewer),
      ...doudizhuPlugin.youFields?.(this.gameState, playerId, viewer),
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = doudizhuPlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }

  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    if (!this.gameState) return;

    this.applyGameEffects(
      doudizhuPlugin.onTurnTimeout?.(this.gameState, playerId, Date.now()) ?? [],
    );
    await this.settleRuleTimeout();
  }
}
