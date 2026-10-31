import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { ContextoGameState, GameRoomConfig, Player } from "./types";
import { contextoPlugin } from "../games/contexto/plugin";

/**
 * Contexto room (M3.7).
 *
 * The Durable Object keeps the platform concerns — seats, sockets, the shared
 * clock, receipts, persistence, archives and replay — and forwards the rules to
 * {@link contextoPlugin}. Class name, namespace and persisted state shape are
 * unchanged from the pre-plugin implementation.
 *
 * Contexto has no turn order: `turnState.currentPlayerId` stays null and every
 * seat guesses on its own clock, so the adapter never resolves a "current"
 * player.
 *
 * Action: guess_word { word }
 */

export {
  CONTEXTO_TARGET_COUNT,
  CONTEXTO_VOCABULARY_SIZE,
  createContextoRanking,
  contextoGuessFamily,
  contextoRank,
  contextoTarget,
  normalizeContextoWord,
} from "../lib/contextoRanks";

export { GUESS_LIMIT, bestPlayer, emptyProgress, projectContexto } from "../games/contexto/rules";

export class ContextoRoom extends BaseGameRoom<ContextoGameState> {
  protected readonly roomLabel = "ContextoRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return contextoPlugin;
  }

  protected get minPlayersToStart(): number {
    return contextoPlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return contextoPlugin.initialTurnPhase;
  }

  protected createDefaultState(
    config: GameRoomConfig & { roomCode?: string },
    roomCode: string,
  ): ContextoGameState {
    return contextoPlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    contextoPlugin.start(this.gameState, { firstPlayerIndex: 0, now: Date.now() });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...contextoPlugin.turnActions(this.gameState, playerId, {
        isSpectator: this.isSpectator(playerId),
      }),
    ];
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = contextoPlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) {
      // An out-of-pool word is refused, but the attempt is part of the state so
      // every client can label it; the platform only writes on request.
      if (result.persist) {
        await this.saveState();
        this.broadcastState();
      }

      return result.message;
    }

    this.applyGameEffects(result.effects);
  }

  protected async onTurnTimeout(): Promise<void> {
    if (!this.gameState) return;

    this.applyGameEffects(contextoPlugin.onTurnTimeout?.(this.gameState, null, Date.now()) ?? []);
    await this.settleRuleTimeout();
  }

  protected onGameTimeout(): void {
    if (!this.gameState) return;

    contextoPlugin.onMatchTimeout?.(this.gameState, Date.now());
  }
}
