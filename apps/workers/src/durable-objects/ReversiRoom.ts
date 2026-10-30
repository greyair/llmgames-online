import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { Player, ReversiGameState } from "./types";
import { reversiPlugin } from "../games/reversi/plugin";

/**
 * Reversi room (M3.3).
 *
 * The Durable Object keeps the platform concerns — seats, sockets, clocks,
 * receipts, persistence, archives and replay — and forwards the rules to
 * {@link reversiPlugin}. Class name, namespace and persisted state shape are
 * unchanged from the pre-plugin implementation.
 *
 * Action: place_disc { row, col }
 */

export {
  REVERSI_SIZE,
  applyReversiMove,
  countReversiDiscs,
  createInitialReversiBoard,
  getReversiFlips,
  getReversiLegalMoves,
} from "../games/reversi/rules";

export class ReversiRoom extends BaseGameRoom<ReversiGameState> {
  protected readonly roomLabel = "ReversiRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return reversiPlugin;
  }

  protected get minPlayersToStart(): number {
    return reversiPlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return reversiPlugin.initialTurnPhase;
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
  ): ReversiGameState {
    return reversiPlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    reversiPlugin.start(this.gameState, {
      firstPlayerIndex: this.startingPlayerIndex(),
      now: Date.now(),
    });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...reversiPlugin.turnActions(this.gameState, playerId, {
        isSpectator: this.isSpectator(playerId),
      }),
    ];
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (!this.gameState) return base;

    return {
      ...base,
      ...reversiPlugin.seatIdentity(this.gameState, playerId, { isSpectator: base.isSpectator }),
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = reversiPlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }

  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    if (!this.gameState) return;

    this.applyGameEffects(
      reversiPlugin.onTurnTimeout?.(this.gameState, playerId, Date.now()) ?? [],
    );
    await this.settleRuleTimeout();
  }

  protected onGameTimeout(): void {
    if (!this.gameState) return;

    reversiPlugin.onMatchTimeout?.(this.gameState, Date.now());
  }
}
