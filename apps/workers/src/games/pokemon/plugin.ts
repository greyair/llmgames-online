import { ROOM_LIFETIME_MS, isNumber, isWireObject } from "@llmgames/game-catalog";

import { randomId } from "../../lib/csprng";
import type { GameRoomConfig } from "../../durable-objects/types";
import type {
  GameActionResult,
  GameEffect,
  GameIntent,
  GamePlugin,
  GameSeatIdentity,
} from "../contract";
import { battleView, createBattle, decision, type BattleSeat } from "./engine";
import { parseBattle, seatOf, syncBattle } from "./rules";
import type { PokemonGameState } from "./state";
import { pokemonAgentDecision } from "./agent";

/**
 * Pokémon as a game plugin (M3.8).
 *
 * The last and hardest migration: a turn is not one intent but two sealed
 * choices that resolve together. Both seats choose privately, the simulator
 * resolves when the second choice lands, and only then does the state publish a
 * new turn. That is why the platform's turn pointer never names a player here —
 * `mayActNow` answers per seat, exactly as it does for Contexto.
 *
 * The battle itself is `@pkmn/sim` state serialized into `battleSnapshot`. It
 * never leaves the server: every projection is built from `battleView`, which
 * masks the opponent's team, exact HP and pending choice.
 */

const DEFAULT_MATCH_MS = 30 * 60 * 1000;

const DEFAULT_TURN_MS = 60_000;

const PLAY_ACTIONS = ["pokemon_move", "pokemon_switch"] as const;

/** Public state plus the parts of the battle view the recipient may read. */
type PokemonProjection = Omit<PokemonGameState, "battleSnapshot"> &
  Partial<ReturnType<typeof battleView>> & { winnerSeat: BattleSeat | "draw" | null };

/** The rewatch reveals both teams, so it carries no winner seat and no decision. */
type PokemonRewatchProjection = Omit<PokemonGameState, "battleSnapshot"> &
  Partial<ReturnType<typeof battleView>>;

function choiceFor(actionType: string, slot: number): string {
  return `${actionType === "pokemon_move" ? "move" : "switch"} ${slot}`;
}

