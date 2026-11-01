import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { PaodekuaiGameState, Player } from "./types";
import { paodekuaiPlugin } from "../games/paodekuai/plugin";

/**
 * 跑得快 room (M4.3).
 *
 * Everything the platform owns — seats, sockets, clocks, receipts, persistence,
 * archives and replay — stays in {@link BaseGameRoom}; the rules live in
 * {@link paodekuaiPlugin}. The deal is drawn inside the rule module with the
 * platform CSPRNG, so an eviction cannot redeal, and the hands live in the state
 * so a restart resumes the same table.
 *
 * Phases: waiting → play → ended
 * Actions: play_cards { cards: [...] }, pass
 */
export class PaodekuaiRoom extends BaseGameRoom<PaodekuaiGameState> {
  protected readonly roomLabel = "PaodekuaiRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return paodekuaiPlugin;
  }

  protected get minPlayersToStart(): number {
    return paodekuaiPlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return paodekuaiPlugin.initialTurnPhase;
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
  ): PaodekuaiGameState {
    return paodekuaiPlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    paodekuaiPlugin.start(this.gameState, {
      firstPlayerIndex: this.startingPlayerIndex(),
      now: Date.now(),
    });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...paodekuaiPlugin.turnActions(this.gameState, playerId, {
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
      ...paodekuaiPlugin.seatIdentity(this.gameState, playerId, viewer),
      ...paodekuaiPlugin.youFields?.(this.gameState, playerId, viewer),
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = paodekuaiPlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }

  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    if (!this.gameState) return;

    this.applyGameEffects(
      paodekuaiPlugin.onTurnTimeout?.(this.gameState, playerId, Date.now()) ?? [],
    );
    await this.settleRuleTimeout();
  }
}
