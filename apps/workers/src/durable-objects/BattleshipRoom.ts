import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { BattleshipGameState, Player } from "./types";
import { battleshipPlugin } from "../games/battleship/plugin";

/**
 * Battleship room (M3.5).
 *
 * Platform concerns stay here; the rules — fleets, fog of war, munitions,
 * special weapons, the mine retaliation and both timeout policies — live in
 * {@link battleshipPlugin}. Class name, namespace and persisted state shape are
 * unchanged from the pre-plugin implementation, so live rooms keep restoring.
 *
 * Phases: placement → battle → ended
 * Actions: place_fleet, cannon (fire/shoot), mine, radar, bomb, torpedo
 */

export { BATTLESHIP_PLACEMENT_TIME_MS } from "../games/battleship/plugin";

export class BattleshipRoom extends BaseGameRoom<BattleshipGameState> {
  protected readonly roomLabel = "BattleshipRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return battleshipPlugin;
  }

  protected get minPlayersToStart(): number {
    return battleshipPlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return battleshipPlugin.initialTurnPhase;
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
  ): BattleshipGameState {
    return battleshipPlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    battleshipPlugin.start(this.gameState, {
      firstPlayerIndex: this.startingPlayerIndex(),
      now: Date.now(),
    });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...battleshipPlugin.turnActions(this.gameState, playerId, {
        isSpectator: this.isSpectator(playerId),
      }),
    ];
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (!this.gameState) return base;

    const viewer = { isSpectator: base.isSpectator };

    // A watching host keeps no game controls: the pre-plugin room replaced the
    // legal action list with `leave` for every spectator.
    if (base.isSpectator)
      return {
        ...base,
        ...battleshipPlugin.seatIdentity(this.gameState, playerId, viewer),
        isYourTurn: false,
        ready: false,
        legalActions: ["leave"],
      };

    return {
      ...base,
      ...battleshipPlugin.seatIdentity(this.gameState, playerId, viewer),
      ...battleshipPlugin.youFields?.(this.gameState, playerId, viewer),
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = battleshipPlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }

  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    if (!this.gameState) return;

    this.applyGameEffects(
      battleshipPlugin.onTurnTimeout?.(this.gameState, playerId, Date.now()) ?? [],
    );
    await this.settleRuleTimeout();
  }
}
