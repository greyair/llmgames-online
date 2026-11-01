import {
  ROOM_LIFETIME_MS,
  gameOptionNumber,
  isNumber,
  isWireObject,
  type WireValue,
} from "@llmgames/game-catalog";

import { randomId, randomInt, shuffleInPlace } from "../../lib/csprng";
import type { GameRoomConfig, MonopolyGameState } from "../../durable-objects/types";
import type { GameActionResult, GameEffect, GamePlugin } from "../contract";

import {
  MONOPOLY_BOARD_SIZE,
  MONOPOLY_CARDS,
  MONOPOLY_GO_BONUS,
  MONOPOLY_JAIL,
  MONOPOLY_JAIL_FINE,
  MONOPOLY_JAILFREE_CARD,
  MONOPOLY_SEATS_MAX,
  MONOPOLY_SEATS_MIN,
  MONOPOLY_SPACES,
  MONOPOLY_START_CASH,
  MONOPOLY_TOKENS,
  advance,
  monopolySpace,
} from "./board";
import { monopolyAgentDecision } from "./agent";
import {
  bankrupt,
  buildableSpaces,
  canBuild,
  charge,
  houseCostFor,
  houseLevels,
  lastStanding,
  netWorth,
  rentFor,
  richest,
  solvent,
} from "./rules";

const DEFAULT_MATCH_MS = ROOM_LIFETIME_MS;

const DEFAULT_TURN_MS = 60 * 1000;

/**
 * Round limit from the room's options (C2).
 *
 * `0` means "play until one seat is left", which the room lifetime still
 * bounds: an unlimited game cannot outlive the Durable Object's own deadlines.
 */
function roundLimitFrom(options: GameRoomConfig["options"]): number {
  return gameOptionNumber("monopoly", options, "rounds");
}

/**
 * 大富翁, 2-4 seats on a 24-space ring. Intents: `roll`, `buy`, `skip`,
 * `build { space }`, `pay`, `card`, `end`.
 *
 * Everything on the board is public — cash, owners, houses — so the only thing
 * the projection hides is the chance deck's remaining order. The dice are drawn
 * inside `applyAction` from the platform CSPRNG and stored, so a repeated
 * `requestId` or a restart can never roll twice.
 */
