import { ROOM_LIFETIME_MS, isNumber, isWireObject } from "@llmgames/game-catalog";

import { randomId } from "../../lib/csprng";
import type { Connect4GameState } from "../../durable-objects/types";
import type { GameEffect, GamePlugin } from "../contract";

import { dropInColumn, emptyConnect4Board, hasConnect4, isConnect4BoardFull } from "./rules";

const DEFAULT_MATCH_MS = 15 * 60 * 1000;

const DEFAULT_TURN_MS = 60 * 1000;

/** Server-authoritative Connect 4 (1v1). Intent: `drop_disc { col: 0–6 }`. */
export const connect4Plugin: GamePlugin<Connect4GameState, "connect4"> = {
  id: "connect4",
  minPlayersToStart: 2,
  initialTurnPhase: "play",

  createInitialState(config, roomCode, now) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;

    return {
      id: randomId(),
      roomCode,
      type: "connect4",
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
      board: emptyConnect4Board(),
      seats: {},
      winner: null,
      lastMove: null,
    };
  },

  start(state, context) {
    const players = state.players;
    const first = players[context.firstPlayerIndex];
    const second = players[(context.firstPlayerIndex + 1) % players.length];

    if (!first || !second) return;

    state.seats = { [first.id]: 1, [second.id]: 2 };
    state.board = emptyConnect4Board();
    state.winner = null;
    state.lastMove = null;
    state.turnState.currentPlayerId = first.id;
    state.turnState.phase = "play";
    state.turnState.turnNumber = 1;
  },

  turnActions(state, playerId, viewer) {
    if (viewer.isSpectator) return [];

    if (state.status !== "playing") return [];

    if (state.turnState.currentPlayerId !== playerId) return [];

    if (state.turnState.phase !== "play") return [];

    return ["drop_disc"];
  },

  seatIdentity(state, playerId, viewer) {
    if (viewer.isSpectator) return { seat: null, role: "spectator" };

    const seat = state.seats[playerId] ?? null;

    return { seat, role: seat === 1 ? "player1" : seat === 2 ? "player2" : null };
  },

  applyAction(state, playerId, intent, now) {
    if (intent.actionType !== "drop_disc" && intent.actionType !== "drop") {
      return { ok: false, message: `Unknown action: ${intent.actionType}` };
    }

    if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

    if (state.turnState.currentPlayerId !== playerId) return { ok: false, message: "Not your turn" };

    if (state.turnState.phase !== "play") return { ok: false, message: "Not play phase" };

    const data = intent.data;
    const col = isWireObject(data) ? (data.col ?? data.column) : undefined;

    if (!isNumber(col) || !Number.isInteger(col) || col < 0 || col >= 7)
      return { ok: false, message: "Column must be integer 0–6" };

    const seat = state.seats[playerId];

    if (!seat) return { ok: false, message: "No seat assigned" };

    const row = dropInColumn(state.board, col, seat);

    if (row === null) return { ok: false, message: "Column is full" };

    const effects: GameEffect[] = [
      { type: "event", event: "drop_disc", data: { playerId, seat, col, row } },
    ];

    state.lastMove = { col, row, seat };

    if (hasConnect4(state.board, row, col)) {
      state.winner = playerId;
      state.status = "ended";
      state.turnState.phase = "ended";
      effects.push(
        { type: "stop_timers" },
        { type: "event", event: "game_ended", data: { reason: "connect4", winner: playerId } },
        { type: "match_ended", reason: "connect4" },
      );

      return { ok: true, effects };
    }

    if (isConnect4BoardFull(state.board)) {
      state.winner = "draw";
      state.status = "ended";
      state.turnState.phase = "ended";
      effects.push(
        { type: "stop_timers" },
        { type: "event", event: "game_ended", data: { reason: "draw", winner: "draw" } },
        { type: "match_ended", reason: "draw" },
      );

      return { ok: true, effects };
    }

    const next = state.players.find((player) => player.id !== playerId);

    state.turnState.currentPlayerId = next?.id ?? null;
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

  agentFields(projection) {
    return { board: projection.board, seats: projection.seats, lastMove: projection.lastMove };
  },
};
