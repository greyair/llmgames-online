import { ROOM_LIFETIME_MS, isNumber, isWireObject } from "@llmgames/game-catalog";

import { randomId } from "../../lib/csprng";
import type { GomokuGameState } from "../../durable-objects/types";
import type { GameEffect, GamePlugin } from "../contract";

import {
  GOMOKU_SIZE,
  emptyGomokuBoard,
  gomokuCoordinate,
  gomokuWinLine,
  isGomokuBoardFull,
  isGomokuPointOnBoard,
} from "./rules";
import { gomokuAgentDecision } from "./agent";
import { gomokuRuleBot } from "./bot";

const DEFAULT_MATCH_MS = ROOM_LIFETIME_MS;

const DEFAULT_TURN_MS = 60 * 1000;

/**
 * Gomoku (freestyle, 15×15). Intent: `place_stone { row: 0–14, col: 0–14 }`.
 *
 * Seat 1 is black and moves first, matching the source module's `seatOf(color)`.
 * The board is fully public, so `projectState` is not overridden: hiding a
 * gomoku stone would change the rules, not the privacy.
 */
export const gomokuPlugin: GamePlugin<GomokuGameState, "gomoku"> = {
  id: "gomoku",
  minPlayersToStart: 2,
  initialTurnPhase: "play",

  createInitialState(config, roomCode, now) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;

    return {
      id: randomId(),
      roomCode,
      type: "gomoku",
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
      board: emptyGomokuBoard(),
      seats: {},
      winner: null,
      lastMove: null,
      winLine: null,
    };
  },

  start(state, context) {
    const players = state.players;
    const first = players[context.firstPlayerIndex];
    const second = players[(context.firstPlayerIndex + 1) % players.length];

    if (!first || !second) return;

    // Seat 1 moves first. The platform may have chosen either player as the
    // starting player, so the assignment follows the draw rather than the join
    // order: the starter is always black.
    state.seats = { [first.id]: 1, [second.id]: 2 };
    state.board = emptyGomokuBoard();
    state.winner = null;
    state.lastMove = null;
    state.winLine = null;
    state.turnState.currentPlayerId = first.id;
    state.turnState.phase = "play";
    state.turnState.turnNumber = 1;
  },

  turnActions(state, playerId, viewer) {
    if (viewer.isSpectator) return [];

    if (state.status !== "playing") return [];

    if (state.turnState.currentPlayerId !== playerId) return [];

    if (state.turnState.phase !== "play") return [];

    return ["place_stone"];
  },

  seatIdentity(state, playerId, viewer) {
    if (viewer.isSpectator) return { seat: null, role: "spectator" };

    const seat = state.seats[playerId] ?? null;

    return {
      seat,
      role: seat === 1 ? "black" : seat === 2 ? "white" : null,
      color: seat === 1 ? "black" : seat === 2 ? "white" : null,
    };
  },

  applyAction(state, playerId, intent, now) {
    if (
      intent.actionType !== "place_stone" &&
      intent.actionType !== "place" &&
      intent.actionType !== "play_stone"
    ) {
      return { ok: false, message: `Unknown action: ${intent.actionType}` };
    }

    if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

    if (state.turnState.currentPlayerId !== playerId) return { ok: false, message: "Not your turn" };

    if (state.turnState.phase !== "play") return { ok: false, message: "Not play phase" };

    const seat = state.seats[playerId];

    if (!seat) return { ok: false, message: "No seat assigned" };

    const data = intent.data;
    const row = isWireObject(data) ? data.row : undefined;
    const col = isWireObject(data) ? data.col : undefined;

    if (!isNumber(row) || !isNumber(col) || !isGomokuPointOnBoard(row, col))
      return { ok: false, message: `Row and column must be integers 0–${GOMOKU_SIZE - 1}` };

    if (state.board[row]![col] !== 0) return { ok: false, message: "That point already has a stone" };

    state.board[row]![col] = seat === 1 ? 1 : 2;
    state.lastMove = { row, col, seat };

    const effects: GameEffect[] = [
      {
        type: "event",
        event: "place_stone",
        data: { playerId, seat, row, col, coordinate: gomokuCoordinate(row, col) },
      },
    ];

    const winLine = gomokuWinLine(state.board, row, col);

    if (winLine) {
      state.winner = playerId;
      state.status = "ended";
      state.turnState.phase = "ended";
      state.winLine = winLine;
      effects.push(
        { type: "stop_timers" },
        {
          type: "event",
          event: "game_ended",
          data: { reason: "five_in_a_row", winner: playerId, length: winLine.length },
        },
        { type: "match_ended", reason: "five_in_a_row" },
      );

      return { ok: true, effects };
    }

    if (isGomokuBoardFull(state.board)) {
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
    return {
      board: projection.board,
      seats: projection.seats,
      lastMove: projection.lastMove,
      winLine: projection.winLine,
    };
  },

  agentDecision: gomokuAgentDecision,

  /** Free, deterministic seat (C4): win, block, then shape near the centre. */
  ruleBot: gomokuRuleBot,
};
