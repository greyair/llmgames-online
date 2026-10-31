import { ROOM_LIFETIME_MS, isNumber, isWireObject } from "@llmgames/game-catalog";

import { randomId } from "../../lib/csprng";
import type { ReversiCell, ReversiGameState, ReversiMove } from "../../durable-objects/types";
import type { GameEffect, GamePlugin } from "../contract";

import {
  REVERSI_SIZE,
  applyReversiMove,
  countReversiDiscs,
  createInitialReversiBoard,
  getReversiLegalMoves,
  isOnReversiBoard,
} from "./rules";
import { reversiAgentDecision } from "./agent";

const DEFAULT_MATCH_MS = 20 * 60 * 1000;

const DEFAULT_TURN_MS = 60 * 1000;

function opponentSeat(seat: 1 | 2): 1 | 2 {
  return seat === 1 ? 2 : 1;
}

function playerInSeat(state: ReversiGameState, seat: 1 | 2): string | undefined {
  return state.players.find((player) => state.seats[player.id] === seat)?.id;
}

/** Highest disc count wins; equal counts draw. */
function setWinnerFromScores(state: ReversiGameState): void {
  state.scores = countReversiDiscs(state.board);

  if (state.scores[1] === state.scores[2]) {
    state.winner = "draw";

    return;
  }

  state.winner = playerInSeat(state, state.scores[1] > state.scores[2] ? 1 : 2) ?? "draw";
}

/**
 * Hand the turn to whoever can actually move.
 *
 * - the opponent moves when they have a legal placement;
 * - otherwise the same player moves again and the skipped seat is recorded as a pass;
 * - otherwise neither can move and the match ends on disc count.
 *
 * A timeout passes the same way but records no `turn_passed` event, matching the
 * behaviour every Reversi room has shipped with.
 */
function advanceTurn(
  state: ReversiGameState,
  playerId: string,
  seat: 1 | 2,
  now: number,
  recordPass: boolean,
): GameEffect[] {
  const opponent = opponentSeat(seat);
  const opponentPlayerId = playerInSeat(state, opponent);
  const opponentMoves = getReversiLegalMoves(state.board, opponent);
  const effects: GameEffect[] = [];

  state.turnState.turnNumber++;
  state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
  state.turnState.startedAt = now;

  const recordTurnChanged = () => {
    effects.push({
      type: "event",
      event: "turn_changed",
      data: {
        currentPlayerId: state.turnState.currentPlayerId,
        turnNumber: state.turnState.turnNumber,
        phase: "play",
      },
    });
  };

  if (opponentPlayerId && opponentMoves.length > 0) {
    state.turnState.currentPlayerId = opponentPlayerId;
    state.legalMoves = opponentMoves;
    recordTurnChanged();

    return effects;
  }

  const currentMoves = getReversiLegalMoves(state.board, seat);

  if (currentMoves.length > 0) {
    if (recordPass && opponentPlayerId) {
      state.lastPass = {
        playerId: opponentPlayerId,
        seat: opponent,
        turn: state.turnState.turnNumber,
      };
      effects.push({
        type: "event",
        event: "turn_passed",
        data: { playerId: opponentPlayerId, seat: opponent, reason: "no_legal_moves" },
      });
    }

    state.turnState.currentPlayerId = playerId;
    state.legalMoves = currentMoves;
    recordTurnChanged();

    return effects;
  }

  state.status = "ended";
  state.turnState.phase = "ended";
  state.turnState.currentPlayerId = null;
  state.legalMoves = [];
  setWinnerFromScores(state);
  effects.push(
    { type: "stop_timers" },
    {
      type: "event",
      event: "game_ended",
      data: { reason: "no_legal_moves", winner: state.winner, scores: state.scores },
    },
    { type: "match_ended", reason: "no_legal_moves" },
  );

  return effects;
}

/** Server-authoritative Reversi. Intent: `place_disc { row, col }`. */
export const reversiPlugin: GamePlugin<ReversiGameState, "reversi"> = {
  id: "reversi",
  minPlayersToStart: 2,
  initialTurnPhase: "play",

  createInitialState(config, roomCode, now) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;
    const board = createInitialReversiBoard();

    return {
      id: randomId(),
      roomCode,
      type: "reversi",
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
      board,
      seats: {},
      winner: null,
      scores: countReversiDiscs(board),
      legalMoves: [],
      lastMove: null,
      lastPass: null,
    };
  },

  start(state, context) {
    const black = state.players[context.firstPlayerIndex];
    const white = state.players[(context.firstPlayerIndex + 1) % state.players.length];

    if (!black || !white) return;

    const board = createInitialReversiBoard();

    state.seats = { [black.id]: 1, [white.id]: 2 };
    state.board = board;
    state.winner = null;
    state.scores = countReversiDiscs(board);
    state.legalMoves = getReversiLegalMoves(board, 1);
    state.lastMove = null;
    state.lastPass = null;
    state.turnState.currentPlayerId = black.id;
    state.turnState.phase = "play";
    state.turnState.turnNumber = 1;
  },

  turnActions(state, playerId, viewer) {
    if (viewer.isSpectator) return [];

    if (state.status !== "playing") return [];

    if (state.turnState.currentPlayerId !== playerId) return [];

    return state.legalMoves.length > 0 ? ["place_disc"] : [];
  },

  seatIdentity(state, playerId, viewer) {
    if (viewer.isSpectator) return { seat: null, role: "spectator", color: null };

    const seat = state.seats[playerId] ?? null;

    return {
      seat,
      role: seat === 1 ? "black" : seat === 2 ? "white" : null,
      color: seat === 1 ? "black" : seat === 2 ? "white" : null,
    };
  },

  applyAction(state, playerId, intent, now) {
    if (!["place_disc", "place", "move"].includes(intent.actionType))
      return { ok: false, message: `Unknown action: ${intent.actionType}` };

    if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

    if (state.turnState.currentPlayerId !== playerId) return { ok: false, message: "Not your turn" };

    const data = isWireObject(intent.data) ? intent.data : null;
    const row = data?.row;
    const col = data?.col;

    if (
      !isNumber(row) ||
      !isNumber(col) ||
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      !isOnReversiBoard(row, col)
    )
      return { ok: false, message: `Row and col must be integers 0–${REVERSI_SIZE - 1}` };

    const seat = state.seats[playerId];

    if (!seat) return { ok: false, message: "No seat assigned" };

    const flips = applyReversiMove(state.board, row, col, seat);

    if (flips.length === 0)
      return { ok: false, message: "Illegal move: placement must bracket opponent discs" };

    state.lastMove = { playerId, row, col, seat, flipped: flips };
    state.lastPass = null;
    state.scores = countReversiDiscs(state.board);

    return {
      ok: true,
      effects: [
        {
          type: "event",
          event: "place_disc",
          data: { playerId, seat, row, col, flipped: flips.length },
        },
        ...advanceTurn(state, playerId, seat, now, true),
      ],
    };
  },

  onTurnTimeout(state, playerId, now) {
    if (state.status !== "playing" || !playerId) return [];

    const seat = state.seats[playerId];

    if (!seat) return [];

    return advanceTurn(state, playerId, seat, now, false);
  },

  onMatchTimeout(state) {
    setWinnerFromScores(state);
    state.legalMoves = [];
  },

  agentFields(projection) {
    return {
      board: projection.board,
      seats: projection.seats,
      scores: projection.scores,
      legalMoves: projection.legalMoves,
      lastMove: projection.lastMove,
      lastPass: projection.lastPass,
    };
  },

  agentDecision: reversiAgentDecision,
};

export type { ReversiCell, ReversiMove };
