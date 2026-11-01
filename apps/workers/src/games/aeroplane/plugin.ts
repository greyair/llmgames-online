import {
  ROOM_LIFETIME_MS,
  gameOptionValue,
  isNumber,
  isString,
  isWireObject,
  type WireObject,
  type WireValue,
} from "@llmgames/game-catalog";

import { randomId, randomInt } from "../../lib/csprng";
import type { AeroplaneGameState, GameRoomConfig } from "../../durable-objects/types";
import type { GameActionResult, GameEffect, GamePlugin } from "../contract";

import {
  AEROPLANE_COLOUR_NAMES,
  AEROPLANE_HANGAR,
  AEROPLANE_MAX_SEATS,
  AEROPLANE_MIN_SEATS,
  AEROPLANE_PLANES,
  aeroplaneColours,
} from "./board";
import {
  aeroplaneChoices,
  countAeroplaneHome,
  planAeroplaneMove,
  type AeroplaneChoice,
} from "./rules";
import { aeroplaneAgentDecision } from "./agent";

const DEFAULT_MATCH_MS = ROOM_LIFETIME_MS;

const DEFAULT_TURN_MS = 60 * 1000;

/** The source's default take-off rule: only a 6 clears the hangar. */
const DEFAULT_TAKEOFF = [6];

/**
 * Take-off rule from the room's options (C2).
 *
 * `6` needs a six to leave the hangar; `56` also accepts a five. The dice stay
 * server-owned either way: the option changes which face allows a launch, not
 * who rolls.
 */
function takeoffRule(options: GameRoomConfig["options"]): number[] {
  return gameOptionValue("aeroplane", options, "takeoff") === "56" ? [5, 6] : [...DEFAULT_TAKEOFF];
}

/**
 * 飞行棋 (Aeroplane Chess), 2-4 seats. Intents: `roll` then `launch_plane { plane }`
 * or `move_plane { plane }`, both taking plane numbers 1-4.
 *
 * The whole board is public — no hand, no hidden knowledge — so there is no
 * projection to write: hiding a plane would change the game, not the privacy.
 */
