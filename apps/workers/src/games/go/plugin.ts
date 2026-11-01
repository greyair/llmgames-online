import { ROOM_LIFETIME_MS, isNumber, isString, isWireObject, type WireValue } from "@llmgames/game-catalog";

import { randomId } from "../../lib/csprng";
import type { GoGameState } from "../../durable-objects/types";
import type { GameActionResult, GameEffect, GamePlugin } from "../contract";

import { goAgentDecision } from "./agent";
import {
  GO_BLACK,
  GO_DEFAULT_SIZE,
  GO_EMPTY,
  GO_KOMI,
  GO_WHITE,
  areaScore,
  fromGtp,
  groupAt,
  isColor,
  legalPoints,
  otherColor,
  playStone,
  positionKey,
  toGtp,
  type GoColor,
} from "./rules";

const DEFAULT_MATCH_MS = ROOM_LIFETIME_MS;

const DEFAULT_TURN_MS = 60 * 1000;

const seatOfColor = (color: GoColor): 1 | 2 => (color === GO_BLACK ? 1 : 2);

const colorOfSeat = (seat: number): GoColor => (seat === 1 ? GO_BLACK : GO_WHITE);

/** Names a client may send for each intent, canonical first. */
const ALIASES = new Map<string, string>([
  ["place_go_stone", "place_go_stone"],
  ["play", "place_go_stone"],
  ["place", "place_go_stone"],
  ["pass_turn", "pass_turn"],
  ["pass", "pass_turn"],
  ["resign_go", "resign"],
  ["resign", "resign"],
  ["mark_dead", "mark_dead"],
  ["dead", "mark_dead"],
  ["toggle_dead", "mark_dead"],
  ["accept_score", "accept_score"],
  ["accept", "accept_score"],
  ["resume_play", "resume_play"],
  ["resume", "resume_play"],
]);

/**
 * 围棋 on a 9×9 board, ported from West Window's `go.ts` (MIT, SerenQi).
 *
 * Chinese area scoring, komi 7.5, positional superko, suicide forbidden. Seat 1
 * plays Black and moves first. The board is stored as 81 cells plus the move
 * number that placed each stone; the superko keys are the one piece of
 * bookkeeping the projection hides.
 *
 * Intents: `place_go_stone { point }` (GTP, e.g. "D4") or `{ row, col }`,
 * `pass_turn`, `resign`, then during scoring `mark_dead { point }`,
 * `accept_score` and `resume_play`.
 *
 * A two-pass game does not end: it enters scoring, where both seats mark dead
 * stones and each must accept the same marking. That is the only phase in which
 * two seats decide at once, so `mayActNow` widens there.
 */
