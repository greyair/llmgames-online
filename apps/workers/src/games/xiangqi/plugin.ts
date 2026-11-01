import { ROOM_LIFETIME_MS, isString, isWireObject, type WireValue } from "@llmgames/game-catalog";

import { randomId } from "../../lib/csprng";
import type { XiangqiGameState, XiangqiSide } from "../../durable-objects/types";
import type { GameActionResult, GameEffect, GamePlugin } from "../contract";

import { xiangqiAgentDecision } from "./agent";
import {
  XIANGQI_START_FEN,
  fromFen,
  generalAt,
  iccsOf,
  inCheck,
  legalMoves,
  legalPairs,
  notationOf,
  parseIccs,
  play,
  pseudoTargets,
  resultOf,
  squareIndex,
  squareName,
} from "./rules";

const DEFAULT_MATCH_MS = ROOM_LIFETIME_MS;

const DEFAULT_TURN_MS = 90 * 1000;

const sideOfSeat = (seat: number): XiangqiSide => (seat === 1 ? "r" : "b");

const otherSeat = (seat: number): 1 | 2 => (seat === 1 ? 2 : 1);

/**
 * 中国象棋 for two seats, ported from West Window's `xiangqi.ts` (MIT, SerenQi).
 * Seat 1 plays Red and moves first; seat 2 plays Black.
 *
 * Intents: `move { from, to }` with ICCS points ("h2" → "e2"), or the whole move
 * as one string in `uci` / `iccs`.
 *
 * Nothing is hidden — the board is the whole state — so the projection only
 * drops the move log of the game's own bookkeeping. A side with no legal move
 * loses whether or not it is in check, and 120 plies without a capture draw.
 */
export const xiangqiPlugin: GamePlugin<XiangqiGameState, "xiangqi"> = {
  id: "xiangqi",
  minPlayersToStart: 2,
  initialTurnPhase: "play",

  createInitialState(config, roomCode, now) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;
    const start = fromFen(XIANGQI_START_FEN);

    return {
      id: randomId(),
      roomCode,
      type: "xiangqi",
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
      plies: 0,
      quiet: 0,
      last: null,
      captured: [],
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

    // The drawn starter takes Red, the side that moves first.
    state.seats = { [first.id]: 1, [second.id]: 2 };
    state.board = fromFen(XIANGQI_START_FEN).board;
    state.turn = "r";
    state.plies = 0;
    state.quiet = 0;
    state.last = null;
    state.captured = [];
    state.check = false;
    state.checkSquare = null;
    state.result = null;
    state.winner = null;
    state.legal = legalMoves(state.board, state.turn);

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
      role: seat === 1 ? "red" : seat === 2 ? "black" : null,
      color: seat === 1 ? "red" : seat === 2 ? "black" : null,
    };
  },

  applyAction(state, playerId, intent, now) {
    if (intent.actionType !== "move" && intent.actionType !== "play_move")
      return { ok: false, message: `Unknown action: ${intent.actionType}` };

    if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

    if (state.turnState.currentPlayerId !== playerId) return { ok: false, message: "Not your turn" };

    const seat = state.seats[playerId];

    if (!seat) return { ok: false, message: "No seat assigned" };

    if (sideOfSeat(seat) !== state.turn) return { ok: false, message: "Not your turn" };

    const parsed = parseIntent(state, intent.data);

    if (!parsed.ok) return { ok: false, message: parsed.message };

    return commit(state, playerId, parsed.from, parsed.to, now);
  },

  /** Xiangqi has no pass: a seat whose clock runs out forfeits. */
  onTurnTimeout(state, playerId) {
    if (state.status !== "playing" || !playerId) return [];

    const seat = state.seats[playerId];

    if (!seat) return [];

    const winner = playerAtSeat(state, otherSeat(seat));

    if (!winner) return [];

    state.result = { winner: sideOfSeat(otherSeat(seat)), reason: "timeout" };
    state.winner = winner;
    state.status = "ended";
    state.turnState.phase = "ended";
    state.turnState.currentPlayerId = null;
    state.legal = [];

    return [
      { type: "stop_timers" },
      { type: "event", event: "game_ended", data: { reason: "turn_timeout", winner, loser: playerId } },
      { type: "match_ended", reason: "turn_timeout" },
    ];
  },

  onMatchTimeout(state) {
    state.result = { winner: "draw", reason: "match_timeout" };
    state.winner = "draw";
    state.status = "ended";
    state.turnState.phase = "ended";
    state.turnState.currentPlayerId = null;
    state.legal = [];
  },

  /** The board is the whole state; there is nothing to hide. */
  agentFields(projection) {
    return {
      board: projection.board,
      seats: projection.seats,
      turn: projection.turn,
      plies: projection.plies,
      quiet: projection.quiet,
      last: projection.last,
      captured: projection.captured,
      legal: projection.legal,
      check: projection.check,
      checkSquare: projection.checkSquare,
      result: projection.result,
    };
  },

  agentDecision: xiangqiAgentDecision,
};

