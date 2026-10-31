import { ROOM_LIFETIME_MS, isString, isWireObject } from "@llmgames/game-catalog";

import { randomId } from "../../lib/csprng";
import type { GameRoomConfig, PokerGameState } from "../../durable-objects/types";
import type { GameActionResult, GameIntent, GamePlugin, GameSeatIdentity } from "../contract";
import { PokerTable } from "./table";
import { pokerAgentDecision } from "./agent";

/**
 * Poker as a game plugin (M3.9).
 *
 * The last migration, and the only one that needed a new hook: the table holds
 * a five-second result window after every hand, during which nobody may act.
 * That window is not something players can see in the rules — it answers "when
 * may the platform accept an intent again?" — so it is published as
 * {@link decisionReadyAt} instead of being hidden in the room.
 *
 * Everything else fits the existing contract: the actor is named in
 * `actionPlayerId` (so `mayActNow` follows it), `hand_over` lets any seated
 * player deal the next hand, and the projection masks every other player's hole
 * cards until showdown.
 */

const DEFAULT_MATCH_MS = 45 * 60 * 1000;

const DEFAULT_TURN_MS = 60 * 1000;

const STARTING_STACK = 1000;

/** How long the finished hand stays on screen before the next one may start. */
export const HAND_RESULT_HOLD_MS = 5000;

const BETTING_PHASES = ["preflop", "flop", "turn", "river"] as const;

function bettingPhase(phase: string): boolean {
  return BETTING_PHASES.some((known) => known === phase);
}

/** One recipient-safe view. The rewatch asks for the host's, then reveals holes. */
function projectPoker(state: PokerGameState, playerId: string) {
  const table = new PokerTable(state);

  const seats = state.seats.map((seat) => {
    const isSelf = seat.playerId === playerId;

    const showCards =
      isSelf ||
      Boolean(
        state.lastHandResult?.showdown &&
        state.lastHandResult.hands?.some((hand) => hand.playerId === seat.playerId),
      );

    return {
      playerId: seat.playerId,
      name: seat.name,
      stack: seat.stack,
      streetBet: seat.streetBet,
      handContributed: seat.handContributed,
      folded: seat.folded,
      allIn: seat.allIn,
      hole: showCards ? seat.hole : seat.hole.map(() => ({ rank: "?", suit: "?", hidden: true })),
      holeCount: seat.hole.length,
    };
  });

  const toCall = table.toCallFor(playerId, state);
  const blindSeats = table.blindSeatIndexes(state);

  return {
    ...state,
    deck: undefined,
    deckRemaining: state.deck.length,
    seats,
    toCall,
    canCheck: toCall === 0,
    randomness: {
      algorithm: "crypto.getRandomValues Fisher-Yates",
      deckCommitHash: state.deckCommitHash,
    },
    blinds: { sb: state.smallBlind, bb: state.bigBlind },
    buttonPlayerId: state.seats[state.buttonIndex]?.playerId ?? null,
    smallBlindPlayerId:
      blindSeats.smallBlindIndex == null
        ? null
        : (state.seats[blindSeats.smallBlindIndex]?.playerId ?? null),
    bigBlindPlayerId:
      blindSeats.bigBlindIndex == null
        ? null
        : (state.seats[blindSeats.bigBlindIndex]?.playerId ?? null),
  };
}

