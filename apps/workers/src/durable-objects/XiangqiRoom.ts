import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { XiangqiGameState, Player } from "./types";
import { xiangqiPlugin } from "../games/xiangqi/plugin";

/**
 * 中国象棋 room (M4.5).
 *
 * Everything the platform owns — seats, sockets, clocks, receipts, persistence,
 * archives and replay — stays in {@link BaseGameRoom}; the rules live in
 * {@link xiangqiPlugin}. This adapter exists only because Durable Object classes
 * are a deployment shape, not a rule concept.
 *
 * Phases: waiting → play → ended
 * Actions: move { from, to } in ICCS points ("h2" → "e2"), or move { iccs: "h2e2" }
 */
export class XiangqiRoom extends BaseGameRoom<XiangqiGameState> {
  protected readonly roomLabel = "XiangqiRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return xiangqiPlugin;
  }

  protected get minPlayersToStart(): number {
    return xiangqiPlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return xiangqiPlugin.initialTurnPhase;
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
  ): XiangqiGameState {
    return xiangqiPlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    xiangqiPlugin.start(this.gameState, {
      firstPlayerIndex: this.startingPlayerIndex(),
      now: Date.now(),
    });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...xiangqiPlugin.turnActions(this.gameState, playerId, {
        isSpectator: this.isSpectator(playerId),
      }),
    ];
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (!this.gameState) return base;

    return {
      ...base,
      ...xiangqiPlugin.seatIdentity(this.gameState, playerId, { isSpectator: base.isSpectator }),
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = xiangqiPlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }
}