export const monopolyPlugin: GamePlugin<MonopolyGameState, "monopoly"> = {
  id: "monopoly",
  minPlayersToStart: MONOPOLY_SEATS_MIN,
  initialTurnPhase: "roll",

  createInitialState(config, roomCode, now) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;
    const requested = Math.trunc(config.maxPlayers ?? MONOPOLY_SEATS_MAX);
    const maxPlayers = Math.min(Math.max(requested, MONOPOLY_SEATS_MIN), MONOPOLY_SEATS_MAX);
    const empty = new Array<number>(MONOPOLY_BOARD_SIZE).fill(0);

    return {
      id: randomId(),
      roomCode,
      type: "monopoly",
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
      cash: [],
      position: [],
      jail: [],
      jailTurns: [],
      jailCards: [],
      owners: MONOPOLY_SPACES.map(() => null),
      houses: [...empty],
      deck: [],
      doubles: 0,
      roll: null,
      card: null,
      landed: null,
      bankrupt: [],
      winner: null,
      turns: 0,
      rounds: 0,
      roundLimit: roundLimitFrom(config.options),
    };
  },

  start(state, context) {
    const players = state.players;

    if (players.length < MONOPOLY_SEATS_MIN) return;

    const order = players
      .slice(context.firstPlayerIndex)
      .concat(players.slice(0, context.firstPlayerIndex))
      .slice(0, MONOPOLY_SEATS_MAX);

    state.seats = {};
    order.forEach((player, index) => {
      state.seats[player.id] = index;
    });

    state.cash = order.map(() => MONOPOLY_START_CASH);
    state.position = order.map(() => 0);
    state.jail = order.map(() => false);
    state.jailTurns = order.map(() => 0);
    state.jailCards = order.map(() => 0);
    state.owners = MONOPOLY_SPACES.map(() => null);
    state.houses = MONOPOLY_SPACES.map(() => 0);
    state.deck = sealedDeck();
    state.doubles = 0;
    state.roll = null;
    state.card = null;
    state.landed = null;
    state.bankrupt = order.map(() => false);
    state.winner = null;
    state.turns = 0;
    state.rounds = 0;
    // `roundLimit` is configuration: `createInitialState` read it from the room
    // options and it must survive a restart, so `start` leaves it alone.
    state.turnState.currentPlayerId = order[0]?.id ?? null;
    state.turnState.phase = "roll";
    state.turnState.turnNumber = 1;
  },

  turnActions(state, playerId, viewer) {
    if (viewer.isSpectator) return [];

    if (state.status !== "playing") return [];

    if (state.turnState.currentPlayerId !== playerId) return [];

    const seat = state.seats[playerId];

    if (seat === undefined) return [];

    if (state.turnState.phase === "roll") {
      if (!state.jail[seat]) return ["roll"];

      const actions = ["roll"];

      if ((state.cash[seat] ?? 0) >= MONOPOLY_JAIL_FINE) actions.unshift("pay");

      if ((state.jailCards[seat] ?? 0) > 0) actions.unshift("card");

      return actions;
    }

    if (state.turnState.phase === "buy") {
      const price = monopolySpace(state.landed ?? 0).price ?? 0;

      return (state.cash[seat] ?? 0) >= price ? ["buy", "skip"] : ["skip"];
    }

    return buildable(state, seat).length > 0 ? ["build", "end"] : ["end"];
  },

  seatIdentity(state, playerId, viewer) {
    if (viewer.isSpectator) return { seat: null, role: "spectator" };

    const seat = state.seats[playerId] ?? null;

    return {
      seat,
      role: seat === null ? null : `seat${seat}`,
      color: seat === null ? null : (MONOPOLY_TOKENS[seat] ?? null),
    };
  },

  applyAction(state, playerId, intent, now) {
    if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

    if (state.turnState.currentPlayerId !== playerId) return { ok: false, message: "Not your turn" };

    const seat = state.seats[playerId];

    if (seat === undefined) return { ok: false, message: "No seat assigned" };

    if (intent.actionType === "roll") return roll(state, playerId, seat, now);

    if (intent.actionType === "buy") return buy(state, playerId, seat, now);

    if (intent.actionType === "skip") return skip(state, playerId, seat, now);

    if (intent.actionType === "build") return build(state, playerId, seat, intent.data, now);

    if (intent.actionType === "pay") return payFine(state, playerId, seat, now);

    if (intent.actionType === "card") return useCard(state, playerId, seat, now);

    if (intent.actionType === "end") return endTurn(state, playerId, seat, now);

    return { ok: false, message: `Unknown action: ${intent.actionType}` };
  },

  onTurnTimeout(state, playerId, now) {
    if (!playerId) return [];

    const seat = state.seats[playerId];

    if (seat === undefined) return [];

    const timeout: GameEffect = { type: "event", event: "turn_timeout", data: { playerId } };
    const phase = state.turnState.phase;

    // Standing still is worse than acting: the platform rolls, skips the purchase
    // and ends the turn rather than freezing the table.
    if (phase === "buy") {
      const skipped = skip(state, playerId, seat, now);

      return skipped.ok ? [timeout, ...(skipped.effects ?? [])] : [timeout];
    }

    if (phase === "end") {
      const ended = endTurn(state, playerId, seat, now);

      return ended.ok ? [timeout, ...(ended.effects ?? [])] : [timeout];
    }

    const rolled = roll(state, playerId, seat, now);

    return rolled.ok ? [timeout, ...(rolled.effects ?? [])] : [timeout];
  },

  /** The clock runs out: the richest surviving seat takes the match. */
  onMatchTimeout(state) {
    const winners = richest(state);

    if (winners.length === 0) return;

    state.winner = winners.length === 1 ? (playerAtSeat(state, winners[0]!) ?? "draw") : "draw";
    state.status = "ended";
    state.turnState.phase = "ended";
    state.turnState.currentPlayerId = null;
  },

  /** Only the chance deck's order is secret; the board is public. */
  projectState(state, playerId) {
    const seat = state.seats[playerId];

    return {
      ...state,
      deck: undefined,
      deckCount: state.deck.length,
      // The viewer's own build options, so the browser needs no copy of the
      // group rule to know which squares it may click.
      buildable: seat === undefined ? [] : buildableSpaces(state, seat),
    };
  },

  agentFields(projection) {
    return {
      buildable: projection.buildable,
      seatMap: projection.seats,
      cash: projection.cash,
      position: projection.position,
      jail: projection.jail,
      jailTurns: projection.jailTurns,
      jailCards: projection.jailCards,
      owners: projection.owners,
      houses: projection.houses,
      deckCount: projection.deckCount,
      doubles: projection.doubles,
      roll: projection.roll,
      card: projection.card,
      landed: projection.landed,
      bankrupt: projection.bankrupt,
      rounds: projection.rounds,
      roundLimit: projection.roundLimit,
      winner: projection.winner,
    };
  },

  agentDecision: monopolyAgentDecision,
};

