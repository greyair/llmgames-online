import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { AeroplaneGameState, Player } from "./types";
import { aeroplanePlugin } from "../games/aeroplane/plugin";

/**
 * Aeroplane Chess room (M4.2).
 *
 * Everything the platform owns — seats, sockets, clocks, receipts, persistence,
 * archives and replay — stays in {@link BaseGameRoom}; the rules live in
 * {@link aeroplanePlugin}. The die is rolled inside the rule module with the
 * platform CSPRNG and stored in the state, so an eviction, a repeat of the same
 * `requestId` or a Durable Object restart can never roll it twice.
 *
 * Phases: waiting → roll → choose → roll … → ended
 * Actions: roll, launch_plane { plane: 1-4 }, move_plane { plane: 1-4 }
 */
export class AeroplaneRoom extends BaseGameRoom<AeroplaneGameState> {
  protected readonly roomLabel = "AeroplaneRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return aeroplanePlugin;
  }

  protected get minPlayersToStart(): number {
    return aeroplanePlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return aeroplanePlugin.initialTurnPhase;
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
  ): AeroplaneGameState {
    return aeroplanePlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    aeroplanePlugin.start(this.gameState, {
      firstPlayerIndex: this.startingPlayerIndex(),
      now: Date.now(),
    });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...aeroplanePlugin.turnActions(this.gameState, playerId, {
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
      ...aeroplanePlugin.seatIdentity(this.gameState, playerId, viewer),
      ...aeroplanePlugin.youFields?.(this.gameState, playerId, viewer),
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = aeroplanePlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }

  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    if (!this.gameState) return;

    this.applyGameEffects(
      aeroplanePlugin.onTurnTimeout?.(this.gameState, playerId, Date.now()) ?? [],
    );
    await this.settleRuleTimeout();
  }
}
