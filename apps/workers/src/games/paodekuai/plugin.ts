import {
  ROOM_LIFETIME_MS,
  isString,
  isWireObject,
  type WireValue,
} from "@llmgames/game-catalog";

import { randomId } from "../../lib/csprng";
import type {
  CardActionRecord,
  CardCombo,
  PaodekuaiGameState,
} from "../../durable-objects/types";
import type { GameActionResult, GameEffect, GamePlugin } from "../contract";

import { PAODEKUAI_COMBOS, beats, classify } from "../cards/combo";
import { cardsText, pickCards } from "../cards/deck";
import { paodekuaiAgentDecision } from "./agent";
import { PDK_SEATS_MAX, PDK_SEATS_MIN, dealPaodekuai, pdkForcedPlay, trickIsOver } from "./rules";

const DEFAULT_MATCH_MS = ROOM_LIFETIME_MS;

const DEFAULT_TURN_MS = 60 * 1000;

/** How many recent actions the projection keeps for the trail. */
const HISTORY = 12;

/**
 * 跑得快 (Run Fast), 2-3 seats. Intents: `play_cards { cards }` and `pass`.
 *
 * Only the viewer's own hand leaves the server; every other seat is a count.
 * The trick, the passes and the played cards are public, because they are the
 * whole of what a player reasons about.
 *
 * Two rules need the hand rather than just the cards, so they live here and not
 * in the shape classifier: a bare triple may only empty a hand, and the first
 * play must contain the spade three.
 */
export const paodekuaiPlugin: GamePlugin<PaodekuaiGameState, "paodekuai"> = {
  id: "paodekuai",
  minPlayersToStart: PDK_SEATS_MIN,
  initialTurnPhase: "play",

  createInitialState(config, roomCode, now) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;
    const requested = Math.trunc(config.maxPlayers ?? PDK_SEATS_MAX);
    const maxPlayers = Math.min(Math.max(requested, PDK_SEATS_MIN), PDK_SEATS_MAX);

    return {
      id: randomId(),
      roomCode,
      type: "paodekuai",
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
      hands: [],
      unused: [],
      first: 0,
      mustLead: null,
      toPlay: 0,
      trick: null,
      lastTrick: null,
      passes: 0,
      lastPass: null,
      acts: [],
      plays: [],
      tricks: 0,
      played: [],
      winner: null,
    };
  },

  start(state, context) {
    const players = state.players;

    if (players.length < PDK_SEATS_MIN) return;

    const order = players
      .slice(context.firstPlayerIndex)
      .concat(players.slice(0, context.firstPlayerIndex));

    state.seats = {};
    order.forEach((player, index) => {
      state.seats[player.id] = index;
    });

    const deal = dealPaodekuai(order.length);

    state.hands = deal.hands;
    state.unused = deal.unused;
    state.first = deal.first;
    state.mustLead = deal.mustLead;
    state.toPlay = deal.first;
    state.trick = null;
    state.lastTrick = null;
    state.passes = 0;
    state.lastPass = null;
    state.acts = order.map(() => null);
    state.plays = [];
    state.tricks = 0;
    state.played = order.map(() => 0);
    state.winner = null;
    state.turnState.currentPlayerId = playerAtSeat(state, deal.first) ?? null;
    state.turnState.phase = "play";
    state.turnState.turnNumber = 1;
  },

  turnActions(state, playerId, viewer) {
    if (viewer.isSpectator) return [];

    if (state.status !== "playing") return [];

    if (state.turnState.currentPlayerId !== playerId) return [];

    // A leader may not pass, so the offer depends on whether a trick is running.
    return state.trick ? ["play_cards", "pass"] : ["play_cards"];
  },

  seatIdentity(state, playerId, viewer) {
    if (viewer.isSpectator) return { seat: null, role: "spectator" };

    const seat = state.seats[playerId] ?? null;

    return { seat, role: seat === null ? null : `seat${seat}` };
  },

  applyAction(state, playerId, intent, now) {
    if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

    if (state.turnState.currentPlayerId !== playerId) return { ok: false, message: "Not your turn" };

    const seat = state.seats[playerId];

    if (seat === undefined) return { ok: false, message: "No seat assigned" };

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

    // A follower simply passes. A leader cannot pass, so the platform plays the
    // cheapest legal card and says so: a lost turn should not stall the table.
    if (state.trick) {
      const passed = passTurn(state, playerId, seat);

      return passed.ok ? [timeout, ...(passed.effects ?? [])] : [timeout];
    }

    const forced = pdkForcedPlay(state.hands[seat] ?? [], null, state.mustLead);

    if (!forced) return [timeout];

    const played = commitPlay(state, playerId, seat, forced, now);

    return played.ok ? [timeout, ...(played.effects ?? [])] : [timeout];
  },

  /** Only the viewer's hand and the public action history leave the server. */
  projectState(state, playerId) {
    const seat = state.seats[playerId] ?? null;

    return {
      ...state,
      hands: undefined,
      unused: undefined,
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
      played: projection.played,
      first: projection.first,
      mustLead: projection.mustLead,
      toPlay: projection.toPlay,
      trick: projection.trick,
      lastTrick: projection.lastTrick,
      passes: projection.passes,
      lastPass: projection.lastPass,
      acts: projection.acts,
      tricks: projection.tricks,
      winner: projection.winner,
    };
  },

  agentDecision: paodekuaiAgentDecision,
};

