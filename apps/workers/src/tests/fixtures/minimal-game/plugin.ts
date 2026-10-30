import { ROOM_LIFETIME_MS, isNumber, isWireObject } from "@llmgames/game-catalog";

import { randomId } from "../../../lib/csprng";
import type { BaseGameState, BaseTurnState } from "../../../durable-objects/types";
import type { GameEffect, GamePlugin } from "../../../games/contract";

/**
 * Minimal two-player game used to prove the M3 contract end to end.
 *
 * It is deliberately small but not trivial: two seats, hidden per-player
 * numbers, one legal intent, several refusal paths, a deterministic win at
 * three points and a timeout policy that differs from the platform default
 * (pass the turn twice, then forfeit).
 *
 * This game is not in the public catalog and has no namespace: it runs through
 * the same `BaseGameRoom` lifecycle as a shipped room.
 */
export const MINIMAL_TARGET_POINTS = 3;

export const MINIMAL_TIMEOUTS_TO_FORFEIT = 3;

export const MINIMAL_DEFAULT_MATCH_MS = 10 * 60 * 1000;

export const MINIMAL_DEFAULT_TURN_MS = 30 * 1000;

/** Points a stake may add: enough choice to need validation, small enough to reason about. */
export const MINIMAL_STAKE_OPTIONS = [1, 2] as const;

export interface MinimalGameState extends BaseGameState {
  type: "minimal";
  turnState: BaseTurnState & { phase: "waiting" | "play" | "ended" };
  /** Public running totals. */
  scores: Record<string, number>;
  /** First player to reach this total wins. */
  target: number;
  /** Private per-player number; only its owner ever sees it. */
  secrets: Record<string, number>;
  /** Timeouts this player has already used; three forfeits the match. */
  timeouts: Record<string, number>;
  winner: string | null;
}

function nextPlayerId(state: MinimalGameState, playerId: string): string | null {
  const next = state.players.find((player) => player.id !== playerId);

  return next?.id ?? null;
}

function closeMatch(state: MinimalGameState, winner: string | null, reason: string): GameEffect[] {
  state.status = "ended";
  state.turnState.phase = "ended";
  state.turnState.currentPlayerId = null;
  state.winner = winner;

  return [
    { type: "stop_timers" },
    { type: "event", event: "game_ended", data: { reason, winner } },
    { type: "match_ended", reason },
  ];
}

export const minimalGamePlugin: GamePlugin<MinimalGameState, "minimal"> = {
  id: "minimal",
  minPlayersToStart: 2,
  initialTurnPhase: "play",

  createInitialState(config, roomCode, now) {
    const gameTotalTime = config.gameTotalTime ?? MINIMAL_DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? MINIMAL_DEFAULT_TURN_MS;

    return {
      id: randomId(),
      roomCode,
      type: "minimal",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: 2,
      timerConfig: { gameTotalTime, turnTime },
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
      scores: {},
      target: MINIMAL_TARGET_POINTS,
      secrets: {},
      timeouts: {},
      winner: null,
    };
  },

  start(state, context) {
    const first = state.players[context.firstPlayerIndex];
    const second = state.players[(context.firstPlayerIndex + 1) % state.players.length];

    if (!first || !second) return;

    state.scores = { [first.id]: 0, [second.id]: 0 };
    // The hidden number is derived from the server clock, never from a client.
    state.secrets = { [first.id]: (context.now % 7) + 1, [second.id]: (context.now % 5) + 1 };
    state.timeouts = { [first.id]: 0, [second.id]: 0 };
    state.winner = null;
    state.turnState.currentPlayerId = first.id;
    state.turnState.phase = "play";
    state.turnState.turnNumber = 1;
  },

  turnActions(state, playerId, viewer) {
    if (viewer.isSpectator) return [];

    if (state.status !== "playing") return [];

    return state.turnState.currentPlayerId === playerId ? ["stake"] : [];
  },

  seatIdentity(state, playerId, viewer) {
    if (viewer.isSpectator) return { seat: null, role: "spectator" };

    const index = state.players.findIndex((player) => player.id === playerId);

    return { seat: index >= 0 ? index + 1 : null, role: index >= 0 ? `player${index + 1}` : null };
  },

  applyAction(state, playerId, intent, now) {
    if (intent.actionType !== "stake") return { ok: false, message: `Unknown action: ${intent.actionType}` };

    if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

    if (state.turnState.currentPlayerId !== playerId) return { ok: false, message: "Not your turn" };

    const points = isWireObject(intent.data) ? intent.data.points : undefined;

    if (!isNumber(points) || !Number.isInteger(points) || points < 1 || points > 2)
      return { ok: false, message: "Points must be integer 1–2" };

    state.scores[playerId] = (state.scores[playerId] ?? 0) + points;

    const effects: GameEffect[] = [
      { type: "event", event: "stake", data: { playerId, points, score: state.scores[playerId] } },
    ];

    if ((state.scores[playerId] ?? 0) >= state.target) {
      effects.push(...closeMatch(state, playerId, "target_reached"));

      return { ok: true, effects };
    }

    state.turnState.currentPlayerId = nextPlayerId(state, playerId);
    state.turnState.turnNumber++;
    state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
    state.turnState.startedAt = now;

    effects.push({
      type: "event",
      event: "turn_changed",
      data: {
        currentPlayerId: state.turnState.currentPlayerId,
        turnNumber: state.turnState.turnNumber,
        phase: "play",
      },
    });

    return { ok: true, effects };
  },

  onTurnTimeout(state, playerId) {
    if (state.status !== "playing" || !playerId) return [];

    const used = (state.timeouts[playerId] ?? 0) + 1;

    state.timeouts[playerId] = used;

    if (used >= MINIMAL_TIMEOUTS_TO_FORFEIT)
      return closeMatch(state, nextPlayerId(state, playerId), "timeouts");

    state.turnState.currentPlayerId = nextPlayerId(state, playerId);
    state.turnState.turnNumber++;
    state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
    state.turnState.startedAt = Date.now();

    return [];
  },

  projectState(state, playerId) {
    return { ...state, secrets: { [playerId]: state.secrets[playerId] ?? null } };
  },

  agentFields(state) {
    return { scores: state.scores, target: state.target };
  },
};
