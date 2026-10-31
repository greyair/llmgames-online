import {
  isNumber,
  isString,
  isWireObject,
  type WireValue,
} from "@llmgames/game-catalog";
import { z } from "zod";

import { sha256Hex, shuffleInPlace } from "../../lib/csprng";
import { evaluateHoldem } from "../../lib/pokerHands";
import type {
  CardRank,
  CardSuit,
  PokerCardPublic,
  PokerGameState,
  PokerSeat,
} from "../../durable-objects/types";
import type { GameEffect } from "../contract";

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
 * Poker table rules (M3.9).
 *
 * The betting state machine — blinds, streets, side pots, showdown and the
 * five-second result window — lives here as one object holding the state it was
 * built with, so the port stays close to the code it replaces: every method
 * still reads and writes "the table" instead of threading a state parameter
 * through sixty call sites.
 *
 * The table never touches storage, sockets or timers. Everything it wants the
 * platform to do is queued in {@link PokerTable.effects} and drained by the
 * caller once the action settles.
 */
export class PokerTable {
  private readonly effects: GameEffect[] = [];

  constructor(private readonly state: PokerGameState) {}

  /** Side effects requested so far, in order. */
  takeEffects(): GameEffect[] {
    return [...this.effects];
  }

  /**
   * Audit/replay event, recorded by the platform once the action is accepted.
   *
   * The summary is written to the archive and never read back as a value, so it
   * is passed through untouched: SAFETY the shapes below are plain JSON objects
   * built here, and the archive schema validates them on the way out.
   */
  private recordEvent<T>(event: string, data?: T): void {
    // SAFETY: every caller passes a plain JSON summary built here (ids, counts,
    // cards); the archive schema validates it again on the way out.
    const summary = data as WireValue;

    this.effects.push({ type: "event", event, data: summary });
  }

  private endMatch(reason: string, data: Record<string, WireValue> = {}): void {
    this.effects.push(
      { type: "stop_timers" },
      { type: "event", event: "game_ended", data: { reason, ...data } },
      { type: "match_ended", reason },
    );
  }

  // ── Helpers ────────────────────────────────────────────────────

  seat(playerId: string): PokerSeat | undefined {
    return this.state?.seats.find((s) => s.playerId === playerId);
  }