export const pokerPlugin: GamePlugin<PokerGameState, "poker"> = {
  id: "poker",
  minPlayersToStart: 2,
  initialTurnPhase: "preflop",

  createInitialState(config: GameRoomConfig, roomCode: string, now: number) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;

    return {
      id: randomId(),
      roomCode,
      type: "poker",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: Math.min(Math.max(config.maxPlayers ?? 6, 2), 6),
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
      seats: [],
      buttonIndex: 0,
      smallBlind: 5,
      bigBlind: 10,
      pot: 0,
      community: [],
      currentBet: 0,
      minRaise: 10,
      deck: [],
      deckCommitHash: null,
      handNumber: 0,
      actionPlayerId: null,
      lastAggressorId: null,
      actorsThisStreet: [],
      lastHandResult: null,
      winner: null,
      actionLog: [],
      startingStack: STARTING_STACK,
    };
  },

  start(state) {
    const stack = state.startingStack;

    state.seats = state.players.slice(0, state.maxPlayers).map((player) => ({
      playerId: player.id,
      name: player.name,
      stack,
      hole: [],
      streetBet: 0,
      handContributed: 0,
      folded: false,
      allIn: false,
      sittingOut: false,
    }));
    state.buttonIndex = 0;
    state.winner = null;
    state.lastHandResult = null;
    state.actionLog = [];
    state.handNumber = 0;

    // Deal synchronously so start_game persists a real hand; the deck commit
    // hash fills in asynchronously, exactly as it always has.
    new PokerTable(state).startNewHand();
  },

  /**
   * Two shapes of "may act": the named actor during a street, and any seated
   * player while the finished hand is on screen waiting to be advanced.
   */
  mayActNow(state, playerId) {
    if (state.status !== "playing") return false;

    const phase = state.turnState.phase;

    if (phase === "hand_over") return state.seats.some((seat) => seat.playerId === playerId);

    if (phase === "ended" || phase === "waiting" || phase === "showdown") return false;

    return state.actionPlayerId === playerId;
  },

  turnActions(state, playerId, viewer) {
    if (viewer.isSpectator || state.status !== "playing") return [];

    const phase = state.turnState.phase;

    if (phase === "hand_over")
      return state.seats.some((seat) => seat.playerId === playerId) ? ["next_hand"] : [];

    if (state.actionPlayerId !== playerId || !bettingPhase(phase)) return [];

    const table = new PokerTable(state);
    const seat = table.seat(playerId);

    if (!seat || seat.folded || seat.allIn) return [];

    const toCall = table.toCallAmount(seat);
    const raiseReopened = !state.actorsThisStreet.includes(playerId);
    const actions = ["fold"];

    if (toCall === 0) {
      actions.push("check");

      if (seat.stack > 0) actions.push("bet", "all_in");

      return actions;
    }

    if (seat.stack > 0) {
      actions.push("call");

      if (seat.stack > toCall && raiseReopened) actions.push("raise", "all_in");
      else if (seat.stack <= toCall) actions.push("all_in");
    }

    return actions;
  },

  /** Poker seats are numbers with a stack, not roles. */
  seatIdentity(state, playerId, viewer): GameSeatIdentity {
    if (viewer.isSpectator) return { role: "spectator" };

    const index = state.seats.findIndex((seat) => seat.playerId === playerId);

    return { seat: index === -1 ? null : index + 1, role: "player" };
  },

  /** The browser `you` block: stack, hole cards, call amount and the button. */
  youFields(state, playerId, viewer) {
    if (viewer.isSpectator) return { stack: null, hole: [], toCall: 0 };

    const table = new PokerTable(state);

    return {
      stack: table.seat(playerId)?.stack ?? null,
      toCall: table.toCallFor(playerId, state),
      hole: (table.seat(playerId)?.hole ?? []).map((card) => ({
        rank: card.rank,
        suit: card.suit,
      })),
      isButton: state.seats[state.buttonIndex]?.playerId === playerId,
    };
  },

  applyAction(state, playerId, intent: GameIntent, _now): GameActionResult {
    const table = new PokerTable(state);

    const result: string | void = (() => {
      switch (intent.actionType) {
        case "fold":
          return table.actFold(playerId);
        case "check":
          return table.actCheck(playerId);
        case "call":
          return table.actCall(playerId);
        case "bet":
          return table.actBet(playerId, intent.data, false);
        case "raise":
          return table.actBet(playerId, intent.data, true);
        case "all_in":
        case "allin":
          return table.actAllIn(playerId);
        case "next_hand":
          return table.actNextHand(playerId);
        default:
          return `Unknown action: ${intent.actionType}`;
      }
    })();

    if (isString(result)) return { ok: false, message: result };

    return { ok: true, effects: table.takeEffects() };
  },

  /**
   * A missed decision checks when it can and folds otherwise — the fallback
   * players have always had, so one slow seat cannot stall the table.
   */
  onTurnTimeout(state, playerId) {
    const actorId = state.actionPlayerId || playerId;

    if (!actorId) return [];

    const table = new PokerTable(state);
    const seat = table.seat(actorId);

    if (!seat) return [];

    const result = table.toCallAmount(seat) === 0 ? table.actCheck(actorId) : table.actFold(actorId);

    return isString(result) ? [] : table.takeEffects();
  },

  /** Nobody may act while the finished hand is still on screen. */
  decisionReadyAt(state) {
    if (state.turnState.phase !== "hand_over") return 0;

    return (state.lastHandResult?.finishedAt ?? 0) + HAND_RESULT_HOLD_MS;
  },

  projectState(state, playerId) {
    return projectPoker(state, playerId);
  },

  /** The rewatch reveals every hole card; undealt deck cards stay server-only. */
  rewatchView(state) {
    const view = projectPoker(state, state.hostId);

    const seats = view.seats.map((seat) => {
      const raw = state.seats.find((candidate) => candidate.playerId === seat.playerId);

      return raw
        ? { ...seat, hole: raw.hole.map((card) => ({ ...card })), holeCount: raw.hole.length }
        : seat;
    });

    return { ...view, seats, deck: undefined, deckRemaining: undefined };
  },

  /** The decision state agents already read: seats, pot and this hand's log. */
  agentFields(projection) {
    const handNumber = projection.handNumber;

    const actionLog = Array.isArray(projection.actionLog)
      ? projection.actionLog.filter((entry) => isWireObject(entry) && entry.handNumber === handNumber)
      : [];

    return {
      seats: projection.seats,
      community: projection.community,
      pot: projection.pot,
      currentBet: projection.currentBet,
      minRaise: projection.minRaise,
      handNumber,
      actionPlayerId: projection.actionPlayerId,
      toCall: projection.toCall,
      canCheck: projection.canCheck,
      blinds: projection.blinds,
      buttonPlayerId: projection.buttonPlayerId,
      smallBlindPlayerId: projection.smallBlindPlayerId,
      bigBlindPlayerId: projection.bigBlindPlayerId,
      actionLog,
      lastHandResult: projection.lastHandResult,
    };
  },

  agentDecision: pokerAgentDecision,
};