function playerAtSeat(state: PaodekuaiGameState, seat: number): string | undefined {
  return Object.keys(state.seats).find((playerId) => state.seats[playerId] === seat);
}

function seatsAt(state: PaodekuaiGameState): number {
  return Object.keys(state.seats).length;
}

function nextSeat(state: PaodekuaiGameState, seat: number): number {
  return (seat + 1) % Math.max(seatsAt(state), 1);
}

/** Hand the turn to `seat` and restart its clock. */
function handOver(state: PaodekuaiGameState, seat: number, now: number): GameEffect[] {
  state.toPlay = seat;
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
        phase: "play",
      },
    },
  ];
}

function passTurn(
  state: PaodekuaiGameState,
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
    { type: "event", event: "paodekuai_pass", data: { playerId, seat } },
  ];

  const passes = state.passes + 1;

  if (!trickIsOver(seatsAt(state), passes)) {
    state.passes = passes;

    return { ok: true, effects: [...effects, ...handOver(state, nextSeat(state, seat), 0)] };
  }

  // Everyone passed since the last play: that seat leads again, with anything.
  state.trick = null;
  state.lastTrick = beaten;
  state.passes = 0;
  state.tricks++;

  effects.push({
    type: "event",
    event: "paodekuai_trick_won",
    data: { seat: beaten.seat, playerId: playerAtSeat(state, beaten.seat) ?? null },
  });

  return { ok: true, effects: [...effects, ...handOver(state, beaten.seat, 0)] };
}

function playCards(
  state: PaodekuaiGameState,
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
  state: PaodekuaiGameState,
  playerId: string,
  seat: number,
  cards: string[],
  now: number,
): GameActionResult {
  const hand = state.hands[seat] ?? [];

  if (state.mustLead && !cards.includes(state.mustLead))
    return { ok: false, message: "The first play must include the spade three" };

  const combo = classify(cards, PAODEKUAI_COMBOS);

  if (isString(combo)) return { ok: false, message: combo };

  if (combo.kind === "triple" && hand.length !== cards.length)
    return { ok: false, message: "A bare triple is only legal as your last cards" };

  const beaten = state.trick?.combo;

  if (beaten && !beats(combo, beaten))
    return {
      ok: false,
      message: `That does not beat the ${beaten.size}-card ${beaten.kind} on the table`,
    };

  return { ok: true, effects: commit(state, playerId, seat, cards, combo, now) };
}

function commit(
  state: PaodekuaiGameState,
  playerId: string,
  seat: number,
  cards: string[],
  combo: CardCombo,
  now: number,
): GameEffect[] {
  const left = (state.hands[seat] ?? []).filter((card) => !cards.includes(card));
  const leading = !state.trick;
  const record: CardActionRecord = { seat, cards: [...cards], combo, n: state.plays.length + 1 };

  state.hands = state.hands.map((hand, index) => (index === seat ? left : hand));
  state.mustLead = null;
  state.trick = record;
  state.passes = 0;
  state.lastPass = null;
  state.acts = state.acts.map((action, index) =>
    index === seat ? record : leading ? null : action,
  );
  state.plays = [...state.plays, record].slice(-HISTORY);
  state.played = state.played.map((count, index) => (index === seat ? count + cards.length : count));

  const effects: GameEffect[] = [
    {
      type: "event",
      event: "paodekuai_play",
      data: { playerId, seat, cards: [...cards], cardsText: cardsText(cards), combo: { ...combo } },
    },
  ];

  if (left.length > 0) return [...effects, ...handOver(state, nextSeat(state, seat), now)];

  state.winner = playerId;
  state.status = "ended";
  state.turnState.phase = "ended";
  state.turnState.currentPlayerId = null;

  const spring = state.played.some((count, index) => index !== seat && count === 0);

  effects.push(
    { type: "stop_timers" },
    {
      type: "event",
      event: "game_ended",
      data: { reason: "hand_emptied", winner: playerId, spring },
    },
    { type: "match_ended", reason: "hand_emptied" },
  );

  return effects;
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
