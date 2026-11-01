import {
  ROOM_LIFETIME_MS,
  isNumber,
  isString,
  isWireObject,
  type WireValue,
} from "@llmgames/game-catalog";

import { randomId } from "../../lib/csprng";
import type {
  CardActionRecord,
  CardCombo,
  DoudizhuGameState,
} from "../../durable-objects/types";
import type { GameActionResult, GameEffect, GamePlugin } from "../contract";

import { DOUDIZHU_COMBOS, beats, classify } from "../cards/combo";
import { cardsText, pickCards, sortCards } from "../cards/deck";
import { doudizhuAgentDecision } from "./agent";
import {
  DDZ_SEATS,
  dealDoudizhu,
  ddzForcedPlay,
  doudizhuScore,
  isSpring,
  nextBidder,
} from "./rules";

const DEFAULT_MATCH_MS = ROOM_LIFETIME_MS;

const DEFAULT_TURN_MS = 60 * 1000;

/** How many recent actions the projection keeps for the trail. */
const HISTORY = 12;

/**
 * 斗地主 (Fight the Landlord), exactly 3 seats. Intents: `bid { value }` during
 * the auction, then `play_cards { cards }` and `pass`.
 *
 * Two things make this game different from 跑得快:
 *
 * - A bidding phase decides who is the landlord and hands them three extra
 *   cards. A deal nobody bids on is thrown in and dealt again.
 * - The result is a side. `winnerSide` and `you.team` carry landlord against
 *   farmers, so both farmers see the win when their side takes it.
 */
export const doudizhuPlugin: GamePlugin<DoudizhuGameState, "doudizhu"> = {
  id: "doudizhu",
  minPlayersToStart: DDZ_SEATS,
  initialTurnPhase: "bid",

  createInitialState(config, roomCode, now) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;

    return {
      id: randomId(),
      roomCode,
      type: "doudizhu",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: DDZ_SEATS,
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
      hands: [],
      bottom: [],
      bottomRevealed: false,
      landlord: null,
      bid: 0,
      bidder: null,
      bids: [],
      toAct: 0,
      firstBidder: 0,
      trick: null,
      lastTrick: null,
      passes: 0,
      lastPass: null,
      acts: [],
      plays: [],
      tricks: 0,
      played: [],
      multiplier: 0,
      deals: 0,
      winner: null,
      winnerSide: null,
      score: 0,
    };
  },

  start(state, context) {
    const players = state.players;

    if (players.length < DDZ_SEATS) return;

    const order = players
      .slice(context.firstPlayerIndex)
      .concat(players.slice(0, context.firstPlayerIndex))
      .slice(0, DDZ_SEATS);

    state.seats = {};
    order.forEach((player, index) => {
      state.seats[player.id] = index;
    });

    state.acts = order.map(() => null);
    state.played = order.map(() => 0);
    state.firstBidder = 0;
    state.deals = 0;

    openDeal(state);
  },

  turnActions(state, playerId, viewer) {
    if (viewer.isSpectator) return [];

    if (state.status !== "playing") return [];

    if (state.turnState.currentPlayerId !== playerId) return [];

    if (state.turnState.phase === "bid") return ["bid"];

    return state.trick ? ["play_cards", "pass"] : ["play_cards"];
  },

  seatIdentity(state, playerId, viewer) {
    if (viewer.isSpectator) return { seat: null, role: "spectator" };

    const seat = state.seats[playerId] ?? null;

    return { seat, role: seat === null ? null : `seat${seat}` };
  },

  /** The landlord is one team, both farmers the other; nothing is decided before the auction. */
  youFields(state, playerId) {
    const seat = state.seats[playerId];

    if (seat === undefined || state.landlord === null) return { team: null };

    return { team: seat === state.landlord ? "landlord" : "farmers" };
  },

  applyAction(state, playerId, intent, now) {
    if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

    if (state.turnState.currentPlayerId !== playerId) return { ok: false, message: "Not your turn" };

    const seat = state.seats[playerId];

    if (seat === undefined) return { ok: false, message: "No seat assigned" };

    if (intent.actionType === "bid") return placeBid(state, playerId, seat, intent.data, now);

    if (state.turnState.phase !== "play") return { ok: false, message: "Bidding is still open" };

    if (intent.actionType === "pass") return passTurn(state, playerId, seat);

    if (intent.actionType === "play_cards" || intent.actionType === "play")
      return playCards(state, playerId, seat, intent.data, now);

    return { ok: false, message: `Unknown action: ${intent.actionType}` };
  },

  onTurnTimeout(state, playerId, now) {
    if (!playerId) return [];

    const seat = state.seats[playerId];

    if (seat === undefined) return [];

    const timeout: GameEffect = { type: "event", event: "turn_timeout", data: { playerId } };

    // Passing the auction is always legal; a leader cannot pass, so the platform
    // plays their cheapest card instead of stalling the table.
    if (state.turnState.phase === "bid") {
      const bid = placeBid(state, playerId, seat, { value: 0 }, now);

      return bid.ok ? [timeout, ...(bid.effects ?? [])] : [timeout];
    }

    if (state.trick) {
      const passed = passTurn(state, playerId, seat);

      return passed.ok ? [timeout, ...(passed.effects ?? [])] : [timeout];
    }

    const forced = ddzForcedPlay(state.hands[seat] ?? [], null);

    if (!forced) return [timeout];

    const played = commitPlay(state, playerId, seat, forced, now);

    return played.ok ? [timeout, ...(played.effects ?? [])] : [timeout];
  },

  /** Hands and unrevealed bottom cards never leave the server. */
  projectState(state, playerId) {
    const seat = state.seats[playerId] ?? null;

    return {
      ...state,
      hands: undefined,
      bottom: state.bottomRevealed ? state.bottom : undefined,
      bottomCount: state.bottom.length,
      hand: seat === null ? [] : [...(state.hands[seat] ?? [])],
      handSeat: seat,
      handCounts: state.hands.map((hand) => hand.length),
    };
  },

  agentFields(projection) {
    return {
      hand: projection.hand,
      handCounts: projection.handCounts,
      handSeat: projection.handSeat,
      bottom: projection.bottom,
      bottomCount: projection.bottomCount,
      landlord: projection.landlord,
      bid: projection.bid,
      bids: projection.bids,
      toAct: projection.toAct,
      trick: projection.trick,
      lastTrick: projection.lastTrick,
      passes: projection.passes,
      acts: projection.acts,
      played: projection.played,
      multiplier: projection.multiplier,
      tricks: projection.tricks,
      winner: projection.winner,
      winnerSide: projection.winnerSide,
    };
  },

  agentDecision: doudizhuAgentDecision,
};