function playerAtSeat(state: MonopolyGameState, seat: number): string | undefined {
  return Object.keys(state.seats).find((playerId) => state.seats[playerId] === seat);
}

function sealedDeck(): number[] {
  const deck = MONOPOLY_CARDS.map((card) => card.id);

  shuffleInPlace(deck);

  return deck;
}

/** Spaces this seat could build on right now. */
function buildable(state: MonopolyGameState, seat: number): number[] {
  return MONOPOLY_SPACES.filter((space) => canBuild(state, seat, space.index)).map(
    (space) => space.index,
  );
}

type MonopolyPhase = "roll" | "buy" | "end";

function handOver(
  state: MonopolyGameState,
  seat: number,
  phase: MonopolyPhase,
  now: number,
): GameEffect[] {
  state.turnState.currentPlayerId = playerAtSeat(state, seat) ?? null;
  state.turnState.phase = phase;
  state.turnState.turnNumber++;

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
        phase,
      },
    },
  ];
}

/** Give the turn to the next surviving seat and reset the turn's dice state. */
function nextTurn(state: MonopolyGameState, from: number, now: number): GameEffect[] {
  const alive = solvent(state);

  state.doubles = 0;
  state.roll = null;
  state.card = null;
  state.landed = null;
  state.turns += 1;
  state.rounds = Math.floor(state.turns / Math.max(alive.length, 1));

  // A round-limited room settles on assets as soon as the last round ends:
  // richest surviving seat wins, ties are a draw, and the event carries net
  // worth so a client can show why the result is what it is.
  if (state.roundLimit > 0 && state.rounds >= state.roundLimit)
    return finish(state, richest(state), "round_limit");

  let seat = from;

  for (let step = 0; step < MONOPOLY_BOARD_SIZE; step += 1) {
    seat = (seat + 1) % Math.max(state.bankrupt.length, 1);

    if (!state.bankrupt[seat]) break;
  }

  return handOver(state, seat, "roll", now);
}

function roll(state: MonopolyGameState, playerId: string, seat: number, now: number): GameActionResult {
  if (state.turnState.phase !== "roll")
    return { ok: false, message: "Resolve the current decision first" };

  const first = randomInt(6) + 1;
  const second = randomInt(6) + 1;
  const total = first + second;
  const doubled = first === second;

  state.roll = [first, second];

  const effects: GameEffect[] = [
    {
      type: "event",
      event: "monopoly_roll",
      data: { playerId, seat, dice: [first, second], total, doubles: doubled },
    },
  ];

  if (state.jail[seat]) return rollInJail(state, playerId, seat, total, doubled, now, effects);

  if (doubled) {
    state.doubles += 1;

    if (state.doubles >= 3) {
      effects.push(...sendToJail(state, playerId, seat));
      effects.push(...handOver(state, seat, "end", now));

      return { ok: true, effects };
    }
  }

  effects.push(...moveBy(state, playerId, seat, total, now));

  return { ok: true, effects };
}

function rollInJail(
  state: MonopolyGameState,
  playerId: string,
  seat: number,
  total: number,
  doubled: boolean,
  now: number,
  effects: GameEffect[],
): GameActionResult {
  if (doubled) {
    state.jail[seat] = false;
    state.jailTurns[seat] = 0;
    effects.push({ type: "event", event: "monopoly_released", data: { playerId, seat, how: "doubles" } });
    effects.push(...moveBy(state, playerId, seat, total, now, false));

    return { ok: true, effects };
  }

  state.jailTurns[seat] = (state.jailTurns[seat] ?? 0) + 1;

  if ((state.jailTurns[seat] ?? 0) < 3) {
    effects.push({ type: "event", event: "monopoly_jail_wait", data: { playerId, seat, tries: state.jailTurns[seat] } });
    effects.push(...handOver(state, seat, "end", now));

    return { ok: true, effects };
  }

  // Third failed attempt: the fine is due and the roll still moves the token.
  state.jail[seat] = false;
  state.jailTurns[seat] = 0;
  settle(state, seat, MONOPOLY_JAIL_FINE, null, effects);
  effects.push(...moveBy(state, playerId, seat, total, now, false));

  return { ok: true, effects };
}

