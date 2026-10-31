import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { GameRoomConfig, Player, PokerGameState } from "./types";
import { pokerPlugin } from "../games/poker/plugin";

/**
 * Poker room (M3.9).
 *
 * The Durable Object keeps the platform concerns — seats, sockets, clocks,
 * receipts, persistence, archives and replay — and forwards the rules to
 * {@link pokerPlugin}. Class name, namespace and persisted state shape are
 * unchanged from the pre-plugin implementation.
 *
 * Two details stay here because they belong to the room rather than the rules:
 * the platform's own action list, and the five-second result window the plugin
 * publishes through `decisionReadyAt`.
 *
 * Actions: fold | check | call | bet | raise | all_in | next_hand
 */

export { PokerTable, parsePokerWagerInput, type PokerWagerInput } from "../games/poker/table";

export { HAND_RESULT_HOLD_MS } from "../games/poker/plugin";

export class PokerRoom extends BaseGameRoom<PokerGameState> {
  protected readonly roomLabel = "PokerRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return pokerPlugin;
  }

  protected get minPlayersToStart(): number {
    return pokerPlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return pokerPlugin.initialTurnPhase;
  }

  protected createDefaultState(
    config: GameRoomConfig & { roomCode?: string },
    roomCode: string,
  ): PokerGameState {
    return pokerPlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    pokerPlugin.start(this.gameState, { firstPlayerIndex: 0, now: Date.now() });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...pokerPlugin.turnActions(this.gameState, playerId, {
        isSpectator: this.isSpectator(playerId),
      }),
    ];
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (!this.gameState) return base;

    return {
      ...base,
      ...pokerPlugin.youFields?.(this.gameState, playerId, {
        isSpectator: base.isSpectator,
      }),
    };
  }

  protected agentDecisionReadyAt(): number {
    if (!this.gameState) return 0;

    return pokerPlugin.decisionReadyAt?.(this.gameState) ?? 0;
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = pokerPlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }

  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    if (!this.gameState) return;

    this.applyGameEffects(pokerPlugin.onTurnTimeout?.(this.gameState, playerId, Date.now()) ?? []);
    await this.settleRuleTimeout();
  }
}
