import { isWireObject, type WireValue } from "@llmgames/game-catalog";
import { z } from "zod";
import type { RoomRuntime } from "./runtime";
import { isNumber, isString } from "@llmgames/game-catalog";

import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";
import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type {
  CardRank,
  CardSuit,
  Player,
  PokerCardPublic,
  PokerGameState,
  PokerSeat,
} from "./types";
import { evaluateHoldem } from "../lib/pokerHands";
import { randomId, sha256Hex, shuffleInPlace } from "../lib/csprng";

const RANKS: CardRank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const SUITS: CardSuit[] = ["S", "H", "D", "C"];

const HAND_RESULT_HOLD_MS = 5000;

function freshDeck(): PokerCardPublic[] {
  const d: PokerCardPublic[] = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) d.push({ rank, suit });
  }

  return d;
}

function fmtCard(c: PokerCardPublic): string {
  return `${c.rank}${c.suit}`;
}

interface BlindIndices {
  smallBlindIndex: number | null;
  bigBlindIndex: number | null;
}

interface SidePotSettlement {
  winnerIds: string[];
  payouts: Array<{ playerId: string; amount: number }>;
  sidePots: Array<{
    amount: number;
    eligiblePlayerIds: string[];
    winnerIds: string[];
    refunded?: boolean;
  }>;
}

export type PokerWagerInput = { amount?: number; raiseTo?: number };

/** Parse the documented bet/raise payload without treating raiseTo as amount. */
export function parsePokerWagerInput(data: WireValue, isRaise: boolean): PokerWagerInput | string {
  const raw = isWireObject(data) ? data : null;
  const amount = raw ? raw.amount : undefined;
  const raiseTo = raw ? raw.raiseTo : undefined;
  const hasAmount = amount !== undefined;
  const hasRaiseTo = raiseTo !== undefined;

  if (isRaise && hasAmount && hasRaiseTo) {
    return "Provide either amount or raiseTo, not both";
  }

  if (isRaise && !hasAmount && !hasRaiseTo) {
    return "amount or raiseTo required";
  }

  if (!isRaise && !hasAmount) return "amount required for bet";

  if (!isRaise && hasRaiseTo) return "raiseTo is only valid for raise";

  const value = hasRaiseTo ? raiseTo : amount;

  if (!isNumber(value) || !Number.isSafeInteger(value) || value <= 0) {
    return `${hasRaiseTo ? "raiseTo" : "amount"} must be a positive whole-chip amount`;
  }

  return hasRaiseTo ? { raiseTo: value } : { amount: value };
}

/**
 * 2–6 player Texas Hold'em — server-authoritative, CSPRNG deck.
 *
 * Heads-up keeps the standard button/SB rule. At 3+ seats, blinds and action
 * move clockwise from the button. Unequal all-ins settle through side pots.
 * Actions: fold | check | call | bet | raise | all_in | next_hand
 */