/** Move, collect the passing bonus, then resolve the landing. */
function moveBy(
  state: MonopolyGameState,
  playerId: string,
  seat: number,
  steps: number,
  now: number,
  allowExtraRoll = true,
): GameEffect[] {
  const from = state.position[seat] ?? 0;
  const to = advance(from, steps);
  const effects: GameEffect[] = [];

  if (to < from) {
    state.cash[seat] = (state.cash[seat] ?? 0) + MONOPOLY_GO_BONUS;
    effects.push({
      type: "event",
      event: "monopoly_go_bonus",
      data: { playerId, seat, amount: MONOPOLY_GO_BONUS },
    });
  }

  state.position[seat] = to;
  state.landed = to;

  effects.push({
    type: "event",
    event: "monopoly_move",
    data: { playerId, seat, from, to, name: monopolySpace(to).name },
  });

  effects.push(...resolveLanding(state, playerId, seat, to, now, allowExtraRoll));

  return effects;
}

function resolveLanding(
  state: MonopolyGameState,
  playerId: string,
  seat: number,
  index: number,
  now: number,
  allowExtraRoll: boolean,
): GameEffect[] {
  const space = monopolySpace(index);
  const effects: GameEffect[] = [];

  if (space.kind === "property") {
    const owner = state.owners[index] ?? null;

    if (owner === null) {
      const price = space.price ?? 0;

      if ((state.cash[seat] ?? 0) >= price) {
        state.turnState.phase = "buy";

        effects.push({
          type: "event",
          event: "monopoly_offer",
          data: { playerId, seat, index, name: space.name, price },
        });

        return effects;
      }

      effects.push({
        type: "event",
        event: "monopoly_declined",
        data: { playerId, seat, index, reason: "cannot_afford" },
      });

      return [...effects, ...finishTurn(state, seat, now, allowExtraRoll)];
    }

    if (owner !== seat) {
      const rent = rentFor(state, index);

      settle(state, seat, rent, owner, effects);

      effects.push({
        type: "event",
        event: "monopoly_rent",
        data: { playerId, seat, owner, index, name: space.name, amount: rent },
      });

      if (state.bankrupt[seat]) return [...effects, ...afterBankruptcy(state, now)];

      return [...effects, ...finishTurn(state, seat, now, allowExtraRoll)];
    }

    effects.push({
      type: "event",
      event: "monopoly_owned",
      data: { playerId, seat, index, name: space.name, houses: state.houses[index] ?? 0 },
    });

    return [...effects, ...finishTurn(state, seat, now, allowExtraRoll)];
  }

  if (space.kind === "tax") {
    settle(state, seat, space.tax ?? 0, null, effects);
    effects.push({
      type: "event",
      event: "monopoly_tax",
      data: { playerId, seat, index, amount: space.tax ?? 0 },
    });

    if (state.bankrupt[seat]) return [...effects, ...afterBankruptcy(state, now)];

    return [...effects, ...finishTurn(state, seat, now, allowExtraRoll)];
  }

  if (space.kind === "chance") {
    effects.push(...drawCard(state, playerId, seat, now, allowExtraRoll));

    return effects;
  }

  if (space.kind === "gotojail") {
    effects.push(...sendToJail(state, playerId, seat));

    return [...effects, ...handOver(state, seat, "end", now)];
  }

  return [...effects, ...finishTurn(state, seat, now, allowExtraRoll)];
}

/** End the turn, or hand the dice back on a double. */
function finishTurn(
  state: MonopolyGameState,
  seat: number,
  now: number,
  allowExtraRoll: boolean,
): GameEffect[] {
  if (allowExtraRoll && state.doubles > 0) return handOver(state, seat, "roll", now);

  return nextTurn(state, seat, now);
}

