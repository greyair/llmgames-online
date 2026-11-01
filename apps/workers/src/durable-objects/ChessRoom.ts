import type { WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { ChessGameState, Player } from "./types";
import { chessPlugin } from "../games/chess/plugin";

/**
 * Chess room (M4.5).
 *
 * Everything the platform owns — seats, sockets, clocks, receipts, persistence,
 * archives and replay — stays in {@link BaseGameRoom}; the rules live in
 * {@link chessPlugin}. This adapter exists only because Durable Object classes
 * are a deployment shape, not a rule concept.
 *
 * Phases: waiting → play → ended
 * Actions: move { from, to, promotion? } or move { uci: "e2e4" }
 */
export class ChessRoom extends BaseGameRoom<ChessGameState> {
  protected readonly roomLabel = "ChessRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return chessPlugin;
  }

  protected get minPlayersToStart(): number {
    return chessPlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return chessPlugin.initialTurnPhase;
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
  ): ChessGameState {
    return chessPlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    chessPlugin.start(this.gameState, {
      firstPlayerIndex: this.startingPlayerIndex(),
      now: Date.now(),
    });
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...chessPlugin.turnActions(this.gameState, playerId, {
        isSpectator: this.isSpectator(playerId),
      }),
    ];
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (!this.gameState) return base;

    return {
      ...base,
      ...chessPlugin.seatIdentity(this.gameState, playerId, { isSpectator: base.isSpectator }),
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const result = chessPlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }
}