export const aeroplanePlugin: GamePlugin<AeroplaneGameState, "aeroplane"> = {
  id: "aeroplane",
  minPlayersToStart: AEROPLANE_MIN_SEATS,
  initialTurnPhase: "roll",

  createInitialState(config, roomCode, now) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;
    const requested = Math.trunc(config.maxPlayers ?? AEROPLANE_MAX_SEATS);
    const maxPlayers = Math.min(Math.max(requested, AEROPLANE_MIN_SEATS), AEROPLANE_MAX_SEATS);

    return {
      id: randomId(),
      roomCode,
      type: "aeroplane",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers,
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
      colours: [],
      takeoff: takeoffRule(config.options),
      planes: [],
      roll: null,
      rollBy: null,
      sixes: 0,
      lastMove: null,
      winner: null,
    };
  },

  start(state, context) {
    const players = state.players;

    if (players.length < AEROPLANE_MIN_SEATS) return;

    // Seat order follows the table, starting from the seat the platform drew.
    // Every seat keeps the same colour and the same four planes for the match.
    const order = players
    .slice(context.firstPlayerIndex)
    .concat(players.slice(0, context.firstPlayerIndex));

    state.seats = {};
    order.forEach((player, index) => {
      state.seats[player.id] = index;
    });

    state.colours = aeroplaneColours(order.length);
    state.planes = order.map(() => new Array<number>(AEROPLANE_PLANES).fill(AEROPLANE_HANGAR));
    // The rule comes from the room, not from the module: `start()` must not
    // quietly reset a 5-or-6 room to the default take-off.
    state.takeoff = takeoffRule(state.roomOptions);
    state.roll = null;
    state.rollBy = null;
    state.sixes = 0;
    state.lastMove = null;
    state.winner = null;
    state.turnState.currentPlayerId = order[0]?.id ?? null;
    state.turnState.phase = "roll";
    state.turnState.turnNumber = 1;
  },

  turnActions(state, playerId, viewer) {
    if (viewer.isSpectator) return [];

    if (state.status !== "playing") return [];

    if (state.turnState.currentPlayerId !== playerId) return [];

    if (state.turnState.phase === "roll") return ["roll"];

    if (state.turnState.phase !== "choose" || state.roll === null) return [];

    const seat = state.seats[playerId];

    if (seat === undefined) return [];

    // Both names are offered only when both are legal, so an agent reading this
    // list cannot send a launch the board would refuse.
    const kinds = new Set(aeroplaneChoices(state, seat, state.roll).map((choice) => choice.kind));
    const actions: string[] = [];

    if (kinds.has("launch")) actions.push("launch_plane");

    if (kinds.has("move")) actions.push("move_plane");

    return actions;
  },

  seatIdentity(state, playerId, viewer) {
    if (viewer.isSpectator) return { seat: null, role: "spectator" };

    const seat = state.seats[playerId] ?? null;

    return {
      seat,
      role: seat === null ? null : `seat${seat}`,
      color: seat === null ? null : AEROPLANE_COLOUR_NAMES[state.colours[seat] ?? 0] ?? null,
    };
  },

  applyAction(state, playerId, intent, now) {
    if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

    if (state.turnState.currentPlayerId !== playerId) return { ok: false, message: "Not your turn" };

    const seat = state.seats[playerId];

    if (seat === undefined) return { ok: false, message: "No seat assigned" };

    if (intent.actionType === "roll") return rollDice(state, playerId, seat);

    if (intent.actionType === "launch_plane" || intent.actionType === "launch")
      return playPlane(state, playerId, seat, intent.data, "launch", now);

    if (intent.actionType === "move_plane" || intent.actionType === "move")
      return playPlane(state, playerId, seat, intent.data, "move", now);

    return { ok: false, message: `Unknown action: ${intent.actionType}` };
  },

  onTurnTimeout(state, playerId, now) {
    const effects: GameEffect[] = [
      { type: "event", event: "turn_timeout", data: { playerId } },
    ];

    // Nothing has been committed on the board, so a timeout simply loses the
    // roll: no plane is teleported and no die result is carried over.
    state.roll = null;
    state.rollBy = null;
    state.sixes = 0;

    return [...effects, ...beginTurnForNextSeat(state, now)];
  },

  agentFields(projection) {
    return {
      seats: projection.seats,
      colours: projection.colours,
      takeoff: projection.takeoff,
      planes: projection.planes,
      roll: projection.roll,
      sixes: projection.sixes,
      lastMove: projection.lastMove,
    };
  },

  agentDecision: aeroplaneAgentDecision,
};

/** One die roll: 1-6 from the platform CSPRNG, never from Math.random. */
function rollDice(state: AeroplaneGameState, playerId: string, seat: number): GameActionResult {
  if (state.turnState.phase !== "roll")
    return { ok: false, message: `You already rolled a ${state.roll}; choose a plane` };

  const value = randomInt(6) + 1;
  const sixes = value === 6 ? state.sixes + 1 : 0;

  state.roll = value;
  state.rollBy = playerId;
  state.sixes = sixes;

  const effects: GameEffect[] = [
    { type: "event", event: "aeroplane_roll", data: { playerId, seat, value } },
  ];

  const choices = aeroplaneChoices(state, seat, value);

  if (choices.length === 0) {
    // Nothing can use the roll. Sixes still earn another attempt, which is why
    // the source keeps the count until something actually moves.
    const again = value === 6 && sixes < 3;

    effects.push({ type: "event", event: "aeroplane_pass", data: { playerId, seat, again } });

    if (!again) return { ok: true, effects: [...effects, ...beginTurnForNextSeat(state, 0)] };

    state.turnState.phase = "roll";

    return { ok: true, effects };
  }

  state.turnState.phase = "choose";

  return { ok: true, effects };
}

function playPlane(
  state: AeroplaneGameState,
  playerId: string,
  seat: number,
  data: WireValue,
  requested: "launch" | "move",
  now: number,
): GameActionResult {
  if (state.turnState.phase !== "choose" || state.roll === null)
    return { ok: false, message: "Roll the dice first" };

  const payload = isWireObject(data) ? data.plane : undefined;

  if (!isNumber(payload) || !Number.isInteger(payload) || payload < 1 || payload > AEROPLANE_PLANES)
    return { ok: false, message: `Plane number must be 1-${AEROPLANE_PLANES}` };

  const plane = payload;
  const choice = planAeroplaneMove(state, seat, plane, state.roll);

  if (isString(choice)) return { ok: false, message: choice };

  if (choice.kind !== requested)
    return choice.kind === "launch"
      ? { ok: false, message: `Plane ${plane} is in the hangar; launch it instead` }
      : { ok: false, message: `Plane ${plane} has already taken off; move it instead` };

  return { ok: true, effects: commitMove(state, playerId, seat, choice, now) };
}