export const pokemonPlugin: GamePlugin<PokemonGameState, "pokemon"> = {
  id: "pokemon",
  minPlayersToStart: 2,
  initialTurnPhase: "battle",

  createInitialState(config: GameRoomConfig, roomCode: string, now: number) {
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;

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
  },

  start(state, context) {
    // Seats are fixed for the whole battle, even if the roster changes later.
    state.battleSeats = Object.fromEntries(
      state.players.map((player, index) => [player.id, index === 0 ? "p1" : "p2"]),
    );

    const battle = createBattle();

    syncBattle(state, battle, { newDecision: true, now: context.now });
  },

  /** Both seats decide at once, so "whose turn" is a per-seat question. */
  mayActNow(state, playerId) {
    if (state.status !== "playing") return false;

    const battle = parseBattle(state.battleSnapshot);
    const seat = seatOf(state, playerId);

    return Boolean(battle && seat && decision(battle, seat));
  },

  turnActions(state, playerId) {
    if (state.status !== "playing") return [];

    const battle = parseBattle(state.battleSnapshot);
    const seat = seatOf(state, playerId);

    if (!battle || !seat) return [];

    const next = decision(battle, seat);

    if (!next) return [];

    const actions: string[] = [];

    if (next.moves.some((move) => !move.disabled)) actions.push("pokemon_move");

    if (next.switches.length) actions.push("pokemon_switch");

    return actions;
  },

  /** Pokémon exposes no seat or role: the platform's defaults are what it shipped with. */
  seatIdentity(): GameSeatIdentity {
    return {};
  },

  applyAction(state, playerId, intent: GameIntent, now): GameActionResult {
    if (!PLAY_ACTIONS.some((action) => action === intent.actionType))
      return { ok: false, message: "Unknown Pokémon action" };

    const battle = parseBattle(state.battleSnapshot);
    const seat = seatOf(state, playerId);

    if (!battle || !seat) return { ok: false, message: "No decision is pending for you" };

    const next = decision(battle, seat);

    if (!next) return { ok: false, message: "No decision is pending for you" };

    const slot = isWireObject(intent.data) ? intent.data.slot : null;

    if (!isNumber(slot) || !Number.isInteger(slot))
      return { ok: false, message: "Choose an integer slot from your decision" };

    const legal =
      intent.actionType === "pokemon_move"
        ? next.moves.some((move) => move.slot === slot && !move.disabled)
        : next.switches.some((option) => option.slot === slot);

    if (!legal) return { ok: false, message: "That choice is not legal" };

    const turnBefore = battle.turn;
    const requestBefore = battle.requestState;

    if (!battle.choose(seat, choiceFor(intent.actionType, slot)))
      return { ok: false, message: battle.getSide(seat).choice.error || "Illegal choice" };

    // A sealed choice alone does not advance the turn, so only the resolution
    // that changes the turn or the request restarts the decision clock.
    const resolved = turnBefore !== battle.turn || requestBefore !== battle.requestState;
    const ended = syncBattle(state, battle, { newDecision: resolved, now });

    return { ok: true, effects: ended ? endEffects("battle_complete") : [] };
  },

  /**
   * A missed decision picks the first legal option for every seat that is still
   * undecided, then lets the simulator resolve — the same fallback players have
   * always had, so a slow seat cannot stall the match.
   */
  onTurnTimeout(state, _playerId, now) {
    const battle = parseBattle(state.battleSnapshot);

    if (!battle) return [];

    const pending = (["p1", "p2"] as const).filter((seat) => decision(battle, seat));
    const turnBefore = battle.turn;
    const requestBefore = battle.requestState;

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

    const resolved = turnBefore !== battle.turn || requestBefore !== battle.requestState;
    const ended = syncBattle(state, battle, { newDecision: resolved, now });

    return ended ? endEffects("battle_complete") : [];
  },

  /** The match clock running out decides the battle as a tie, then the platform ends it. */
  onMatchTimeout(state, now) {
    const battle = parseBattle(state.battleSnapshot);

    if (!battle) return;

    battle.tie();
    syncBattle(state, battle, { newDecision: false, now });
  },

  projectState(state, playerId) {
    const { battleSnapshot: _private, ...publicState } = state;
    const battle = parseBattle(state.battleSnapshot);

    const projected: PokemonProjection = {
      ...publicState,
      winnerSeat:
        state.winner === "draw" ? "draw" : state.winner ? seatOf(state, state.winner) : null,
    };

    if (battle) Object.assign(projected, battleView(battle, seatOf(state, playerId)));

    // A finished battle offers no decision to anyone.
    if (state.status !== "playing") Object.assign(projected, { decision: null });

    return projected;
  },

  /** The rewatch reveals both teams: every seat, every HP bar, every pending choice gone. */
  rewatchView(state) {
    const { battleSnapshot: _private, ...publicState } = state;
    const battle = parseBattle(state.battleSnapshot);

    const projected: PokemonRewatchProjection = { ...publicState };

    if (battle) Object.assign(projected, battleView(battle, null, true));

    return projected;
  },

  /** Mirrors the decision state agents already read, generated from the projection. */
  agentFields(projection) {
    return {
      format: projection.format,
      yourSeat: projection.yourSeat,
      sides: projection.sides,
      decision: projection.decision,
      battleLog: projection.battleLog,
      battleTurn: projection.battleTurn,
      winnerSeat: projection.winnerSeat,
    };
  },

  agentDecision: pokemonAgentDecision,
};

/** Platform work a finished battle asks for: stop clocks, log the end, archive. */
function endEffects(reason: string): GameEffect[] {
  return [
    { type: "stop_timers" },
    { type: "event", event: "game_ended", data: { reason } },
    { type: "match_ended", reason },
  ];
}

export type { PokemonGameState };
