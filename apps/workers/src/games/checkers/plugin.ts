import { ROOM_LIFETIME_MS, isNumber, isWireObject } from "@llmgames/game-catalog";

import { randomId } from "../../lib/csprng";
import type { CheckersGameState } from "../../durable-objects/types";
import type { GameEffect, GamePlugin } from "../contract";

import {
  CHECKERS_QUIET_TURN_LIMIT,
  CHECKERS_REPETITION_LIMIT,
  CHECKERS_SIZE,
  checkersPositionKey,
  checkersPromotionRow,
  countCheckersPieces,
  createInitialCheckersBoard,
  getCheckersLegalMoves,
} from "./rules";
import { checkersAgentDecision } from "./agent";

const DEFAULT_MATCH_MS = 20 * 60 * 1000;

const DEFAULT_TURN_MS = 60 * 1000;

function opponentSeat(seat: 1 | 2): 1 | 2 {
  return seat === 1 ? 2 : 1;
}

function playerInSeat(state: CheckersGameState, seat: 1 | 2): string | undefined {
  return state.players.find((player) => state.seats[player.id] === seat)?.id;
}

/** Close the match: no legal move ends it, and so does a forfeit or a draw rule. */
function finish(state: CheckersGameState, winner: string, reason: string): GameEffect[] {
  state.winner = winner;
  state.status = "ended";
  state.turnState.phase = "ended";
  state.turnState.currentPlayerId = null;
  state.legalMoves = [];
  state.forcedPiece = null;

  return [
    { type: "stop_timers" },
    {
      type: "event",
      event: "game_ended",
      data: { reason, winner, scores: state.scores },
    },
    { type: "match_ended", reason },
  ];
}

/** Public projection: repetition bookkeeping never leaves the server. */
function publicState(state: CheckersGameState) {
  const { positionCounts: _positions, ...projected } = state;

  return projected;
}