function commitMove(
  state: AeroplaneGameState,
  playerId: string,
  seat: number,
  choice: AeroplaneChoice,
  now: number,
): GameEffect[] {
  const effects: GameEffect[] = [];

  state.planes[seat]![choice.plane - 1] = choice.to;

  for (const victim of choice.captures)
    for (const plane of victim.planes) state.planes[victim.seat]![plane - 1] = AEROPLANE_HANGAR;

  state.lastMove = {
    playerId,
    seat,
    plane: choice.plane,
    kind: choice.kind,
    from: choice.from,
    to: choice.to,
    jump: choice.jump,
    fly: choice.fly,
    bounce: choice.bounce,
    home: choice.home,
    sentBack: choice.sentBack,
    captures: choice.captures,
  };

  if (choice.sentBack)
    effects.push({
      type: "event",
      event: "aeroplane_sent_back",
      data: { playerId, seat, plane: choice.plane },
    });
  else if (choice.kind === "launch")
    effects.push({
      type: "event",
      event: "aeroplane_launch",
      data: { playerId, seat, plane: choice.plane },
    });
  else {
    effects.push({
      type: "event",
      event: "aeroplane_move",
      data: {
        playerId,
        seat,
        plane: choice.plane,
        from: choice.from,
        to: choice.to,
        bounce: choice.bounce,
        jump: choice.jump,
        fly: choice.fly,
      },
    });

    if (choice.captures.length)
      effects.push({
        type: "event",
        event: "aeroplane_capture",
        data: {
          playerId,
          seat,
          plane: choice.plane,
          victims: choice.captures.map((victim): WireObject => ({ ...victim })),
        },
      });
  }

  if (countAeroplaneHome(state.planes[seat]!) === AEROPLANE_PLANES) {
    state.winner = playerId;
    state.status = "ended";
    state.turnState.phase = "ended";
    state.roll = null;
    state.rollBy = null;
    effects.push(
      { type: "stop_timers" },
      {
        type: "event",
        event: "game_ended",
        data: { reason: "all_planes_home", winner: playerId },
      },
      { type: "match_ended", reason: "all_planes_home" },
    );

    return effects;
  }

  if (choice.sentBack || state.roll !== 6)
    return [...effects, ...beginTurnForNextSeat(state, now)];

  // A six keeps the dice. The count carries over so three in a row still sends
  // the next chosen plane home.
  state.turnState.phase = "roll";
  state.roll = null;
  state.rollBy = null;

  effects.push({
    type: "event",
    event: "aeroplane_again",
    data: { playerId, seat, sixes: state.sixes },
  });

  return effects;
}

/**
 * Hand the dice to the next seat and reset everything that belongs to one turn.
 *
 * `now === 0` skips resetting the clock: the caller is still inside the same
 * action's expiry handling and the platform writes its own timer afterwards.
 */
function beginTurnForNextSeat(state: AeroplaneGameState, now: number): GameEffect[] {
  const seats = Object.keys(state.seats).length;
  const current = state.turnState.currentPlayerId;
  const nextSeat = seats === 0 ? 0 : ((state.seats[current ?? ""] ?? -1) + 1) % seats;

  const nextPlayerId = Object.keys(state.seats).find(
    (playerId) => state.seats[playerId] === nextSeat,
  );

  state.turnState.currentPlayerId = nextPlayerId ?? null;
  state.turnState.phase = "roll";
  state.turnState.turnNumber++;
  state.roll = null;
  state.rollBy = null;
  state.sixes = 0;

  if (now > 0) {
    state.turnState.startedAt = now;
    state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
  }

  return [
    {
      type: "event",
      event: "turn_changed",
      data: {
        currentPlayerId: state.turnState.currentPlayerId,
        turnNumber: state.turnState.turnNumber,
        phase: "roll",
      },
    },
  ];
}
