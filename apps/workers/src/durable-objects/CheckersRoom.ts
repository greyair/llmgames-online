import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { CheckersGameState, Player } from "./types";
import { checkersPlugin } from "../games/checkers/plugin";

/**
 * Checkers room (M3.4).
 *
 * Platform concerns stay here; the rules — mandatory captures, jump chains,
 * crowning, repetition and the quiet-turn draw — live in
 * {@link checkersPlugin}. Class name, namespace and persisted state shape are
 * unchanged from the pre-plugin implementation.
 *
 * Action: move_checker { fromRow, fromCol, row, col }
 */

export {
  CHECKERS_QUIET_TURN_LIMIT,
  CHECKERS_REPETITION_LIMIT,
  CHECKERS_SIZE,
  checkersSeat,
  countCheckersPieces,
  createInitialCheckersBoard,
  getCheckersLegalMoves,
} from "../games/checkers/rules";

export class CheckersRoom extends BaseGameRoom<CheckersGameState> {
  protected readonly roomLabel = "CheckersRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return checkersPlugin;
  }

  protected get minPlayersToStart(): number {
    return checkersPlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return checkersPlugin.initialTurnPhase;
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
  ): CheckersGameState {
    return checkersPlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    checkersPlugin.start(this.gameState, {
      firstPlayerIndex: this.startingPlayerIndex(),
      now: Date.now(),
    });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...checkersPlugin.turnActions(this.gameState, playerId, {
        isSpectator: this.isSpectator(playerId),
      }),
    ];
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (!this.gameState) return base;

    return {
      ...base,
      ...checkersPlugin.seatIdentity(this.gameState, playerId, {
        isSpectator: base.isSpectator,
      }),
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = checkersPlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }

  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    if (!this.gameState) return;

    this.applyGameEffects(
      checkersPlugin.onTurnTimeout?.(this.gameState, playerId, Date.now()) ?? [],
    );
    await this.settleRuleTimeout();
  }

  protected onGameTimeout(): void {
    if (!this.gameState) return;

    checkersPlugin.onMatchTimeout?.(this.gameState, Date.now());
  }
}