  nextSeatIndex(
    fromIndex: number,
    predicate: (seat: PokerSeat) => boolean,
    state: PokerGameState = this.state,
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

  blindSeatIndexes(state: PokerGameState): BlindIndices {
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

  nextActionSeat(afterPlayerId: string): PokerSeat | undefined {
    if (!this.state) return undefined;

    const fromIndex = this.state.seats.findIndex((seat) => seat.playerId === afterPlayerId);

    const nextIndex = this.nextSeatIndex(fromIndex, (seat) => this.needsToAct(seat));

    return nextIndex == null ? undefined : this.state.seats[nextIndex];
  }

  toCallAmount(seat: PokerSeat): number {
    if (!this.state) return 0;

    return Math.max(0, this.state.currentBet - seat.streetBet);
  }

  toCallFor(playerId: string, state: PokerGameState): number {
    const seat = state.seats.find((s) => s.playerId === playerId);

    if (!seat) return 0;

    return Math.max(0, state.currentBet - seat.streetBet);
  }

  putInPot(seat: PokerSeat, amount: number): number {
    if (!this.state) return 0;
    const pay = Math.min(amount, seat.stack);
    seat.stack -= pay;
    seat.streetBet += pay;
    seat.handContributed += pay;
    this.state.pot += pay;

    if (seat.stack === 0) seat.allIn = true;

    return pay;
  }

  shuffleDeck(): void {
    if (!this.state) return;
    const deck = freshDeck();
    shuffleInPlace(deck);
    this.state.deck = deck;
    this.state.deckCommitHash = null;
    void sha256Hex(deck.map(fmtCard).join(",")).then((h) => {
      if (this.state) this.state.deckCommitHash = h;
    });
  }

  draw(): PokerCardPublic {
    if (!this.state || this.state.deck.length === 0) {
      throw new Error("Deck empty");
    }

    return this.state.deck.pop()!;
  }

  startNewHand(): void {
    if (!this.state) return;

    for (const s of this.state.seats) {
      s.sittingOut = s.stack <= 0;
    }

    const live = this.state.seats.filter((s) => !s.sittingOut);

    if (live.length < 2) {
      const winner = live[0]?.playerId ?? this.state.seats[0]?.playerId ?? null;
      this.state.winner = winner;
      this.state.status = "ended";
      this.state.turnState.phase = "ended";
      this.state.actionPlayerId = null;
      this.state.turnState.currentPlayerId = null;
      this.endMatch("stack_out", { winner });

      return;
    }

    if (this.state.handNumber > 0) {
      const nextButtonIndex = this.nextSeatIndex(
        this.state.buttonIndex,
        (seat) => !seat.sittingOut,
      );

      if (nextButtonIndex != null) this.state.buttonIndex = nextButtonIndex;
    }

    this.state.handNumber++;
    this.state.pot = 0;
    this.state.community = [];
    this.state.currentBet = 0;
    this.state.minRaise = this.state.bigBlind;
    this.state.lastAggressorId = null;
    this.state.actorsThisStreet = [];
    this.state.lastHandResult = null;

    for (const s of this.state.seats) {
      s.hole = [];
      s.streetBet = 0;
      s.handContributed = 0;
      s.folded = s.sittingOut;
      s.allIn = false;
    }

    this.shuffleDeck();

    const btn = this.state.seats[this.state.buttonIndex]!;
    const { smallBlindIndex, bigBlindIndex } = this.blindSeatIndexes(this.state);

    if (smallBlindIndex == null || bigBlindIndex == null) return;
    const sbSeat = this.state.seats[smallBlindIndex]!;
    const bbSeat = this.state.seats[bigBlindIndex]!;

    this.putInPot(sbSeat, Math.min(this.state.smallBlind, sbSeat.stack));
    this.putInPot(bbSeat, Math.min(this.state.bigBlind, bbSeat.stack));
    this.state.currentBet = Math.max(sbSeat.streetBet, bbSeat.streetBet);
    this.state.minRaise = this.state.bigBlind;

    const firstDealIndex = this.nextSeatIndex(
      this.state.buttonIndex,
      (seat) => !seat.sittingOut,
    )!;

    for (let round = 0; round < 2; round++) {
      for (let offset = 0; offset < this.state.seats.length; offset++) {
        const index = (firstDealIndex + offset) % this.state.seats.length;
        const seat = this.state.seats[index]!;

        if (!seat.sittingOut) seat.hole.push(this.draw());
      }
    }

    this.state.turnState.phase = "preflop";

    const firstActorIndex = this.nextSeatIndex(bigBlindIndex, (seat) => this.needsToAct(seat));

    if (firstActorIndex == null) {
      this.runoutAndShowdown("all_in_preflop");

      return;
    }

    this.state.actionPlayerId = this.state.seats[firstActorIndex]!.playerId;

    this.syncTurnState();
    this.recordEvent("hand_start", {
      handNumber: this.state.handNumber,
      button: btn.playerId,
      smallBlind: sbSeat.playerId,
      bigBlind: bbSeat.playerId,
      pot: this.state.pot,
    });
  }

  syncTurnState(): void {
    if (!this.state) return;
    this.state.turnState.currentPlayerId = this.state.actionPlayerId;
    this.state.turnState.turnNumber = this.state.handNumber;
    this.state.turnState.turnTimeRemaining = this.state.timerConfig.turnTime;
    this.state.turnState.startedAt = Date.now();
  }

  logAction(playerId: string, action: string, amount?: number): void {
    if (!this.state) return;
    this.state.actionLog.push({
      playerId,
      action,
      amount,
      street: z
        .enum(["preflop", "flop", "turn", "river", "showdown"])
        .parse(this.state.turnState.phase),
      handNumber: this.state.handNumber,
    });
    this.recordEvent("poker_action", {
      playerId,
      action,
      amount,
      pot: this.state.pot,
      street: this.state.turnState.phase,
    });
  }

  private requireActor(playerId: string): string | PokerSeat {
    if (!this.state || this.state.status !== "playing") {
      return "Game is not playing";
    }

    const phase = this.state.turnState.phase;

    if (phase !== "preflop" && phase !== "flop" && phase !== "turn" && phase !== "river") {
      return "Not a betting street";
    }

    if (this.state.actionPlayerId !== playerId) return "Not your turn";
    const seat = this.seat(playerId);

    if (!seat) return "Not a seated player";

    if (seat.folded) return "Hand already folded";

    if (seat.allIn) return "Already all-in";

    return seat;
  }

  // ── Actions ────────────────────────────────────────────────────

  actFold(playerId: string): string | void {
    const seatOrErr = this.requireActor(playerId);

    if (isString(seatOrErr)) return seatOrErr;
    const seat = seatOrErr;
    seat.folded = true;
    this.logAction(playerId, "fold");

    return this.afterAction(playerId, false);
  }

  actCheck(playerId: string): string | void {
    const seatOrErr = this.requireActor(playerId);

    if (isString(seatOrErr)) return seatOrErr;
    const seat = seatOrErr;

    if (this.toCallAmount(seat) > 0) return "Cannot check; must call or fold";
    this.logAction(playerId, "check");
    this.markActed(playerId);

    return this.afterAction(playerId, false);
  }

  actCall(playerId: string): string | void {
    const seatOrErr = this.requireActor(playerId);

    if (isString(seatOrErr)) return seatOrErr;
    const seat = seatOrErr;
    const toCall = this.toCallAmount(seat);

    if (toCall <= 0) return "Nothing to call; check instead";
    const paid = this.putInPot(seat, toCall);
    this.logAction(playerId, seat.allIn ? "call_all_in" : "call", paid);
    this.markActed(playerId);

    return this.afterAction(playerId, false);
  }

  actBet(playerId: string, data: WireValue, isRaise: boolean): string | void {
    const seatOrErr = this.requireActor(playerId);

    if (isString(seatOrErr)) return seatOrErr;
    const seat = seatOrErr;
    const wager = parsePokerWagerInput(data, isRaise);

    if (isString(wager)) return wager;

    const toCall = this.toCallAmount(seat);

    if (isRaise && toCall === 0) return "Nothing to raise; bet instead";

    if (!isRaise && toCall > 0) return "Cannot bet; call or raise";

    if (isRaise && this.state.actorsThisStreet.includes(playerId)) {
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

    if (add < seat.stack && (seat.streetBet + add) % this.state.bigBlind !== 0) {
      return `Bet and raise totals must be multiples of ${this.state.bigBlind}; exact all-ins are allowed`;
    }

    if (toCall === 0 && !isRaise) {
      // Open bet: must be >= BB (or all-in short handled separately)
      if (add < this.state.bigBlind && add < seat.stack) {
        return `Min bet is ${this.state.bigBlind}`;
      }
    } else {
      // Raise: new street total must be >= currentBet + minRaise
      const newStreetTotal = seat.streetBet + add;
      const minTotal = this.state.currentBet + this.state.minRaise;

      if (newStreetTotal < minTotal && add < seat.stack) {
        return `Min raise to ${minTotal} (add at least ${minTotal - seat.streetBet})`;
      }

      if (add <= toCall && add < seat.stack) {
        return "Raise must exceed call amount";
      }
    }

    const paid = this.putInPot(seat, add);
    const prevBet = this.state.currentBet;

    if (seat.streetBet > prevBet) {
      const raiseSize = seat.streetBet - prevBet;
      const fullRaise = raiseSize >= this.state.minRaise;

      if (fullRaise) {
        this.state.minRaise = raiseSize;
      }

      this.state.currentBet = seat.streetBet;

      if (fullRaise) {
        this.state.lastAggressorId = playerId;
        this.state.actorsThisStreet = [playerId];
      } else {
        this.markActed(playerId);
      }
    } else {
      this.markActed(playerId);
    }

    this.logAction(playerId, isRaise || toCall > 0 ? "raise" : "bet", paid);

    return this.afterAction(playerId, seat.streetBet > prevBet);
  }

  actAllIn(playerId: string): string | void {
    const seatOrErr = this.requireActor(playerId);

    if (isString(seatOrErr)) return seatOrErr;
    const seat = seatOrErr;

    if (seat.stack <= 0) return "No chips";
    const prevBet = this.state.currentBet;

    if (
      seat.streetBet + seat.stack > prevBet &&
      this.state.actorsThisStreet.includes(playerId)
    ) {
      return "Action was not reopened; call or fold";
    }

    const paid = this.putInPot(seat, seat.stack);

    if (seat.streetBet > prevBet) {
      const raiseSize = seat.streetBet - prevBet;
      const fullRaise = raiseSize >= this.state.minRaise;

      if (fullRaise) {
        this.state.minRaise = raiseSize;
      }

      this.state.currentBet = seat.streetBet;

      if (fullRaise) {
        this.state.lastAggressorId = playerId;
        this.state.actorsThisStreet = [playerId];
      } else {
        this.markActed(playerId);
      }
    } else {
      this.markActed(playerId);
    }

    this.logAction(playerId, "all_in", paid);

    return this.afterAction(playerId, seat.streetBet > prevBet);
  }

  actNextHand(playerId: string): string | void {
    if (!this.state || this.state.status !== "playing") {
      return "Game is not playing";
    }

    if (this.state.turnState.phase !== "hand_over") {
      return "Hand still in progress";
    }

    if (!this.state.seats.some((s) => s.playerId === playerId)) {
      return "Not seated";
    }

    const finishedAt = this.state.lastHandResult?.finishedAt;

    if (isNumber(finishedAt) && Date.now() - finishedAt < HAND_RESULT_HOLD_MS) {
      return "Wait for the five-second hand result before starting the next hand";
    }

    this.startNewHand();
  }

  markActed(playerId: string): void {
    if (!this.state) return;

    if (!this.state.actorsThisStreet.includes(playerId)) {
      this.state.actorsThisStreet.push(playerId);
    }
  }

  /** Does this seat still need to act on the current street? */
  needsToAct(s: PokerSeat): boolean {
    if (!this.state || s.sittingOut || s.folded || s.allIn) return false;

    if (s.streetBet < this.state.currentBet) return true;

    // Matched but hasn't voluntarily acted this street (e.g. BB option, or check round)
    return !this.state.actorsThisStreet.includes(s.playerId);
  }

  streetComplete(): boolean {
    if (!this.state) return false;
    const live = this.state.seats.filter((s) => !s.folded);

    return live.every((s) => !this.needsToAct(s));
  }

  afterAction(actorId: string, _wasAggression: boolean): string | void {
    if (!this.state) return;

    const live = this.state.seats.filter((s) => !s.folded);

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
      this.state.actionPlayerId = next.playerId;
      this.syncTurnState();
      this.recordEvent("turn_changed", {
        currentPlayerId: next.playerId,
        phase: this.state.turnState.phase,
      });

      return;
    }

    if (this.streetComplete()) {
      this.advanceStreet();
    }
  }

  resetStreetBets(): void {
    if (!this.state) return;

    for (const s of this.state.seats) {
      s.streetBet = 0;
    }

    this.state.currentBet = 0;
    this.state.minRaise = this.state.bigBlind;
    this.state.lastAggressorId = null;
    this.state.actorsThisStreet = [];
  }

  advanceStreet(): void {
    if (!this.state) return;
    const phase = this.state.turnState.phase;
    this.resetStreetBets();

    if (phase === "preflop") {
      this.draw();
      this.state.community.push(this.draw(), this.draw(), this.draw());
      this.state.turnState.phase = "flop";
    } else if (phase === "flop") {
      this.draw();
      this.state.community.push(this.draw());
      this.state.turnState.phase = "turn";
    } else if (phase === "turn") {
      this.draw();
      this.state.community.push(this.draw());
      this.state.turnState.phase = "river";
    } else if (phase === "river") {
      this.showdown();

      return;
    }

    const liveCanAct = this.state.seats.filter((s) => !s.folded && !s.allIn);

    if (liveCanAct.length <= 1) {
      this.runoutAndShowdown("all_in");

      return;
    }

    // Postflop action starts with the first live seat clockwise from the button.
    const actorIndex = this.nextSeatIndex(
      this.state.buttonIndex,
      (seat) => !seat.folded && !seat.allIn && !seat.sittingOut,
    );

    const actor = actorIndex == null ? liveCanAct[0]! : this.state.seats[actorIndex]!;

    this.state.actionPlayerId = actor.playerId;
    this.syncTurnState();
    this.recordEvent("street", {
      phase: this.state.turnState.phase,
      community: this.state.community,
      actionPlayerId: actor.playerId,
    });
  }

  runoutAndShowdown(reason: string): void {
    if (!this.state) return;

    while (this.state.community.length < 5) {
      if (this.state.community.length === 0) {
        this.draw();
        this.state.community.push(this.draw(), this.draw(), this.draw());
      } else {
        this.draw();
        this.state.community.push(this.draw());
      }
    }

    this.recordEvent("runout", { reason, community: this.state.community });
    this.showdown();
  }

  showdown(): void {
    if (!this.state) return;
    this.state.turnState.phase = "showdown";
    this.state.actionPlayerId = null;

    const live = this.state.seats.filter((s) => !s.folded);

    if (live.length === 1) {
      this.awardPot([live[0]!.playerId], false, "fold");

      return;
    }

    // Ensure full board
    while (this.state.community.length < 5) {
      this.draw();
      this.state.community.push(this.draw());
    }

    const evals = live.map((s) => {
      const cards = [...s.hole, ...this.state.community];
      const e = evaluateHoldem(cards);

      return { seat: s, eval: e };
    });

    evals.sort((a, b) => b.eval.score - a.eval.score);
    const pot = this.state.pot;

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

  orderedPlayerIds(playerIds: string[]): string[] {
    if (!this.state) return playerIds;
    const wanted = new Set(playerIds);
    const ordered: string[] = [];

    for (let offset = 1; offset <= this.state.seats.length; offset++) {
      const index = (this.state.buttonIndex + offset) % this.state.seats.length;

      const id = this.state.seats[index]?.playerId;

      if (id && wanted.has(id)) ordered.push(id);
    }

    return ordered;
  }

  creditAmount(amount: number, winnerIds: string[], payouts: Map<string, number>): void {
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

  settleSidePots(scores: Map<string, number>): SidePotSettlement {
    if (!this.state) {
      return { winnerIds: [], payouts: [], sidePots: [] };
    }

    const levels = [
      ...new Set(
        this.state.seats.map((seat) => seat.handContributed).filter((amount) => amount > 0),
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
      const contributors = this.state.seats.filter((seat) => seat.handContributed >= level);

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

    this.state.pot = 0;

    return {
      winnerIds: this.orderedPlayerIds([...handWinners]),
      payouts: this.orderedPlayerIds([...payouts.keys()]).map((playerId) => ({
        playerId,
        amount: payouts.get(playerId)!,
      })),
      sidePots,
    };
  }

  awardPot(winnerIds: string[], showdown: boolean, reason: string): void {
    if (!this.state) return;
    const pot = this.state.pot;
    const payouts = new Map<string, number>();
    this.creditAmount(pot, winnerIds, payouts);
    this.state.pot = 0;
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

  finishHand(result: NonNullable<PokerGameState["lastHandResult"]>): void {
    if (!this.state) return;
    result.finishedAt = Date.now();
    this.state.lastHandResult = result;
    this.state.turnState.phase = "hand_over";
    this.state.actionPlayerId =
      this.state.seats[this.state.buttonIndex]?.playerId ?? null;
    this.state.turnState.currentPlayerId = this.state.actionPlayerId;
    this.recordEvent("hand_over", {
      winners: result.winners,
      pot: result.pot,
      reason: result.reason,
      payouts: result.payouts,
      sidePots: result.sidePots,
      stacks: this.state.seats.map((s) => ({
        playerId: s.playerId,
        stack: s.stack,
      })),
    });

    // End the tournament only when fewer than two funded seats remain.
    const live = this.state.seats.filter((s) => s.stack > 0);

    if (live.length < 2) {
      this.state.winner = live[0]?.playerId ?? result.winners[0] ?? null;
      this.state.status = "ended";
      this.state.turnState.phase = "ended";
      this.endMatch("match_over", { winner: this.state.winner });
    }
  }
}