export const goPlugin: GamePlugin<GoGameState, "go"> = {
  id: "go",
  minPlayersToStart: 2,
  initialTurnPhase: "play",

  createInitialState(config, roomCode, now) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;
    const cells = new Array<number>(GO_DEFAULT_SIZE * GO_DEFAULT_SIZE).fill(GO_EMPTY);

    return {
      id: randomId(),
      roomCode,
      type: "go",
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
      boardSize: GO_DEFAULT_SIZE,
      komi: GO_KOMI,
      cells,
      playedAt: new Array<number>(GO_DEFAULT_SIZE * GO_DEFAULT_SIZE).fill(0),
      turn: GO_BLACK,
      captures: [0, 0, 0],
      passes: 0,
      stage: "playing",
      dead: [],
      accepted: [],
      score: null,
      history: [positionKey(cells)],
      moves: 0,
      last: null,
      lastCaptured: [],
      winner: null,
    };
  },

  start(state, context) {
    const players = state.players;
    const first = players[context.firstPlayerIndex];
    const second = players[(context.firstPlayerIndex + 1) % players.length];

    if (!first || !second) return;

    const cells = new Array<number>(state.boardSize * state.boardSize).fill(GO_EMPTY);

    // The drawn starter takes Black, which moves first.
    state.seats = { [first.id]: 1, [second.id]: 2 };
    state.cells = cells;
    state.playedAt = new Array<number>(state.boardSize * state.boardSize).fill(0);
    state.turn = GO_BLACK;
    state.captures = [0, 0, 0];
    state.passes = 0;
    state.stage = "playing";
    state.dead = [];
    state.accepted = [];
    state.score = null;
    state.history = [positionKey(cells)];
    state.moves = 0;
    state.last = null;
    state.lastCaptured = [];
    state.winner = null;

    state.turnState.currentPlayerId = first.id;
    state.turnState.phase = "play";
    state.turnState.turnNumber = 1;
  },

  turnActions(state, playerId, viewer) {
    if (viewer.isSpectator) return [];

    if (state.status !== "playing") return [];

    if (!state.seats[playerId]) return [];

    if (state.stage === "scoring") return ["mark_dead", "accept_score", "resume_play", "resign"];

    if (state.stage !== "playing") return [];

    if (state.turnState.currentPlayerId !== playerId) return [];

    return ["place_go_stone", "pass_turn", "resign"];
  },

  /** Scoring is a two-seat decision: both mark dead stones and both accept. */
  mayActNow(state, playerId) {
    if (state.status !== "playing") return false;

    if (!state.seats[playerId]) return false;

    if (state.stage === "scoring") return true;

    return state.turnState.currentPlayerId === playerId;
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
    const action = ALIASES.get(intent.actionType);

    if (!action) return { ok: false, message: `Unknown action: ${intent.actionType}` };

    if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

    const seat = state.seats[playerId];

    if (!seat) return { ok: false, message: "No seat assigned" };

    const color = colorOfSeat(seat);

    switch (action) {
      case "place_go_stone":
        return playAt(state, playerId, color, intent.data, now);

      case "pass_turn":
        return pass(state, playerId, color, now);

      case "resign":
        return resign(state, playerId, color);

      case "mark_dead":
        return markDead(state, playerId, intent.data);

      case "accept_score":
        return acceptScore(state, playerId, color);

      case "resume_play":
        return resume(state, playerId);
    }

    return { ok: false, message: `Unknown action: ${intent.actionType}` };
  },

  /**
   * The clock runs out: rather than freeze the game, the platform plays the
   * move the rules always allow — a pass while playing, an acceptance while
   * scoring.
   */
  onTurnTimeout(state, playerId, now) {
    if (state.status !== "playing" || !playerId) return [];

    const seat = state.seats[playerId];

    if (!seat) return [];

    const color = colorOfSeat(seat);
    const timeout: GameEffect = { type: "event", event: "turn_timeout", data: { playerId } };

    if (state.stage === "scoring") {
      const accepted = acceptScore(state, playerId, color);

      return accepted.ok ? [timeout, ...accepted.effects] : [timeout];
    }

    if (state.turnState.currentPlayerId !== playerId) return [timeout];

    const passed = pass(state, playerId, color, now);

    return passed.ok ? [timeout, ...passed.effects] : [timeout];
  },

  /** The match clock runs out: count the board as it stands, with no dead stones. */
  onMatchTimeout(state) {
    if (state.stage === "ended") return;

    const score = areaScore(state.cells, state.boardSize, [], state.komi);

    state.score = score;
    state.winner = winnerOf(state, score.winner);
    state.stage = "ended";
    state.status = "ended";
    state.turnState.phase = "ended";
    state.turnState.currentPlayerId = null;
  },

  /**
   * Nothing on a Go board is private; the superko keys are bookkeeping.
   *
   * `legal` is computed here rather than in the browser because legality needs
   * the superko history: a point that looks fine on the visible board can still
   * rebuild an earlier position.
   */
  projectState(state) {
    const { history: _superko, ...projected } = state;

    return {
      ...projected,
      legal:
        state.stage === "playing"
          ? legalPoints(
              {
                size: state.boardSize,
                cells: state.cells,
                playedAt: state.playedAt,
                toPlay: state.turn,
                history: state.history,
              },
              state.turn,
            ).map((point) => toGtp(point, state.boardSize))
          : [],
    };
  },

  rewatchView(state) {
    const { history: _superko, ...projected } = state;

    return projected;
  },

  agentFields(projection) {
    return {
      board: projection.cells,
      seats: projection.seats,
      boardSize: projection.boardSize,
      turn: projection.turn,
      stage: projection.stage,
      passes: projection.passes,
      captures: projection.captures,
      dead: projection.dead,
      accepted: projection.accepted,
      score: projection.score,
      moves: projection.moves,
      last: projection.last,
      lastCaptured: projection.lastCaptured,
      komi: projection.komi,
    };
  },

  agentDecision: goAgentDecision,
};

