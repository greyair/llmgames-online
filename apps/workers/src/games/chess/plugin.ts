import { ROOM_LIFETIME_MS, isString, isWireObject, type WireValue } from "@llmgames/game-catalog";

import { randomId } from "../../lib/csprng";
import type { ChessColor, ChessGameState } from "../../durable-objects/types";
import type { GameActionResult, GameEffect, GamePlugin } from "../contract";

import { chessAgentDecision } from "./agent";
import {
  START_FEN,
  colorOfPiece,
  fenOf,
  findMove,
  fromFen,
  inCheck,
  kingSquare,
  legalMoves,
  parseUci,
  pieceLetter,
  play,
  repetitionKey,
  resultOf,
  sanOf,
  squareIndex,
  squareName,
  toPos,
  uciOf,
  type ChessMove,
  type ChessPos,
} from "./rules";

const DEFAULT_MATCH_MS = ROOM_LIFETIME_MS;

const DEFAULT_TURN_MS = 90 * 1000;

/** Promotion letters a client may ask for. */
const PROMOTIONS = new Set(["q", "r", "b", "n"]);

const colorOfSeat = (seat: number): ChessColor => (seat === 1 ? "w" : "b");

const otherSeat = (seat: number): 1 | 2 => (seat === 1 ? 2 : 1);

/**
 * Standard chess for two seats, ported from West Window's `chess.ts` (MIT,
 * SerenQi). Seat 1 plays White and moves first; seat 2 plays Black.
 *
 * Intents: `move { from, to, promotion? }`, or the same move as one UCI string
 * in `uci` ("e2e4", "e7e8q"). Castling is the king's own two-square move.
 *
 * Chess hides nothing, so the only field kept off the projection is `history`:
 * the repetition keys are bookkeeping, and a client that received them could
 * only use them to reconstruct moves the board already shows.
 */
export const chessPlugin: GamePlugin<ChessGameState, "chess"> = {
  id: "chess",
  minPlayersToStart: 2,
  initialTurnPhase: "play",

  createInitialState(config, roomCode, now) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;
    const start = fromFen(START_FEN);

    return {
      id: randomId(),
      roomCode,
      type: "chess",
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
      seats: {},
      board: start.board,
      turn: start.turn,
      castling: start.castling,
      ep: start.ep,
      halfmove: start.halfmove,
      fullmove: start.fullmove,
      plies: 0,
      last: null,
      captured: { w: "", b: "" },
      history: [],
      legal: [],
      check: false,
      checkSquare: null,
      result: null,
      winner: null,
    };
  },

  start(state, context) {
    const players = state.players;
    const first = players[context.firstPlayerIndex];
    const second = players[(context.firstPlayerIndex + 1) % players.length];

    if (!first || !second) return;

    // The platform draws who starts, so the drawn player takes White rather than
    // the seat that joined first: colour follows the draw, as in gomoku.
    state.seats = { [first.id]: 1, [second.id]: 2 };
    state.board = fromFen(START_FEN).board;
    state.turn = "w";
    state.castling = "KQkq";
    state.ep = null;
    state.halfmove = 0;
    state.fullmove = 1;
    state.plies = 0;
    state.last = null;
    state.captured = { w: "", b: "" };
    state.history = [];
    state.check = false;
    state.checkSquare = null;
    state.result = null;
    state.winner = null;

    const opening = legalMoves(toPos(state));

    state.history = [repetitionKey(toPos(state), opening)];
    state.legal = opening.map(uciOf);

    state.turnState.currentPlayerId = first.id;
    state.turnState.phase = "play";
    state.turnState.turnNumber = 1;
  },

  turnActions(state, playerId, viewer) {
    if (viewer.isSpectator) return [];

    if (state.status !== "playing") return [];

    if (state.turnState.phase !== "play") return [];

    if (state.turnState.currentPlayerId !== playerId) return [];

    return ["move"];
  },

  seatIdentity(state, playerId, viewer) {
    if (viewer.isSpectator) return { seat: null, role: "spectator" };

    const seat = state.seats[playerId] ?? null;

    return {
      seat,
      role: seat === 1 ? "white" : seat === 2 ? "black" : null,
      color: seat === 1 ? "white" : seat === 2 ? "black" : null,
    };
  },

  applyAction(state, playerId, intent, now) {
    if (intent.actionType !== "move" && intent.actionType !== "play_move")
      return { ok: false, message: `Unknown action: ${intent.actionType}` };

    if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

    if (state.turnState.currentPlayerId !== playerId) return { ok: false, message: "Not your turn" };

    const seat = state.seats[playerId];

    if (!seat) return { ok: false, message: "No seat assigned" };

    if (colorOfSeat(seat) !== state.turn) return { ok: false, message: "Not your turn" };

    const pos = toPos(state);
    const legal = legalMoves(pos);
    const parsed = parseIntent(pos, legal, intent.data);

    if (!parsed.ok) return { ok: false, message: parsed.message };

    return commit(state, playerId, parsed.move, legal, now);
  },

  /** A chess clock, not a nudge: running out of time forfeits the game. */
  onTurnTimeout(state, playerId) {
    if (state.status !== "playing" || !playerId) return [];

    const seat = state.seats[playerId];

    if (!seat) return [];

    const winner = playerAtSeat(state, otherSeat(seat));

    if (!winner) return [];

    state.result = { winner: colorOfSeat(otherSeat(seat)), reason: "timeout" };
    state.winner = winner;
    state.status = "ended";
    state.turnState.phase = "ended";
    state.turnState.currentPlayerId = null;
    state.legal = [];

    return [
      { type: "stop_timers" },
      {
        type: "event",
        event: "game_ended",
        data: { reason: "turn_timeout", winner, loser: playerId },
      },
      { type: "match_ended", reason: "turn_timeout" },
    ];
  },

  /** The match clock runs out with the board still live: nobody won it. */
  onMatchTimeout(state) {
    state.result = { winner: "draw", reason: "match_timeout" };
    state.winner = "draw";
    state.status = "ended";
    state.turnState.phase = "ended";
    state.turnState.currentPlayerId = null;
    state.legal = [];
  },

  /** Repetition keys are internal bookkeeping; every other field is public. */
  projectState(state) {
    const { history: _repetitionKeys, ...projected } = state;

    return projected;
  },

  rewatchView(state) {
    const { history: _repetitionKeys, ...projected } = state;

    return projected;
  },

  agentFields(projection) {
    return {
      board: projection.board,
      seats: projection.seats,
      turn: projection.turn,
      castling: projection.castling,
      ep: projection.ep,
      halfmove: projection.halfmove,
      fullmove: projection.fullmove,
      last: projection.last,
      captured: projection.captured,
      legal: projection.legal,
      check: projection.check,
      checkSquare: projection.checkSquare,
      result: projection.result,
    };
  },

  agentDecision: chessAgentDecision,
};