function drawCard(
  state: MonopolyGameState,
  playerId: string,
  seat: number,
  now: number,
  allowExtraRoll: boolean,
): GameEffect[] {
  if (state.deck.length === 0) state.deck = sealedDeck();

  const id = state.deck.pop() ?? 0;
  const card = MONOPOLY_CARDS[id] ?? MONOPOLY_CARDS[0]!;

  state.card = id;

  const effects: GameEffect[] = [
    { type: "event", event: "monopoly_card", data: { playerId, seat, card: id, text: card.en } },
  ];

  const others = solvent(state).filter((other) => other !== seat);

  if (card.kind === "collect") {
    state.cash[seat] = (state.cash[seat] ?? 0) + card.n;
  } else if (card.kind === "pay") {
    settle(state, seat, card.n, null, effects);
  } else if (card.kind === "fromEach") {
    for (const other of others) {
      settle(state, other, card.n, seat, effects);

      if (state.bankrupt[other]) effects.push(...afterBankruptcy(state, now));
    }
  } else if (card.kind === "toEach") {
    for (const other of others) settle(state, seat, card.n, other, effects);
  } else if (card.kind === "repairs") {
    settle(state, seat, houseLevels(state, seat) * card.n, null, effects);
  } else if (card.kind === "jailfree") {
    state.jailCards[seat] = (state.jailCards[seat] ?? 0) + 1;
  } else if (card.kind === "jail") {
    effects.push(...sendToJail(state, playerId, seat));

    return [...effects, ...handOver(state, seat, "end", now)];
  } else if (card.kind === "goto") {
    const from = state.position[seat] ?? 0;
    const to = card.n;

    if (to < from) state.cash[seat] = (state.cash[seat] ?? 0) + MONOPOLY_GO_BONUS;

    state.position[seat] = to;
    state.landed = to;

    effects.push({
      type: "event",
      event: "monopoly_move",
      data: { playerId, seat, from, to, name: monopolySpace(to).name },
    });

    return [...effects, ...resolveLanding(state, playerId, seat, to, now, allowExtraRoll)];
  } else if (card.kind === "forward") {
    return [...effects, ...moveBy(state, playerId, seat, card.n, now, allowExtraRoll)];
  } else if (card.kind === "back") {
    const from = state.position[seat] ?? 0;
    const to = advance(from, -card.n);

    state.position[seat] = to;
    state.landed = to;

    effects.push({
      type: "event",
      event: "monopoly_move",
      data: { playerId, seat, from, to, name: monopolySpace(to).name },
    });

    return [...effects, ...resolveLanding(state, playerId, seat, to, now, allowExtraRoll)];
  }

  if (state.bankrupt[seat]) return [...effects, ...afterBankruptcy(state, now)];

  return [...effects, ...finishTurn(state, seat, now, allowExtraRoll)];
}

/** Move money, then settle any bankruptcy the transfer caused. */
function settle(
  state: MonopolyGameState,
  from: number,
  amount: number,
  to: number | null,
  effects: GameEffect[],
): void {
  if (amount <= 0) return;

  const broke = charge(state, from, amount);

  if (to !== null && !broke) state.cash[to] = (state.cash[to] ?? 0) + amount;

  if (!broke) return;

  const seat = from;

  bankrupt(state, seat);
  effects.push({
    type: "event",
    event: "monopoly_bankrupt",
    data: { seat, playerId: playerAtSeat(state, seat) ?? null },
  });
}

function sendToJail(state: MonopolyGameState, playerId: string, seat: number): GameEffect[] {
  state.jail[seat] = true;
  state.jailTurns[seat] = 0;
  state.position[seat] = MONOPOLY_JAIL;
  state.doubles = 0;

  return [
    {
      type: "event",
      event: "monopoly_jailed",
      data: { playerId, seat, index: MONOPOLY_JAIL },
    },
  ];
}

/** After a bankruptcy, end the match if only one seat is left. */
function afterBankruptcy(state: MonopolyGameState, now: number): GameEffect[] {
  const standing = lastStanding(state);

  if (standing === null) {
    const alive = solvent(state);
    const seat = alive[0] ?? 0;

    return nextTurn(state, seat, now);
  }

  return finish(state, [standing], "last_standing");
}

function finish(state: MonopolyGameState, winners: number[], reason: string): GameEffect[] {
  const ids = winners.flatMap((seat) => {
    const id = playerAtSeat(state, seat);

    return id === undefined ? [] : [id];
  });

  state.winner = ids.length === 1 ? (ids[0] ?? "draw") : "draw";
  state.status = "ended";
  state.turnState.phase = "ended";
  state.turnState.currentPlayerId = null;

  return [
    { type: "stop_timers" },
    {
      type: "event",
      event: "game_ended",
      data: { reason, winners: ids, netWorth: winners.map((seat) => netWorth(state, seat)) },
    },
    { type: "match_ended", reason },
  ];
}