function playerAtSeat(state: GoGameState, seat: number): string | undefined {
  return Object.keys(state.seats).find((playerId) => state.seats[playerId] === seat);
}

function winnerOf(state: GoGameState, color: number): string {
  if (!isColor(color)) return "draw";

  return playerAtSeat(state, seatOfColor(color)) ?? "draw";
}

/** The point a client asked for: one GTP string, or a row and column. */
function pointFrom(state: GoGameState, data: WireValue): number | null {
  if (!isWireObject(data)) return null;

  const gtp = data.point;

  if (isString(gtp) && gtp.trim()) return fromGtp(gtp, state.boardSize);

  const row = data.row;
  const col = data.col;

  if (!isNumber(row) || !isNumber(col) || !Number.isInteger(row) || !Number.isInteger(col)) return null;

  if (row < 0 || row >= state.boardSize || col < 0 || col >= state.boardSize) return null;

  return row * state.boardSize + col;
}

function playAt(
  state: GoGameState,
  playerId: string,
  color: GoColor,
  data: WireValue,
  now: number,
): GameActionResult {
  if (state.stage !== "playing") return { ok: false, message: "The game is not in the playing phase" };

  if (state.turn !== color) return { ok: false, message: "Not your turn" };

  const point = pointFrom(state, data);

  if (point === null) return { ok: false, message: "Send a point such as D4, or a row and a column" };

  const step = playStone(
    { size: state.boardSize, cells: state.cells, playedAt: state.playedAt, toPlay: state.turn, history: state.history },
    color,
    point,
    state.moves + 1,
  );

  if (!step.ok) {
    const message =
      step.reason === "occupied"
        ? "That point already has a stone"
        : step.reason === "suicide"
          ? "Suicide is not allowed: the stone would have no liberties"
          : step.reason === "ko"
            ? "Ko: this move would repeat an earlier position"
            : "That point is not on the board";

    return { ok: false, message };
  }

  state.cells = step.cells;
  state.playedAt = step.playedAt;
  state.captures = state.captures.map((count, index) =>
    index === color ? count + step.captured.length : count,
  );
  state.history = [...state.history, step.key];
  state.moves += 1;
  state.passes = 0;
  state.last = { color, kind: "play", point };
  state.lastCaptured = step.captured;
  state.turn = otherColor(color);

  const effects: GameEffect[] = [
    {
      type: "event",
      event: "go_play",
      data: {
        playerId,
        seat: state.seats[playerId],
        point,
        gtp: toGtp(point, state.boardSize),
        captured: step.captured.length,
      },
    },
    ...handOver(state, now),
  ];

  return { ok: true, effects };
}

function pass(state: GoGameState, playerId: string, color: GoColor, now: number): GameActionResult {
  if (state.stage !== "playing") return { ok: false, message: "The game is not in the playing phase" };

  if (state.turn !== color) return { ok: false, message: "Not your turn" };

  state.moves += 1;
  state.passes += 1;
  state.last = { color, kind: "pass", point: null };
  state.lastCaptured = [];
  state.turn = otherColor(color);

  const effects: GameEffect[] = [
    {
      type: "event",
      event: "go_pass",
      data: { playerId, seat: state.seats[playerId], passes: state.passes },
    },
  ];

  if (state.passes >= 2) {
    // Two passes in a row open scoring; nobody has agreed to anything yet, so
    // the dead-stone marking starts empty.
    state.stage = "scoring";
    state.turnState.phase = "scoring";
    state.dead = [];
    state.accepted = [];
    // Scoring has no single turn owner: both seats mark and both accept, so the
    // platform clock keeps running but nobody holds the turn.
    state.turnState.currentPlayerId = null;
    state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
    state.turnState.startedAt = now;

    effects.push({
      type: "event",
      event: "go_scoring",
      data: { accepted: [], dead: [] },
    });

    return { ok: true, effects };
  }

  effects.push(...handOver(state, now));

  return { ok: true, effects };
}