export class PokerRoom extends BaseGameRoom<PokerGameState> {
  protected readonly roomLabel = "PokerRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected get minPlayersToStart(): number {
    return 2;
  }

  protected get initialTurnPhase(): string {
    return "preflop";
  }

  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    if (!this.gameState) return;
    const actorId = this.gameState.actionPlayerId || playerId;

    if (!actorId) return;
    const player = this.makeAgentPlayer(actorId);
    const seat = this.seat(actorId);

    if (!seat) return;

    if (this.toCallAmount(seat) === 0) {
      this.actCheck(player);
    } else {
      this.actFold(player);
    }

    await this.saveState();
    this.broadcastState();
  }

  protected createDefaultState(
    config: {
      hostId: string;
      hostName: string;
      maxPlayers?: number;
      gameTotalTime?: number;
      turnTime?: number;
      roomCode?: string;
    },
    roomCode: string,
  ): PokerGameState {
    const startingStack = 1000;
    const createdAt = Date.now();

    return {
      id: randomId(),
      roomCode,
      type: "poker",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: Math.min(Math.max(config.maxPlayers ?? 6, 2), 6),
      timerConfig: {
        gameTotalTime: config.gameTotalTime ?? 45 * 60 * 1000,
        turnTime: config.turnTime ?? 60 * 1000,
      },
      gameTimeRemaining: config.gameTotalTime ?? 45 * 60 * 1000,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: config.turnTime ?? 60 * 1000,
      },
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + ROOM_LIFETIME_MS,
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
      startingStack,
    };
  }

  protected onStartGame(): void {
    if (!this.gameState) return;
    const stack = this.gameState.startingStack;
    this.gameState.seats = this.gameState.players.slice(0, this.gameState.maxPlayers).map((p) => ({
      playerId: p.id,
      name: p.name,
      stack,
      hole: [],
      streetBet: 0,
      handContributed: 0,
      folded: false,
      allIn: false,
      sittingOut: false,
    }));
    this.gameState.buttonIndex = 0;
    this.gameState.winner = null;
    this.gameState.lastHandResult = null;
    this.gameState.actionLog = [];
    this.gameState.handNumber = 0;
    // Sync deal so start_game persists a real hand (hash fills in async)
    this.startNewHand();
  }

  protected isYourTurn(playerId: string): boolean {
    if (!this.gameState || this.gameState.status !== "playing") return false;
    const phase = this.gameState.turnState.phase;

    if (phase === "hand_over") {
      // Either player can advance
      return this.gameState.seats.some((s) => s.playerId === playerId);
    }

    if (phase === "ended" || phase === "waiting" || phase === "showdown") {
      return false;
    }

    return this.gameState.actionPlayerId === playerId;
  }

  protected agentDecisionReadyAt(): number {
    if (this.gameState?.turnState.phase !== "hand_over") return 0;

    return (this.gameState.lastHandResult?.finishedAt ?? 0) + HAND_RESULT_HOLD_MS;
  }

  protected projectStateFor(playerId: string, state: PokerGameState) {
    const seats = state.seats.map((s) => {
      const isSelf = s.playerId === playerId;

      const showCards =
        isSelf ||
        Boolean(
          state.lastHandResult?.showdown &&
          state.lastHandResult.hands?.some((h) => h.playerId === s.playerId),
        );

      return {
        playerId: s.playerId,
        name: s.name,
        stack: s.stack,
        streetBet: s.streetBet,
        handContributed: s.handContributed,
        folded: s.folded,
        allIn: s.allIn,
        hole: showCards ? s.hole : s.hole.map(() => ({ rank: "?", suit: "?", hidden: true })),
        holeCount: s.hole.length,
      };
    });

    const toCall = this.toCallFor(playerId, state);
    const blindSeats = this.blindSeatIndexes(state);

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

  /** Reveal every dealt hole card; undealt deck cards remain server-only. */
  protected buildRewatchView() {
    if (!this.gameState) return null;

    const view = this.projectStateFor(this.gameState.hostId, this.gameState);

    const seats = Array.isArray(view.seats)
      ? view.seats.map((entry) => {
          const seat = entry;

          const raw = this.gameState?.seats.find(
            (candidate) => candidate.playerId === seat.playerId,
          );

          return raw
            ? { ...seat, hole: raw.hole.map((card) => ({ ...card })), holeCount: raw.hole.length }
            : seat;
        })
      : [];

    return {
      ...view,
      seats,
      deck: undefined,
      deckRemaining: undefined,
    };
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    if (this.isSpectator(playerId)) return actions;

    if (this.gameState.status !== "playing") return actions;

    const phase = this.gameState.turnState.phase;

    if (phase === "hand_over") {
      // Only seated players can advance the table
      if (this.gameState.seats.some((s) => s.playerId === playerId)) {
        actions.push("next_hand");
      }

      return actions;
    }

    if (this.gameState.actionPlayerId !== playerId) return actions;

    if (phase === "preflop" || phase === "flop" || phase === "turn" || phase === "river") {
      const seat = this.seat(playerId);

      if (!seat || seat.folded || seat.allIn) return actions;

      const toCall = this.toCallAmount(seat);
      const raiseReopened = !this.gameState.actorsThisStreet.includes(playerId);
      actions.push("fold");

      if (toCall === 0) {
        actions.push("check");

        if (seat.stack > 0) actions.push("bet", "all_in");
      } else {
        if (seat.stack > 0) {
          actions.push("call");

          if (seat.stack > toCall && raiseReopened) {
            actions.push("raise", "all_in");
          } else if (seat.stack <= toCall) {
            actions.push("all_in"); // short all-in call
          }
        }
      }
    }

    return actions;
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (base.isSpectator) {
      return { ...base, role: "spectator", stack: null, hole: [], toCall: 0 };
    }

    const seat = this.gameState?.seats.find((s) => s.playerId === playerId);
    const toCall = this.gameState ? this.toCallFor(playerId, this.gameState) : 0;

    return {
      ...base,
      stack: seat?.stack ?? null,
      toCall,
      hole: seat?.hole ?? [],
      role: "player",
      isButton: this.gameState
        ? this.gameState.seats[this.gameState.buttonIndex]?.playerId === playerId
        : false,
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";
    const t = payload.actionType;

    switch (t) {
      case "fold":
        return this.actFold(player);
      case "check":
        return this.actCheck(player);
      case "call":
        return this.actCall(player);
      case "bet":
        return this.actBet(player, payload.data, false);
      case "raise":
        return this.actBet(player, payload.data, true);
      case "all_in":
      case "allin":
        return this.actAllIn(player);
      case "next_hand":
        return this.actNextHand(player);
      default:
        return `Unknown action: ${t}`;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  private seat(playerId: string): PokerSeat | undefined {
    return this.gameState?.seats.find((s) => s.playerId === playerId);
  }

  private nextSeatIndex(
    fromIndex: number,
    predicate: (seat: PokerSeat) => boolean,
    state: PokerGameState = this.gameState!,
  ): number | null {
    const count = state.seats.length;

    if (count === 0) return null;

    for (let offset = 1; offset <= count; offset++) {
      const index = (fromIndex + offset + count) % count;
      const seat = state.seats[index];

      if (seat && predicate(seat)) return index;
    }

    return null;
  }

  private blindSeatIndexes(state: PokerGameState): BlindIndices {
    const isLive = (seat: PokerSeat) => !seat.sittingOut && seat.stack >= 0;
    const liveCount = state.seats.filter(isLive).length;

    if (liveCount < 2) {
      return { smallBlindIndex: null, bigBlindIndex: null };
    }

    const smallBlindIndex =
      liveCount === 2 ? state.buttonIndex : this.nextSeatIndex(state.buttonIndex, isLive, state);

    const bigBlindIndex =
      smallBlindIndex == null ? null : this.nextSeatIndex(smallBlindIndex, isLive, state);

    return { smallBlindIndex, bigBlindIndex };
  }

  private nextActionSeat(afterPlayerId: string): PokerSeat | undefined {
    if (!this.gameState) return undefined;

    const fromIndex = this.gameState.seats.findIndex((seat) => seat.playerId === afterPlayerId);

    const nextIndex = this.nextSeatIndex(fromIndex, (seat) => this.needsToAct(seat));

    return nextIndex == null ? undefined : this.gameState.seats[nextIndex];
  }

  private toCallAmount(seat: PokerSeat): number {
    if (!this.gameState) return 0;

    return Math.max(0, this.gameState.currentBet - seat.streetBet);
  }

  private toCallFor(playerId: string, state: PokerGameState): number {
    const seat = state.seats.find((s) => s.playerId === playerId);

    if (!seat) return 0;

    return Math.max(0, state.currentBet - seat.streetBet);
  }

  private putInPot(seat: PokerSeat, amount: number): number {
    if (!this.gameState) return 0;
    const pay = Math.min(amount, seat.stack);
    seat.stack -= pay;
    seat.streetBet += pay;
    seat.handContributed += pay;
    this.gameState.pot += pay;

    if (seat.stack === 0) seat.allIn = true;

    return pay;
  }

  private shuffleDeck(): void {
    if (!this.gameState) return;
    const deck = freshDeck();
    shuffleInPlace(deck);
    this.gameState.deck = deck;
    this.gameState.deckCommitHash = null;
    void sha256Hex(deck.map(fmtCard).join(",")).then((h) => {
      if (this.gameState) this.gameState.deckCommitHash = h;
    });
  }

  private draw(): PokerCardPublic {
    if (!this.gameState || this.gameState.deck.length === 0) {
      throw new Error("Deck empty");
    }

    return this.gameState.deck.pop()!;
  }

  protected startNewHand(): void {
    if (!this.gameState) return;

    for (const s of this.gameState.seats) {
      s.sittingOut = s.stack <= 0;
    }

    const live = this.gameState.seats.filter((s) => !s.sittingOut);

    if (live.length < 2) {
      const winner = live[0]?.playerId ?? this.gameState.seats[0]?.playerId ?? null;
      this.gameState.winner = winner;
      this.gameState.status = "ended";
      this.gameState.turnState.phase = "ended";
      this.gameState.actionPlayerId = null;
      this.gameState.turnState.currentPlayerId = null;
      this.stopTimers();
      this.recordEvent("game_ended", { reason: "stack_out", winner });
      void this.saveState().then(() => {
        this.broadcastProjected("game_ended", { reason: "stack_out" });
      });

      return;
    }

    if (this.gameState.handNumber > 0) {
      const nextButtonIndex = this.nextSeatIndex(
        this.gameState.buttonIndex,
        (seat) => !seat.sittingOut,
      );

      if (nextButtonIndex != null) this.gameState.buttonIndex = nextButtonIndex;
    }

    this.gameState.handNumber++;
    this.gameState.pot = 0;
    this.gameState.community = [];
    this.gameState.currentBet = 0;
    this.gameState.minRaise = this.gameState.bigBlind;
    this.gameState.lastAggressorId = null;
    this.gameState.actorsThisStreet = [];
    this.gameState.lastHandResult = null;

    for (const s of this.gameState.seats) {
      s.hole = [];
      s.streetBet = 0;
      s.handContributed = 0;
      s.folded = s.sittingOut;
      s.allIn = false;
    }

    this.shuffleDeck();

    const btn = this.gameState.seats[this.gameState.buttonIndex]!;
    const { smallBlindIndex, bigBlindIndex } = this.blindSeatIndexes(this.gameState);

    if (smallBlindIndex == null || bigBlindIndex == null) return;
    const sbSeat = this.gameState.seats[smallBlindIndex]!;
    const bbSeat = this.gameState.seats[bigBlindIndex]!;

    this.putInPot(sbSeat, Math.min(this.gameState.smallBlind, sbSeat.stack));
    this.putInPot(bbSeat, Math.min(this.gameState.bigBlind, bbSeat.stack));
    this.gameState.currentBet = Math.max(sbSeat.streetBet, bbSeat.streetBet);
    this.gameState.minRaise = this.gameState.bigBlind;

    const firstDealIndex = this.nextSeatIndex(
      this.gameState.buttonIndex,
      (seat) => !seat.sittingOut,
    )!;

    for (let round = 0; round < 2; round++) {
      for (let offset = 0; offset < this.gameState.seats.length; offset++) {
        const index = (firstDealIndex + offset) % this.gameState.seats.length;
        const seat = this.gameState.seats[index]!;

        if (!seat.sittingOut) seat.hole.push(this.draw());
      }
    }

    this.gameState.turnState.phase = "preflop";

    const firstActorIndex = this.nextSeatIndex(bigBlindIndex, (seat) => this.needsToAct(seat));

    if (firstActorIndex == null) {
      this.runoutAndShowdown("all_in_preflop");

      return;
    }

    this.gameState.actionPlayerId = this.gameState.seats[firstActorIndex]!.playerId;

    this.syncTurnState();
    this.recordEvent("hand_start", {
      handNumber: this.gameState.handNumber,
      button: btn.playerId,
      smallBlind: sbSeat.playerId,
      bigBlind: bbSeat.playerId,
      pot: this.gameState.pot,
    });
  }

  private syncTurnState(): void {
    if (!this.gameState) return;
    this.gameState.turnState.currentPlayerId = this.gameState.actionPlayerId;
    this.gameState.turnState.turnNumber = this.gameState.handNumber;
    this.gameState.turnState.turnTimeRemaining = this.gameState.timerConfig.turnTime;
    this.gameState.turnState.startedAt = Date.now();
  }

  private logAction(playerId: string, action: string, amount?: number): void {
    if (!this.gameState) return;
    this.gameState.actionLog.push({
      playerId,
      action,
      amount,
      street: z
        .enum(["preflop", "flop", "turn", "river", "showdown"])
        .parse(this.gameState.turnState.phase),
      handNumber: this.gameState.handNumber,
    });
    this.recordEvent("poker_action", {
      playerId,
      action,
      amount,
      pot: this.gameState.pot,
      street: this.gameState.turnState.phase,
    });
  }

  private requireActor(player: Player): string | PokerSeat {
    if (!this.gameState || this.gameState.status !== "playing") {
      return "Game is not playing";
    }

    const phase = this.gameState.turnState.phase;

    if (phase !== "preflop" && phase !== "flop" && phase !== "turn" && phase !== "river") {
      return "Not a betting street";
    }

    if (this.gameState.actionPlayerId !== player.id) return "Not your turn";
    const seat = this.seat(player.id);

    if (!seat) return "Not a seated player";

    if (seat.folded) return "Hand already folded";

    if (seat.allIn) return "Already all-in";

    return seat;
  }

  // ── Actions ────────────────────────────────────────────────────

  private actFold(player: Player): string | void {
    const seatOrErr = this.requireActor(player);

    if (isString(seatOrErr)) return seatOrErr;
    const seat = seatOrErr;
    seat.folded = true;
    this.logAction(player.id, "fold");

    return this.afterAction(player.id, false);
  }

  protected actCheck(player: Player): string | void {
    const seatOrErr = this.requireActor(player);

    if (isString(seatOrErr)) return seatOrErr;
    const seat = seatOrErr;

    if (this.toCallAmount(seat) > 0) return "Cannot check; must call or fold";
    this.logAction(player.id, "check");
    this.markActed(player.id);

    return this.afterAction(player.id, false);
  }

  protected actCall(player: Player): string | void {
    const seatOrErr = this.requireActor(player);

    if (isString(seatOrErr)) return seatOrErr;
    const seat = seatOrErr;
    const toCall = this.toCallAmount(seat);

    if (toCall <= 0) return "Nothing to call; check instead";
    const paid = this.putInPot(seat, toCall);
    this.logAction(player.id, seat.allIn ? "call_all_in" : "call", paid);
    this.markActed(player.id);

    return this.afterAction(player.id, false);
  }

  private actBet(player: Player, data: WireValue, isRaise: boolean): string | void {
    const seatOrErr = this.requireActor(player);

    if (isString(seatOrErr)) return seatOrErr;
    const seat = seatOrErr;
    const wager = parsePokerWagerInput(data, isRaise);

    if (isString(wager)) return wager;

    const toCall = this.toCallAmount(seat);

    if (isRaise && toCall === 0) return "Nothing to raise; bet instead";

    if (!isRaise && toCall > 0) return "Cannot bet; call or raise";

    if (isRaise && this.gameState!.actorsThisStreet.includes(player.id)) {
      return "Action was not reopened; call or fold";
    }

    // amount = total chips added this action (not raise-to absolute)
    // Also accept raiseTo as absolute street total
    let add: number;

    if (isNumber(wager.raiseTo)) {
      add = wager.raiseTo - seat.streetBet;
    } else if (isRaise || toCall > 0) {
      // amount is the raise size above call, OR total add
      // Convention: amount = chips to add now (must cover call + raise)
      add = wager.amount!;
    } else {
      // open bet: amount is bet size
      add = wager.amount!;
    }

    if (add <= 0) return "Invalid bet amount";

    if (add > seat.stack) return "Not enough chips (use all_in)";

    if (add < seat.stack && (seat.streetBet + add) % this.gameState!.bigBlind !== 0) {
      return `Bet and raise totals must be multiples of ${this.gameState!.bigBlind}; exact all-ins are allowed`;
    }

    if (toCall === 0 && !isRaise) {
      // Open bet: must be >= BB (or all-in short handled separately)
      if (add < this.gameState!.bigBlind && add < seat.stack) {
        return `Min bet is ${this.gameState!.bigBlind}`;
      }
    } else {
      // Raise: new street total must be >= currentBet + minRaise
      const newStreetTotal = seat.streetBet + add;
      const minTotal = this.gameState!.currentBet + this.gameState!.minRaise;

      if (newStreetTotal < minTotal && add < seat.stack) {
        return `Min raise to ${minTotal} (add at least ${minTotal - seat.streetBet})`;
      }

      if (add <= toCall && add < seat.stack) {
        return "Raise must exceed call amount";
      }
    }

    const paid = this.putInPot(seat, add);
    const prevBet = this.gameState!.currentBet;

    if (seat.streetBet > prevBet) {
      const raiseSize = seat.streetBet - prevBet;
      const fullRaise = raiseSize >= this.gameState!.minRaise;

      if (fullRaise) {
        this.gameState!.minRaise = raiseSize;
      }

      this.gameState!.currentBet = seat.streetBet;

      if (fullRaise) {
        this.gameState!.lastAggressorId = player.id;
        this.gameState!.actorsThisStreet = [player.id];
      } else {
        this.markActed(player.id);
      }
    } else {
      this.markActed(player.id);
    }

    this.logAction(player.id, isRaise || toCall > 0 ? "raise" : "bet", paid);

    return this.afterAction(player.id, seat.streetBet > prevBet);
  }

  private actAllIn(player: Player): string | void {
    const seatOrErr = this.requireActor(player);

    if (isString(seatOrErr)) return seatOrErr;
    const seat = seatOrErr;

    if (seat.stack <= 0) return "No chips";
    const prevBet = this.gameState!.currentBet;

    if (
      seat.streetBet + seat.stack > prevBet &&
      this.gameState!.actorsThisStreet.includes(player.id)
    ) {
      return "Action was not reopened; call or fold";
    }

    const paid = this.putInPot(seat, seat.stack);

    if (seat.streetBet > prevBet) {
      const raiseSize = seat.streetBet - prevBet;
      const fullRaise = raiseSize >= this.gameState!.minRaise;

      if (fullRaise) {
        this.gameState!.minRaise = raiseSize;
      }

      this.gameState!.currentBet = seat.streetBet;

      if (fullRaise) {
        this.gameState!.lastAggressorId = player.id;
        this.gameState!.actorsThisStreet = [player.id];
      } else {
        this.markActed(player.id);
      }
    } else {
      this.markActed(player.id);
    }

    this.logAction(player.id, "all_in", paid);

    return this.afterAction(player.id, seat.streetBet > prevBet);
  }

  private actNextHand(player: Player): string | void {
    if (!this.gameState || this.gameState.status !== "playing") {
      return "Game is not playing";
    }

    if (this.gameState.turnState.phase !== "hand_over") {
      return "Hand still in progress";
    }

    if (!this.gameState.seats.some((s) => s.playerId === player.id)) {
      return "Not seated";
    }

    const finishedAt = this.gameState.lastHandResult?.finishedAt;

    if (isNumber(finishedAt) && Date.now() - finishedAt < HAND_RESULT_HOLD_MS) {
      return "Wait for the five-second hand result before starting the next hand";
    }

    this.startNewHand();
  }

  private markActed(playerId: string): void {
    if (!this.gameState) return;

    if (!this.gameState.actorsThisStreet.includes(playerId)) {
      this.gameState.actorsThisStreet.push(playerId);
    }
  }

  /** Does this seat still need to act on the current street? */
  private needsToAct(s: PokerSeat): boolean {
    if (!this.gameState || s.sittingOut || s.folded || s.allIn) return false;

    if (s.streetBet < this.gameState.currentBet) return true;

    // Matched but hasn't voluntarily acted this street (e.g. BB option, or check round)
    return !this.gameState.actorsThisStreet.includes(s.playerId);
  }

  private streetComplete(): boolean {
    if (!this.gameState) return false;
    const live = this.gameState.seats.filter((s) => !s.folded);

    return live.every((s) => !this.needsToAct(s));
  }

  private afterAction(actorId: string, _wasAggression: boolean): string | void {
    if (!this.gameState) return;

    const live = this.gameState.seats.filter((s) => !s.folded);

    if (live.length === 1) {
      this.awardPot([live[0]!.playerId], false, "fold");

      return;
    }

    if (this.streetComplete()) {
      const canBet = live.filter((s) => !s.allIn);

      if (canBet.length <= 1) {
        this.runoutAndShowdown("all_in");

        return;
      }

      this.advanceStreet();

      return;
    }

    const next = this.nextActionSeat(actorId);

    if (next) {
      this.gameState.actionPlayerId = next.playerId;
      this.syncTurnState();
      this.recordEvent("turn_changed", {
        currentPlayerId: next.playerId,
        phase: this.gameState.turnState.phase,
      });

      return;
    }

    if (this.streetComplete()) {
      this.advanceStreet();
    }
  }

  private resetStreetBets(): void {
    if (!this.gameState) return;

    for (const s of this.gameState.seats) {
      s.streetBet = 0;
    }

    this.gameState.currentBet = 0;
    this.gameState.minRaise = this.gameState.bigBlind;
    this.gameState.lastAggressorId = null;
    this.gameState.actorsThisStreet = [];
  }

  private advanceStreet(): void {
    if (!this.gameState) return;
    const phase = this.gameState.turnState.phase;
    this.resetStreetBets();

    if (phase === "preflop") {
      this.draw();
      this.gameState.community.push(this.draw(), this.draw(), this.draw());
      this.gameState.turnState.phase = "flop";
    } else if (phase === "flop") {
      this.draw();
      this.gameState.community.push(this.draw());
      this.gameState.turnState.phase = "turn";
    } else if (phase === "turn") {
      this.draw();
      this.gameState.community.push(this.draw());
      this.gameState.turnState.phase = "river";
    } else if (phase === "river") {
      this.showdown();

      return;
    }

    const liveCanAct = this.gameState.seats.filter((s) => !s.folded && !s.allIn);

    if (liveCanAct.length <= 1) {
      this.runoutAndShowdown("all_in");

      return;
    }

    // Postflop action starts with the first live seat clockwise from the button.
    const actorIndex = this.nextSeatIndex(
      this.gameState.buttonIndex,
      (seat) => !seat.folded && !seat.allIn && !seat.sittingOut,
    );

    const actor = actorIndex == null ? liveCanAct[0]! : this.gameState.seats[actorIndex]!;

    this.gameState.actionPlayerId = actor.playerId;
    this.syncTurnState();
    this.recordEvent("street", {
      phase: this.gameState.turnState.phase,
      community: this.gameState.community,
      actionPlayerId: actor.playerId,
    });
  }

  private runoutAndShowdown(reason: string): void {
    if (!this.gameState) return;

    while (this.gameState.community.length < 5) {
      if (this.gameState.community.length === 0) {
        this.draw();
        this.gameState.community.push(this.draw(), this.draw(), this.draw());
      } else {
        this.draw();
        this.gameState.community.push(this.draw());
      }
    }

    this.recordEvent("runout", { reason, community: this.gameState.community });
    this.showdown();
  }

  private showdown(): void {
    if (!this.gameState) return;
    this.gameState.turnState.phase = "showdown";
    this.gameState.actionPlayerId = null;

    const live = this.gameState.seats.filter((s) => !s.folded);

    if (live.length === 1) {
      this.awardPot([live[0]!.playerId], false, "fold");

      return;
    }

    // Ensure full board
    while (this.gameState.community.length < 5) {
      this.draw();
      this.gameState.community.push(this.draw());
    }

    const evals = live.map((s) => {
      const cards = [...s.hole, ...this.gameState!.community];
      const e = evaluateHoldem(cards);

      return { seat: s, eval: e };
    });

    evals.sort((a, b) => b.eval.score - a.eval.score);
    const pot = this.gameState.pot;

    const settlement = this.settleSidePots(
      new Map(evals.map((entry) => [entry.seat.playerId, entry.eval.score])),
    );

    this.finishHand({
      winners: settlement.winnerIds,
      pot,
      showdown: true,
      reason: "showdown",
      hands: evals.map((e) => ({
        playerId: e.seat.playerId,
        hole: e.seat.hole,
        category: e.eval.category,
        label: e.eval.label,
      })),
      payouts: settlement.payouts,
      sidePots: settlement.sidePots,
    });
  }

  private orderedPlayerIds(playerIds: string[]): string[] {
    if (!this.gameState) return playerIds;
    const wanted = new Set(playerIds);
    const ordered: string[] = [];

    for (let offset = 1; offset <= this.gameState.seats.length; offset++) {
      const index = (this.gameState.buttonIndex + offset) % this.gameState.seats.length;

      const id = this.gameState.seats[index]?.playerId;

      if (id && wanted.has(id)) ordered.push(id);
    }

    return ordered;
  }

  private creditAmount(amount: number, winnerIds: string[], payouts: Map<string, number>): void {
    if (winnerIds.length === 0 || amount <= 0) return;
    const ordered = this.orderedPlayerIds(winnerIds);
    const share = Math.floor(amount / ordered.length);
    let remainder = amount - share * ordered.length;

    for (const id of ordered) {
      const award = share + (remainder > 0 ? 1 : 0);

      if (remainder > 0) remainder--;
      const seat = this.seat(id);

      if (seat) seat.stack += award;
      payouts.set(id, (payouts.get(id) ?? 0) + award);
    }
  }

  protected settleSidePots(scores: Map<string, number>): SidePotSettlement {
    if (!this.gameState) {
      return { winnerIds: [], payouts: [], sidePots: [] };
    }

    const levels = [
      ...new Set(
        this.gameState.seats.map((seat) => seat.handContributed).filter((amount) => amount > 0),
      ),
    ].sort((a, b) => a - b);

    const payouts = new Map<string, number>();

    const sidePots: Array<{
      amount: number;
      eligiblePlayerIds: string[];
      winnerIds: string[];
      refunded?: boolean;
    }> = [];

    const handWinners = new Set<string>();
    let previousLevel = 0;

    for (const level of levels) {
      const contributors = this.gameState.seats.filter((seat) => seat.handContributed >= level);

      const amount = (level - previousLevel) * contributors.length;
      previousLevel = level;

      if (amount <= 0) continue;

      if (contributors.length === 1) {
        const refundId = contributors[0]!.playerId;
        this.creditAmount(amount, [refundId], payouts);
        sidePots.push({
          amount,
          eligiblePlayerIds: [refundId],
          winnerIds: [refundId],
          refunded: true,
        });
        continue;
      }

      const eligible = contributors.filter((seat) => !seat.folded && scores.has(seat.playerId));

      if (eligible.length === 0) {
        // This can only be an uncalled excess left by the simplified betting
        // ledger. Return it rather than awarding folded chips to another pot.
        const refundIds = contributors.map((seat) => seat.playerId);
        this.creditAmount(amount, refundIds, payouts);
        sidePots.push({
          amount,
          eligiblePlayerIds: [],
          winnerIds: refundIds,
          refunded: true,
        });
        continue;
      }

      const bestScore = Math.max(...eligible.map((seat) => scores.get(seat.playerId)!));

      const winnerIds = eligible
        .filter((seat) => scores.get(seat.playerId) === bestScore)
        .map((seat) => seat.playerId);

      this.creditAmount(amount, winnerIds, payouts);

      for (const id of winnerIds) handWinners.add(id);
      sidePots.push({
        amount,
        eligiblePlayerIds: eligible.map((seat) => seat.playerId),
        winnerIds: this.orderedPlayerIds(winnerIds),
      });
    }

    this.gameState.pot = 0;

    return {
      winnerIds: this.orderedPlayerIds([...handWinners]),
      payouts: this.orderedPlayerIds([...payouts.keys()]).map((playerId) => ({
        playerId,
        amount: payouts.get(playerId)!,
      })),
      sidePots,
    };
  }

  private awardPot(winnerIds: string[], showdown: boolean, reason: string): void {
    if (!this.gameState) return;
    const pot = this.gameState.pot;
    const payouts = new Map<string, number>();
    this.creditAmount(pot, winnerIds, payouts);
    this.gameState.pot = 0;
    this.finishHand({
      winners: this.orderedPlayerIds(winnerIds),
      pot,
      showdown,
      reason,
      payouts: this.orderedPlayerIds([...payouts.keys()]).map((playerId) => ({
        playerId,
        amount: payouts.get(playerId)!,
      })),
    });
  }

  private finishHand(result: NonNullable<PokerGameState["lastHandResult"]>): void {
    if (!this.gameState) return;
    result.finishedAt = Date.now();
    this.gameState.lastHandResult = result;
    this.gameState.turnState.phase = "hand_over";
    this.gameState.actionPlayerId =
      this.gameState.seats[this.gameState.buttonIndex]?.playerId ?? null;
    this.gameState.turnState.currentPlayerId = this.gameState.actionPlayerId;
    this.recordEvent("hand_over", {
      winners: result.winners,
      pot: result.pot,
      reason: result.reason,
      payouts: result.payouts,
      sidePots: result.sidePots,
      stacks: this.gameState.seats.map((s) => ({
        playerId: s.playerId,
        stack: s.stack,
      })),
    });

    // End the tournament only when fewer than two funded seats remain.
    const live = this.gameState.seats.filter((s) => s.stack > 0);

    if (live.length < 2) {
      this.gameState.winner = live[0]?.playerId ?? result.winners[0] ?? null;
      this.gameState.status = "ended";
      this.gameState.turnState.phase = "ended";
      this.stopTimers();
      this.recordEvent("game_ended", {
        reason: "match_over",
        winner: this.gameState.winner,
      });
      void this.saveState().then(() => {
        this.broadcastProjected("game_ended", { reason: "match_over" });
      });
    }
  }
}