function buy(state: MonopolyGameState, playerId: string, seat: number, now: number): GameActionResult {
  if (state.turnState.phase !== "buy") return { ok: false, message: "Nothing to buy" };

  const index = state.landed ?? 0;
  const space = monopolySpace(index);
  const price = space.price ?? 0;

  if (state.owners[index] !== null) return { ok: false, message: "That space is already owned" };

  if ((state.cash[seat] ?? 0) < price) return { ok: false, message: "Not enough cash" };

  state.cash[seat] = (state.cash[seat] ?? 0) - price;
  state.owners[index] = seat;

  return {
    ok: true,
    effects: [
      {
        type: "event",
        event: "monopoly_buy",
        data: { playerId, seat, index, name: space.name, price },
      },
      ...finishTurn(state, seat, now, true),
    ],
  };
}

function skip(state: MonopolyGameState, playerId: string, seat: number, now: number): GameActionResult {
  if (state.turnState.phase !== "buy") return { ok: false, message: "Nothing to skip" };

  const index = state.landed ?? 0;

  return {
    ok: true,
    effects: [
      {
        type: "event",
        event: "monopoly_declined",
        data: { playerId, seat, index, reason: "skipped" },
      },
      ...finishTurn(state, seat, now, true),
    ],
  };
}

function build(
  state: MonopolyGameState,
  playerId: string,
  seat: number,
  data: WireValue,
  now: number,
): GameActionResult {
  if (state.turnState.phase === "buy") return { ok: false, message: "Finish the purchase first" };

  if (state.turnState.phase !== "end" && state.turnState.phase !== "roll")
    return { ok: false, message: "You cannot build now" };

  const index = isWireObject(data) && isNumber(data.space) ? Math.trunc(data.space) : -1;

  if (index < 0 || index >= MONOPOLY_BOARD_SIZE) return { ok: false, message: "Pick a space 0-23" };

  if (!canBuild(state, seat, index))
    return { ok: false, message: "You need the whole group, room for another level and the cash" };

  const cost = houseCostFor(index);

  state.cash[seat] = (state.cash[seat] ?? 0) - cost;
  state.houses[index] = (state.houses[index] ?? 0) + 1;

  const effects: GameEffect[] = [
    {
      type: "event",
      event: "monopoly_build",
      data: {
        playerId,
        seat,
        index,
        name: monopolySpace(index).name,
        houses: state.houses[index] ?? 0,
        cost,
      },
    },
  ];

  return { ok: true, effects: [...effects, ...handOver(state, seat, state.turnState.phase, now)] };
}

function payFine(state: MonopolyGameState, playerId: string, seat: number, now: number): GameActionResult {
  if (!state.jail[seat]) return { ok: false, message: "You are not in jail" };

  if (state.turnState.phase !== "roll") return { ok: false, message: "Roll first" };

  if ((state.cash[seat] ?? 0) < MONOPOLY_JAIL_FINE)
    return { ok: false, message: `The fine is ${MONOPOLY_JAIL_FINE}` };

  state.cash[seat] = (state.cash[seat] ?? 0) - MONOPOLY_JAIL_FINE;
  state.jail[seat] = false;
  state.jailTurns[seat] = 0;

  return {
    ok: true,
    effects: [
      {
        type: "event",
        event: "monopoly_released",
        data: { playerId, seat, how: "paid", amount: MONOPOLY_JAIL_FINE },
      },
      ...handOver(state, seat, "roll", now),
    ],
  };
}

function useCard(state: MonopolyGameState, playerId: string, seat: number, now: number): GameActionResult {
  if (!state.jail[seat]) return { ok: false, message: "You are not in jail" };

  if ((state.jailCards[seat] ?? 0) <= 0) return { ok: false, message: "You hold no card" };

  if (state.turnState.phase !== "roll") return { ok: false, message: "Roll first" };

  state.jailCards[seat] = (state.jailCards[seat] ?? 0) - 1;
  state.jail[seat] = false;
  state.jailTurns[seat] = 0;

  return {
    ok: true,
    effects: [
      {
        type: "event",
        event: "monopoly_released",
        data: { playerId, seat, how: "card", card: MONOPOLY_JAILFREE_CARD },
      },
      ...handOver(state, seat, "roll", now),
    ],
  };
}

function endTurn(state: MonopolyGameState, playerId: string, seat: number, now: number): GameActionResult {
  if (state.turnState.phase !== "end") return { ok: false, message: "Resolve the roll first" };

  if (state.doubles > 0) return { ok: false, message: "You rolled doubles: roll again" };

  return {
    ok: true,
    effects: [
      { type: "event", event: "monopoly_end", data: { playerId, seat } },
      ...nextTurn(state, seat, now),
    ],
  };
}
