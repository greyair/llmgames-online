import type { WireValue } from "@llmgames/game-catalog";

import { BaseGameRoom } from "../../../durable-objects/BaseGameRoom";
import type { RoomRuntime } from "../../../durable-objects/runtime";
import type { GameRoomConfig, Player } from "../../../durable-objects/types";
import type { Env } from "../../../types";
import { minimalGamePlugin, type MinimalGameState } from "./plugin";

/**
 * Adapter for the M3 fixture game.
 *
 * Every line here is platform glue a real game would also write: it owns no
 * rules, no validation and no win condition. If this class needs anything the
 * plugin contract cannot express, the contract — not the class — is wrong.
 */
export class MinimalGameRoom extends BaseGameRoom<MinimalGameState> {
  protected readonly roomLabel = "MinimalGameRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return minimalGamePlugin;
  }

  /** Test accessor: the authoritative state, including fields clients never see. */
  snapshot(): MinimalGameState {
    if (!this.gameState) throw new Error("Minimal fixture room has no game state");

    return this.gameState;
  }

  /** Test accessor: what a finished replay would record for this game. */
  rewatchForTest(): object | null {
    return this.buildRewatchView();
  }

  /** Test accessor: the browser projection for one seat. */
  browserForTest(playerId: string): object | null {
    return this.buildClientView(playerId);
  }

  /** Test accessor: stop the interval timers started by the match clock. */
  stopForTest(): void {
    this.stopTimers();
  }

  protected get minPlayersToStart(): number {
    return minimalGamePlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return minimalGamePlugin.initialTurnPhase;
  }

  protected createDefaultState(config: GameRoomConfig, roomCode: string): MinimalGameState {
    return minimalGamePlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    minimalGamePlugin.start(this.gameState, {
      firstPlayerIndex: this.startingPlayerIndex(),
      now: Date.now(),
    });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...minimalGamePlugin.turnActions(this.gameState, playerId, {
        isSpectator: this.isSpectator(playerId),
      }),
    ];
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (!this.gameState) return base;

    return {
      ...base,
      ...minimalGamePlugin.seatIdentity(this.gameState, playerId, { isSpectator: base.isSpectator }),
    };
  }

  protected projectStateFor(playerId: string, state: MinimalGameState): object {
    return minimalGamePlugin.projectState?.(state, playerId) ?? state;
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = minimalGamePlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }

  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    if (!this.gameState) return;

    this.applyGameEffects(
      minimalGamePlugin.onTurnTimeout?.(this.gameState, playerId, Date.now()) ?? [],
    );
    await this.settleRuleTimeout();
  }
}