function playerAtSeat(state: DoudizhuGameState, seat: number): string | undefined {
  return Object.keys(state.seats).find((playerId) => state.seats[playerId] === seat);
}

function seatsAt(state: DoudizhuGameState): number {
  return Object.keys(state.seats).length;
}

function nextSeat(state: DoudizhuGameState, seat: number): number {
  return (seat + 1) % Math.max(seatsAt(state), 1);
}

function playerCount(state: DoudizhuGameState): number {
  return Math.max(seatsAt(state), DDZ_SEATS);
}

/** Fresh deck for a new deal; the auction starts again from `firstBidder`. */
function openDeal(state: DoudizhuGameState): void {
  const deal = dealDoudizhu();

  state.hands = deal.hands;
  state.bottom = deal.bottom;
  state.bottomRevealed = false;
  state.landlord = null;
  state.bid = 0;
  state.bidder = null;
  state.bids = deal.hands.map(() => null);
  state.toAct = state.firstBidder;
  state.trick = null;
  state.lastTrick = null;
  state.passes = 0;
  state.lastPass = null;
  state.acts = deal.hands.map(() => null);
  state.plays = [];
  state.tricks = 0;
  state.played = deal.hands.map(() => 0);
  state.multiplier = 0;
  state.winner = null;
  state.winnerSide = null;
  state.score = 0;
  state.deals += 1;
  state.status = "playing";
  state.turnState.phase = "bid";
  state.turnState.currentPlayerId = playerAtSeat(state, state.toAct) ?? null;
  state.turnState.turnNumber = 1;
}