/** American checkers (English draughts) on an 8×8 board. Intent: `move_checker`. */
export const checkersPlugin: GamePlugin<CheckersGameState, "checkers"> = {
  id: "checkers",
  minPlayersToStart: 2,
  initialTurnPhase: "play",

  createInitialState(config, roomCode, now) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;
    const board = createInitialCheckersBoard();

    return {
      id: randomId(),
      roomCode,
      type: "checkers",
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
      scores: countCheckersPieces(board),
      winner: null,
      legalMoves: [],
      forcedPiece: null,
      lastMove: null,
      quietTurns: 0,
      positionCounts: {},
    };
  },

  start(state, context) {
    const black = state.players[context.firstPlayerIndex];
    const white = state.players[(context.firstPlayerIndex + 1) % state.players.length];

    if (!black || !white) return;

    const board = createInitialCheckersBoard();

    state.seats = { [black.id]: 1, [white.id]: 2 };
    state.board = board;
    state.scores = countCheckersPieces(board);
    state.winner = null;
    state.forcedPiece = null;
    state.lastMove = null;
    state.quietTurns = 0;
    state.turnState.currentPlayerId = black.id;
    state.turnState.phase = "play";
    state.turnState.turnNumber = 1;
    state.legalMoves = getCheckersLegalMoves(board, 1);
    state.positionCounts = { [checkersPositionKey(board, 1)]: 1 };
  },

  turnActions(state, playerId, viewer) {
    if (viewer.isSpectator) return [];

    if (state.status !== "playing") return [];

    if (state.turnState.currentPlayerId !== playerId) return [];

    return state.legalMoves.length > 0 ? ["move_checker"] : [];
  },

  seatIdentity(state, playerId, viewer) {
    if (viewer.isSpectator) return { seat: null, color: null };

    const seat = state.seats[playerId] ?? null;

    return { seat, color: seat === 1 ? "black" : seat === 2 ? "white" : null };
  },

  applyAction(state, playerId, intent, now) {
    if (intent.actionType !== "move_checker")
      return { ok: false, message: `Unknown action: ${intent.actionType}` };

    if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

    if (state.turnState.currentPlayerId !== playerId) return { ok: false, message: "Not your turn" };

    const data = isWireObject(intent.data) ? intent.data : null;

    const coordinates = data
      ? [data.fromRow, data.fromCol, data.row, data.col]
      : [undefined, undefined, undefined, undefined];

    if (
      !coordinates.every(
        (value) =>
          isNumber(value) && Number.isInteger(value) && value >= 0 && value < CHECKERS_SIZE,
      )
    )
      return { ok: false, message: "Coordinates must be integers 0–7" };

    const seat = state.seats[playerId];

    if (!seat) return { ok: false, message: "No seat assigned" };

    // Recompute against authoritative state; never trust a client-provided capture.
    const move = getCheckersLegalMoves(state.board, seat, state.forcedPiece).find(
      (candidate) =>
        candidate.fromRow === data?.fromRow &&
        candidate.fromCol === data?.fromCol &&
        candidate.row === data?.row &&
        candidate.col === data?.col,
    );

    if (!move)
      return {
        ok: false,
        message: "Illegal move. Captures are mandatory; finish a jump chain with the same piece.",
      };

    const piece = state.board[move.fromRow]![move.fromCol]!;
    const crowned = piece <= 2 && move.row === checkersPromotionRow(seat);

    state.board[move.fromRow]![move.fromCol] = 0;
    state.board[move.row]![move.col] = crowned ? (seat === 1 ? 3 : 4) : piece;

    if (move.capture) state.board[move.capture.row]![move.capture.col] = 0;
    state.scores = countCheckersPieces(state.board);
    state.lastMove = { ...move, playerId, crowned };
    state.quietTurns = move.capture || piece <= 2 ? 0 : state.quietTurns + 1;

    const effects: GameEffect[] = [
      { type: "event", event: "move_checker", data: moveSummary(state.lastMove) },
    ];

    // A capture chain stays with the same piece and does not advance the turn.
    if (move.capture && !crowned) {
      const forced = { row: move.row, col: move.col };
      const next = getCheckersLegalMoves(state.board, seat, forced);

      if (next.length) {
        state.forcedPiece = forced;
        state.legalMoves = next;

        return { ok: true, effects };
      }
    }

    state.forcedPiece = null;

    const nextSeat = opponentSeat(seat);
    const nextPlayerId = playerInSeat(state, nextSeat);

    state.legalMoves = getCheckersLegalMoves(state.board, nextSeat);

    if (!state.legalMoves.length || !nextPlayerId)
      return { ok: true, effects: [...effects, ...finish(state, playerId, "no_legal_moves")] };

    const key = checkersPositionKey(state.board, nextSeat);

    state.positionCounts[key] = (state.positionCounts[key] ?? 0) + 1;

    if (
      state.positionCounts[key] >= CHECKERS_REPETITION_LIMIT ||
      state.quietTurns >= CHECKERS_QUIET_TURN_LIMIT
    ) {
      const reason = state.quietTurns >= CHECKERS_QUIET_TURN_LIMIT ? "no_progress" : "repetition";

      return { ok: true, effects: [...effects, ...finish(state, "draw", reason)] };
    }

    state.turnState.currentPlayerId = nextPlayerId;
    state.turnState.turnNumber++;
    state.turnState.startedAt = now;
    state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
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

    const seat = state.seats[playerId];

    if (!seat) return [];

    const winner = playerInSeat(state, opponentSeat(seat));

    if (!winner) return [];

    return finish(state, winner, "turn_timeout");
  },

  onMatchTimeout(state) {
    state.winner = "draw";
    state.turnState.phase = "ended";
    state.turnState.currentPlayerId = null;
    state.legalMoves = [];
    state.forcedPiece = null;
  },

  projectState(state) {
    return publicState(state);
  },

  rewatchView(state) {
    return publicState(state);
  },

  agentFields(projection) {
    return {
      board: projection.board,
      seats: projection.seats,
      scores: projection.scores,
      legalMoves: projection.legalMoves,
      lastMove: projection.lastMove,
      forcedPiece: projection.forcedPiece,
      quietTurns: projection.quietTurns,
    };
  },

  agentDecision: checkersAgentDecision,
};

/** Event payload for one move, matching the fields the archive already recorded. */
function moveSummary(move: CheckersGameState["lastMove"]) {
  if (!move) return {};

  return {
    fromRow: move.fromRow,
    fromCol: move.fromCol,
    row: move.row,
    col: move.col,
    capture: move.capture,
    playerId: move.playerId,
    crowned: move.crowned,
  };
}