function playerAtSeat(state: XiangqiGameState, seat: number): string | undefined {
  return Object.keys(state.seats).find((playerId) => state.seats[playerId] === seat);
}

/** Either `{ from, to }` ICCS points or one ICCS string in `iccs`. */
function parseIntent(
  state: XiangqiGameState,
  data: WireValue,
): { ok: true; from: number; to: number } | { ok: false; message: string } {
  if (!isWireObject(data)) return { ok: false, message: "A move needs a from and a to point" };

  // One string instead of from/to: ICCS "h2e2" arrives in the same `uci` field
  // chess uses, because both are "origin then destination".
  const whole = data.uci ?? data.iccs;

  if (isString(whole) && whole.trim()) {
    const parsed = parseIccs(whole);

    if (!parsed) return { ok: false, message: `Not a move: ${whole.trim()}` };

    return resolve(state, parsed.from, parsed.to);
  }

  const from = data.from;
  const to = data.to;

  if (!isString(from) || !isString(to))
    return { ok: false, message: "A move needs a from and a to point, e.g. h2 and e2" };

  const start = squareIndex(from);
  const end = squareIndex(to);

  if (start === null || end === null)
    return { ok: false, message: "Points are a file a-i and a rank 0-9, e.g. h2" };

  return resolve(state, start, end);
}

function resolve(
  state: XiangqiGameState,
  from: number,
  to: number,
): { ok: true; from: number; to: number } | { ok: false; message: string } {
  const piece = state.board[from] ?? "";

  if (piece === "")
    return { ok: false, message: `There is no piece on ${squareName(from)}` };

  if ((piece === piece.toUpperCase()) !== (state.turn === "r"))
    return { ok: false, message: "That piece is not yours" };

  const legal = legalPairs(state.board, state.turn).some(([a, b]) => a === from && b === to);

  if (!legal) return { ok: false, message: whyIllegal(state, from, to) };

  return { ok: true, from, to };
}

/**
 * The English rejection. A move that its own geometry allows but the rules
 * refuse is always an exposed general — either facing the other one or left in
 * check — so the message names that instead of repeating "illegal".
 */
function whyIllegal(state: XiangqiGameState, from: number, to: number): string {
  if (!pseudoTargets(state.board, from).includes(to)) return "That piece cannot move there";

  return state.check ? "That does not get your general out of check" : "That would expose your general";
}

/** Play a validated move: update the board, then end the match or pass the turn. */
function commit(
  state: XiangqiGameState,
  playerId: string,
  from: number,
  to: number,
  now: number,
): GameActionResult {
  const text = notationOf(state.board, from, to);
  const taken = state.board[to] ?? "";
  const next = play(state.board, from, to);

  state.board = next;
  state.turn = state.turn === "r" ? "b" : "r";
  state.plies += 1;
  state.quiet = taken === "" ? state.quiet + 1 : 0;
  state.last = { from, to, iccs: iccsOf(from, to), text };

  if (taken !== "") state.captured = [...state.captured, taken];

  const effects: GameEffect[] = [
    {
      type: "event",
      event: "xiangqi_move",
      data: {
        playerId,
        seat: state.seats[playerId],
        from: squareName(from),
        to: squareName(to),
        iccs: iccsOf(from, to),
        notation: text,
        captured: taken || undefined,
      },
    },
  ];

  const result = resultOf(next, state.turn, state.quiet);

  state.check = inCheck(next, state.turn);
  state.checkSquare = state.check ? generalAt(next, state.turn) : null;

  if (result) {
    state.result = result;
    state.winner =
      result.winner === "draw"
        ? "draw"
        : (playerAtSeat(state, result.winner === "r" ? 1 : 2) ?? "draw");
    state.status = "ended";
    state.turnState.phase = "ended";
    state.turnState.currentPlayerId = null;
    state.legal = [];

    effects.push(
      { type: "stop_timers" },
      { type: "event", event: "game_ended", data: { reason: result.reason, winner: state.winner } },
      { type: "match_ended", reason: result.reason },
    );

    return { ok: true, effects };
  }

  state.result = null;
  state.legal = legalMoves(next, state.turn);

  const nextPlayer = playerAtSeat(state, state.turn === "r" ? 1 : 2);

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