function resume(state: GoGameState, playerId: string): GameActionResult {
  if (state.stage !== "scoring") return { ok: false, message: "Resume is only possible during scoring" };

  state.stage = "playing";
  state.passes = 0;
  state.dead = [];
  state.accepted = [];
  state.turnState.phase = "play";
  state.turnState.currentPlayerId = playerAtSeat(state, seatOfColor(state.turn)) ?? null;

  return {
    ok: true,
    effects: [
      { type: "event", event: "go_resumed", data: { playerId } },
      {
        type: "event",
        event: "turn_changed",
        data: {
          currentPlayerId: state.turnState.currentPlayerId,
          turnNumber: state.turnState.turnNumber,
          phase: "play",
        },
      },
    ],
  };
}

function markDead(state: GoGameState, playerId: string, data: WireValue): GameActionResult {
  if (state.stage !== "scoring") return { ok: false, message: "Dead stones are marked during scoring only" };

  const point = pointFrom(state, data);

  if (point === null) return { ok: false, message: "Send a point such as D4, or a row and a column" };

  if ((state.cells[point] ?? GO_EMPTY) === GO_EMPTY)
    return { ok: false, message: "There is no stone at that point" };

  const stones = groupAt(state.cells, state.boardSize, point).stones;
  const dead = new Set(state.dead);
  const allDead = stones.every((stone) => dead.has(stone));

  for (const stone of stones) {
    if (allDead) dead.delete(stone);
    else dead.add(stone);
  }

  state.dead = [...dead].sort((a, b) => a - b);
  // Any change to the marking voids the agreements.
  state.accepted = [];

  return {
    ok: true,
    effects: [
      {
        type: "event",
        event: "go_dead_marked",
        data: { playerId, point, dead: state.dead.length, all: allDead },
      },
    ],
  };
}

function acceptScore(state: GoGameState, playerId: string, color: GoColor): GameActionResult {
  if (state.stage !== "scoring") return { ok: false, message: "There is nothing to accept outside scoring" };

  const accepted = state.accepted.includes(color) ? state.accepted : [...state.accepted, color];

  state.accepted = accepted;

  const effects: GameEffect[] = [
    { type: "event", event: "go_accepted", data: { playerId, accepted } },
  ];

  if (accepted.length < 2) return { ok: true, effects };

  const score = areaScore(state.cells, state.boardSize, state.dead, state.komi);

  state.score = score;
  state.winner = winnerOf(state, score.winner);
  state.stage = "ended";
  state.status = "ended";
  state.turnState.phase = "ended";
  state.turnState.currentPlayerId = null;

  effects.push(
    { type: "stop_timers" },
    {
      type: "event",
      event: "game_ended",
      data: { reason: "score", winner: state.winner, black: score.black, white: score.white },
    },
    { type: "match_ended", reason: "score" },
  );

  return { ok: true, effects };
}

function resign(state: GoGameState, playerId: string, color: GoColor): GameActionResult {
  const winner = playerAtSeat(state, seatOfColor(otherColor(color)));

  state.winner = winner ?? "draw";
  state.stage = "ended";
  state.status = "ended";
  state.turnState.phase = "ended";
  state.turnState.currentPlayerId = null;

  return {
    ok: true,
    effects: [
      { type: "stop_timers" },
      {
        type: "event",
        event: "game_ended",
        data: { reason: "resign", winner: state.winner, resigned: playerId },
      },
      { type: "match_ended", reason: "resign" },
    ],
  };
}

/** Move the turn clock to the seat whose colour is now to play. */
function handOver(state: GoGameState, now: number): GameEffect[] {
  const next = playerAtSeat(state, seatOfColor(state.turn));

  state.turnState.currentPlayerId = next ?? null;
  state.turnState.turnNumber += 1;
  state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
  state.turnState.startedAt = now;

  return [
    {
      type: "event",
      event: "turn_changed",
      data: {
        currentPlayerId: state.turnState.currentPlayerId,
        turnNumber: state.turnState.turnNumber,
        phase: "play",
      },
    },
  ];
}