/** Hand the turn to `seat` and restart its clock. */
function handOver(state: DoudizhuGameState, seat: number, now: number): GameEffect[] {
  state.toAct = seat;
  state.turnState.currentPlayerId = playerAtSeat(state, seat) ?? null;
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
        phase: state.turnState.phase,
      },
    },
  ];
}

function placeBid(
  state: DoudizhuGameState,
  playerId: string,
  seat: number,
  data: WireValue,
  now: number,
): GameActionResult {
  if (state.turnState.phase !== "bid") return { ok: false, message: "Bidding is over" };

  const value = isWireObject(data) && isNumber(data.value) ? Math.trunc(data.value) : 0;

  if (value < 0 || value > 3) return { ok: false, message: "Bid 0 to pass, or 1, 2 or 3" };

  if (value > 0 && value <= state.bid)
    return { ok: false, message: `Bid higher than ${state.bid}, or 0 to pass` };

  state.bids = state.bids.map((entry, index) => (index === seat ? value : entry));

  if (value > state.bid) {
    state.bid = value;
    state.bidder = seat;
  }

  const effects: GameEffect[] = [
    { type: "event", event: "doudizhu_bid", data: { playerId, seat, value, bid: state.bid } },
  ];

  if (value === 3 || nextBidder(state.bids, seat, playerCount(state)) === null) {
    if (state.bid > 0 && state.bidder !== null)
      return { ok: true, effects: [...effects, ...becomeLandlord(state, playerId, now)] };

    // Nobody opened: throw the deal in and start again from the next seat.
    state.firstBidder = nextSeat(state, state.firstBidder);
    openDeal(state);

    effects.push({
      type: "event",
      event: "doudizhu_redeal",
      data: { firstBidder: state.firstBidder, deals: state.deals },
    });

    return { ok: true, effects: [...effects, ...handOver(state, state.toAct, now)] };
  }

  const next = nextBidder(state.bids, seat, playerCount(state));

  return { ok: true, effects: [...effects, ...handOver(state, next ?? seat, now)] };
}

/** The highest bidder takes the three bottom cards and leads. */
function becomeLandlord(
  state: DoudizhuGameState,
  playerId: string,
  now: number,
): GameEffect[] {
  const seat = state.bidder ?? 0;

  state.landlord = seat;
  state.bottomRevealed = true;
  state.hands = state.hands.map((hand, index) =>
    index === seat ? sortCards([...hand, ...state.bottom]) : hand,
  );
  state.trick = null;
  state.lastTrick = null;
  state.passes = 0;
  state.lastPass = null;
  state.acts = state.hands.map(() => null);
  state.plays = [];
  state.played = state.hands.map(() => 0);
  state.turnState.phase = "play";

  const effects: GameEffect[] = [
    {
      type: "event",
      event: "doudizhu_landlord",
      data: {
        playerId,
        seat,
        bid: state.bid,
        bottom: [...state.bottom],
        bottomText: cardsText(state.bottom),
      },
    },
  ];

  return [...effects, ...handOver(state, seat, now)];
}

function passTurn(
  state: DoudizhuGameState,
  playerId: string,
  seat: number,
): GameActionResult {
  const beaten = state.trick;

  if (!beaten) return { ok: false, message: "You lead this trick, so you cannot pass" };

  const record: CardActionRecord = { seat, cards: [], combo: null, n: state.plays.length + 1 };

  state.acts = state.acts.map((action, index) => (index === seat ? record : action));
  state.plays = [...state.plays, record].slice(-HISTORY);
  state.lastPass = seat;

  const effects: GameEffect[] = [
    { type: "event", event: "doudizhu_pass", data: { playerId, seat } },
  ];

  const passes = state.passes + 1;

  if (passes < seatsAt(state) - 1) {
    state.passes = passes;

    return { ok: true, effects: [...effects, ...handOver(state, nextSeat(state, seat), 0)] };
  }

  state.trick = null;
  state.lastTrick = beaten;
  state.passes = 0;
  state.tricks++;

  effects.push({
    type: "event",
    event: "doudizhu_trick_won",
    data: { seat: beaten.seat, playerId: playerAtSeat(state, beaten.seat) ?? null },
  });

  return { ok: true, effects: [...effects, ...handOver(state, beaten.seat, 0)] };
}