function playerAtSeat(state: ChessGameState, seat: number): string | undefined {
  return Object.keys(state.seats).find((playerId) => state.seats[playerId] === seat);
}

/** Either `{ from, to, promotion? }` or one UCI string in `uci`. */
function parseIntent(
  pos: ChessPos,
  legal: readonly ChessMove[],
  data: WireValue,
): { ok: true; move: ChessMove } | { ok: false; message: string } {
  if (!isWireObject(data)) return { ok: false, message: "A move needs a from and a to square" };

  const uciText = data.uci;

  if (isString(uciText) && uciText.trim()) return parseUci(pos, legal, uciText);

  const from = data.from;
  const to = data.to;

  if (!isString(from) || !isString(to))
    return { ok: false, message: "A move needs a from and a to square, e.g. e2 and e4" };

  const fromIndex = squareIndex(from);
  const toIndex = squareIndex(to);

  if (fromIndex === null || toIndex === null)
    return { ok: false, message: "Squares are a file a-h and a rank 1-8, e.g. e2" };

  if (pos.b[fromIndex] === ".") return { ok: false, message: `There is no piece on ${from.trim().toLowerCase()}` };

  if (colorOfPiece(pos.b[fromIndex]!) !== pos.turn)
    return { ok: false, message: "That piece is not yours" };

  const promotion = data.promotion;

  if (promotion !== undefined && (!isString(promotion) || !PROMOTIONS.has(promotion.toLowerCase())))
    return { ok: false, message: "Promotion must be one of q, r, b or n" };

  return findMove(pos, legal, fromIndex, toIndex, isString(promotion) ? promotion.toLowerCase() : null);
}

/** Play a validated move: update the position, then end the match or pass the turn. */
function commit(
  state: ChessGameState,
  playerId: string,
  move: ChessMove,
  legal: readonly ChessMove[],
  now: number,
): GameActionResult {
  const pos = toPos(state);
  const san = sanOf(pos, move, legal);

  const taken =
    move.flag & 2
      ? pieceLetter(state.turn === "w" ? "b" : "w", "p")
      : pos.b[move.to] !== "."
        ? pos.b[move.to]!
        : "";

  // A capture or a pawn move resets both the fifty-move clock and the repetition
  // history: positions before it can never recur in a way that counts.
  const reset = taken !== "" || pos.b[move.from]!.toLowerCase() === "p";
  const next = play(pos, move);
  const nextLegal = legalMoves(next);
  const key = repetitionKey(next, nextLegal);

  state.board = next.b.join("");
  state.turn = next.turn;
  state.castling = next.castling;
  state.ep = next.ep;
  state.halfmove = reset ? 0 : state.halfmove + 1;
  state.fullmove = state.turn === "w" ? state.fullmove + 1 : state.fullmove;
  state.plies += 1;
  state.last = { from: move.from, to: move.to, uci: uciOf(move), san };
  state.history = reset ? [key] : [...state.history, key];

  if (taken) {
    const side = state.turn === "w" ? "b" : "w";

    state.captured = { ...state.captured, [side]: state.captured[side] + taken };
  }

  const effects: GameEffect[] = [
    {
      type: "event",
      event: "chess_move",
      data: {
        playerId,
        seat: state.seats[playerId],
        from: squareName(move.from),
        to: squareName(move.to),
        uci: uciOf(move),
        san,
        captured: taken || undefined,
        fen: fenOf(state),
      },
    },
  ];

  const result = resultOf(next, nextLegal, state.halfmove, state.history);

  state.check = inCheck(next);
  state.checkSquare = state.check ? kingSquare(next.b, next.turn) : null;

  if (result) {
    state.result = result;
    state.winner = result.winner === "draw" ? "draw" : (playerAtSeat(state, result.winner === "w" ? 1 : 2) ?? "draw");
    state.status = "ended";
    state.turnState.phase = "ended";
    state.turnState.currentPlayerId = null;
    state.legal = [];

    effects.push(
      { type: "stop_timers" },
      {
        type: "event",
        event: "game_ended",
        data: { reason: result.reason, winner: state.winner },
      },
      { type: "match_ended", reason: result.reason },
    );

    return { ok: true, effects };
  }

  state.legal = nextLegal.map(uciOf);
  state.result = null;

  const nextPlayer = playerAtSeat(state, state.turn === "w" ? 1 : 2);

  state.turnState.currentPlayerId = nextPlayer ?? null;
  state.turnState.turnNumber += 1;
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
}
