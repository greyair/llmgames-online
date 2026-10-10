import { isWireObject, type WireValue } from "@llmgames/game-catalog";

import { isNumber } from "@llmgames/game-catalog";

import { Battle } from "@pkmn/sim";
import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";
import { BaseGameRoom } from "./BaseGameRoom";
import type { BaseGameState, Player, GameRoomConfig } from "./types";
import { randomId } from "../lib/csprng";
import { battleView, createBattle, decision, type BattleSeat } from "../games/pokemon/engine";

export interface PokemonGameState extends BaseGameState {
  type: "pokemon";
  battleSnapshot: string | null;
  battleSeats?: Record<string, BattleSeat>;
  winner: string | null;
}

type PokemonPublicState = Omit<PokemonGameState, "battleSnapshot">;

type PokemonProjection = PokemonPublicState &
  Partial<ReturnType<typeof battleView>> & { winnerSeat: BattleSeat | "draw" | null };

type PokemonRewatchProjection = PokemonPublicState & Partial<ReturnType<typeof battleView>>;

export class PokemonRoom extends BaseGameRoom<PokemonGameState> {
  protected readonly roomLabel = "PokemonRoom";
  protected get minPlayersToStart() {
    return 2;
  }
  protected get initialTurnPhase() {
    return "battle";
  }
  private cachedSnapshot: string | null = null;
  private cachedBattle: Battle | null = null;
  private engine(state = this.gameState): Battle | null {
    if (!state?.battleSnapshot) return null;

    if (this.cachedSnapshot !== state.battleSnapshot) {
      this.cachedBattle = Battle.fromJSON(state.battleSnapshot);
      this.cachedSnapshot = state.battleSnapshot;
    }

    return this.cachedBattle;
  }
  private seat(playerId: string, state = this.gameState): BattleSeat | null {
    return state?.battleSeats?.[playerId] ?? null;
  }
  protected createDefaultState(config: GameRoomConfig, roomCode: string): PokemonGameState {
    const now = Date.now();
    const turnTime = config.turnTime ?? 60_000;
    const gameTotalTime = config.gameTotalTime ?? 30 * 60_000;

    return {
      id: randomId(),
      roomCode,
      type: "pokemon",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: 2,
      timerConfig: { turnTime, gameTotalTime },
      gameTimeRemaining: gameTotalTime,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: turnTime,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ROOM_LIFETIME_MS,
      battleSnapshot: null,
      winner: null,
    };
  }
  protected onStartGame() {
    // Engine seats survive departures and roster changes for the whole battle.
    this.gameState!.battleSeats = Object.fromEntries(
      this.gameState!.players.map((player, index) => [player.id, index === 0 ? "p1" : "p2"]),
    );
    this.sync(createBattle(), true);
  }
  private sync(battle: Battle, newDecision: boolean, reason = "battle_complete") {
    const state = this.gameState;

    if (!state) return;
    state.battleSnapshot = JSON.stringify(battle.toJSON());
    this.cachedBattle = battle;
    this.cachedSnapshot = state.battleSnapshot;
    state.turnState.turnNumber = battle.turn;
    state.turnState.currentPlayerId = null;

    if (newDecision) {
      state.turnState.startedAt = Date.now();
      state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
    }

    if (battle.ended) {
      state.status = "ended";
      state.turnState.phase = "ended";
      state.winner = battle.winner
        ? (Object.entries(state.battleSeats ?? {}).find(
            ([, seat]) => seat === battle.winner,
          )?.[0] ?? null)
        : "draw";
      this.stopTimers();
      this.recordEvent("game_ended", { winner: state.winner, reason });
    } else state.turnState.phase = "battle";
  }
  protected isYourTurn(playerId: string) {
    const battle = this.engine();
    const seat = this.seat(playerId);

    return (
      this.gameState?.status === "playing" && Boolean(battle && seat && decision(battle, seat))
    );
  }
  protected getLegalActions(playerId: string) {
    const actions = super.getLegalActions(playerId);

    if (!this.isYourTurn(playerId)) return actions;
    const next = decision(this.engine()!, this.seat(playerId)!);

    if (next?.moves.some((move) => !move.disabled)) actions.push("pokemon_move");

    if (next?.switches.length) actions.push("pokemon_switch");

    return actions;
  }
  protected projectStateFor(playerId: string, state: PokemonGameState) {
    const { battleSnapshot: _private, ...publicState } = state;
    const battle = this.engine(state);

    const projected: PokemonProjection = {
      ...publicState,
      winnerSeat:
        state.winner === "draw" ? "draw" : state.winner ? this.seat(state.winner, state) : null,
    };

    if (battle) Object.assign(projected, battleView(battle, this.seat(playerId, state)));

    if (state.status !== "playing") Object.assign(projected, { decision: null });

    return projected;
  }
  protected buildRewatchView(): PokemonRewatchProjection | null {
    if (!this.gameState) return null;
    const { battleSnapshot: _private, ...publicState } = this.gameState;
    const battle = this.engine();

    const projected: PokemonRewatchProjection = { ...publicState };

    if (battle) Object.assign(projected, battleView(battle, null, true));

    return projected;
  }
  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!["pokemon_move", "pokemon_switch"].includes(payload.actionType))
      return "Unknown Pokémon action";

    if (!this.isYourTurn(player.id)) return "No decision is pending for you";
    const data = isWireObject(payload.data) ? payload.data : null;
    const slot = data?.slot;

    if (!isNumber(slot) || !Number.isInteger(slot))
      return "Choose an integer slot from your decision";
    const battle = this.engine()!;
    const seat = this.seat(player.id)!;
    const next = decision(battle, seat)!;
    const move = payload.actionType === "pokemon_move";

    if (
      !(move
        ? next.moves.some((m) => m.slot === slot && !m.disabled)
        : next.switches.some((p) => p.slot === slot))
    )
      return "That choice is not legal";
    const before = battle.turn;
    const phase = battle.requestState;

    if (!battle.choose(seat, `${move ? "move" : "switch"} ${slot}`))
      return battle.getSide(seat).choice.error || "Illegal choice";
    this.sync(battle, before !== battle.turn || phase !== battle.requestState);

    // Never record a sealed choice in public event logs.
    if (battle.ended) {
      await this.saveState();
      this.broadcastProjected("game_ended", { reason: "battle_complete" });
    }
  }
  protected async onTurnTimeout(): Promise<void> {
    const battle = this.engine();

    if (!battle || !this.gameState) return;

    const pending = (["p1", "p2"] as const).filter((id) => decision(battle, id));

    const before = battle.turn;
    const phase = battle.requestState;

    for (const seat of pending) {
      const next = decision(battle, seat);
      const move = next?.moves.find((candidate) => !candidate.disabled);

      const choice = move
        ? `move ${move.slot}`
        : next?.switches[0]
          ? `switch ${next.switches[0].slot}`
          : null;

      if (!choice || !battle.choose(seat, choice)) {
        battle.tie();
        break;
      }
    }

    this.sync(battle, before !== battle.turn || phase !== battle.requestState, "battle_complete");
    await this.saveState();

    if (battle.ended) this.broadcastProjected("game_ended", { reason: "battle_complete" });
    else this.broadcastState();
  }
  protected onGameTimeout(): void {
    const battle = this.engine();

    if (battle) {
      battle.tie();
      this.sync(battle, false, "time_up");
    }
  }
}