function playCards(
  state: DoudizhuGameState,
  playerId: string,
  seat: number,
  data: WireValue,
  now: number,
): GameActionResult {
  const requested = requestedCards(data);

  if ("message" in requested) return { ok: false, message: requested.message };

  const resolved = pickCards(state.hands[seat] ?? [], requested.text);

  if (isString(resolved)) return { ok: false, message: resolved };

  return commitPlay(state, playerId, seat, resolved, now);
}

/** Shared by an intent and the timeout fallback, so both obey one rule set. */
function commitPlay(
  state: DoudizhuGameState,
  playerId: string,
  seat: number,
  cards: string[],
  now: number,
): GameActionResult {
  const combo = classify(cards, DOUDIZHU_COMBOS);

  if (isString(combo)) return { ok: false, message: combo };

  const beaten = state.trick?.combo;

  if (beaten && !beats(combo, beaten))
    return {
      ok: false,
      message: `That does not beat the ${beaten.size}-card ${beaten.kind} on the table`,
    };

  return { ok: true, effects: commit(state, playerId, seat, cards, combo, now) };
}

function commit(
  state: DoudizhuGameState,
  playerId: string,
  seat: number,
  cards: string[],
  combo: CardCombo,
  now: number,
): GameEffect[] {
  const left = (state.hands[seat] ?? []).filter((card) => !cards.includes(card));
  const leading = !state.trick;
  const record: CardActionRecord = { seat, cards: [...cards], combo, n: state.plays.length + 1 };
  const doubling = combo.kind === "bomb" || combo.kind === "rocket";

  state.hands = state.hands.map((hand, index) => (index === seat ? left : hand));
  state.trick = record;
  state.passes = 0;
  state.lastPass = null;
  state.acts = state.acts.map((action, index) =>
    index === seat ? record : leading ? null : action,
  );
  state.plays = [...state.plays, record].slice(-HISTORY);
  state.played = state.played.map((count, index) => (index === seat ? count + cards.length : count));

  if (doubling) state.multiplier += 1;

  const effects: GameEffect[] = [
    {
      type: "event",
      event: "doudizhu_play",
      data: { playerId, seat, cards: [...cards], cardsText: cardsText(cards), combo: { ...combo } },
    },
  ];

  if (left.length > 0) return [...effects, ...handOver(state, nextSeat(state, seat), now)];

  return [...effects, ...finish(state, playerId, seat)];
}

function finish(state: DoudizhuGameState, playerId: string, seat: number): GameEffect[] {
  const landlord = state.landlord ?? 0;
  const landlordWon = seat === landlord;
  const spring = landlordWon && isSpring(state.played, landlord);

  state.winner = playerId;
  state.winnerSide = landlordWon ? "landlord" : "farmers";
  state.score = doudizhuScore({
    bid: state.bid,
    multiplier: state.multiplier,
    landlordWon,
    spring,
  });
  state.status = "ended";
  state.turnState.phase = "ended";
  state.turnState.currentPlayerId = null;

  return [
    { type: "stop_timers" },
    {
      type: "event",
      event: "game_ended",
      data: {
        reason: "hand_emptied",
        winner: playerId,
        winnerSide: state.winnerSide,
        spring,
        score: state.score,
        multiplier: state.multiplier,
      },
    },
    { type: "match_ended", reason: "hand_emptied" },
  ];
}

/** Accepts `{ cards: ["S3", "H3"] }` or `{ cards: "S3 H3" }`. */
function requestedCards(data: WireValue): { text: string } | { message: string } {
  const message = "Send { cards: [...] } with the cards you want to play";

  if (!isWireObject(data)) return { message };

  const cards = data.cards;

  if (isString(cards)) return { text: cards };

  if (!Array.isArray(cards)) return { message };

  const tokens: string[] = [];

  for (const entry of cards) {
    if (!isString(entry)) return { message: "Every entry in cards must be a card or a rank" };

    tokens.push(entry);
  }

  return { text: tokens.join(" ") };
}
