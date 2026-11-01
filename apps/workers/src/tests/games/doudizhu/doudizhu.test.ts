import { z } from "zod";
import { describe, expect, it } from "vitest";

import { doudizhuPlugin } from "../../../games/doudizhu/plugin";
import { dealDoudizhu, doudizhuScore, isSpring, nextBidder } from "../../../games/doudizhu/rules";
import { sortCards } from "../../../games/cards/deck";
import type { DoudizhuGameState } from "../../../durable-objects/types";

const NOW = 1_800_000_000_000;

function table(options: {
  hands: string[][];
  bottom?: string[];
  phase?: "bid" | "play";
  landlord?: number | null;
  toAct?: number;
  bid?: number;
  trick?: DoudizhuGameState["trick"];
}): DoudizhuGameState {
  const state = doudizhuPlugin.createInitialState(
    { hostId: "p1", hostName: "P1", turnTime: 30_000 },
    "DDZ234",
    0,
  );

  state.status = "playing";
  state.players = options.hands.map((_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}` }));
  state.seats = Object.fromEntries(state.players.map((player, index) => [player.id, index]));
  state.hands = options.hands.map((hand) => sortCards(hand));
  state.bottom = sortCards(options.bottom ?? []);
  state.landlord = options.landlord ?? null;
  state.bottomRevealed = (options.landlord ?? null) !== null;
  state.bid = options.bid ?? 0;
  state.bidder = options.landlord ?? null;
  state.bids = options.hands.map(() => null);
  state.toAct = options.toAct ?? 0;
  state.acts = options.hands.map(() => null);
  state.played = options.hands.map(() => 0);
  state.trick = options.trick ?? null;
  state.deals = 1;
  state.turnState.phase = options.phase ?? "bid";
  state.turnState.currentPlayerId = `p${(options.toAct ?? 0) + 1}`;

  return state;
}

function bid(state: DoudizhuGameState, playerId: string, value: number) {
  return doudizhuPlugin.applyAction(state, playerId, { actionType: "bid", data: { value } }, NOW);
}

function play(state: DoudizhuGameState, playerId: string, cards: string[]) {
  return doudizhuPlugin.applyAction(
    state,
    playerId,
    { actionType: "play_cards", data: { cards } },
    NOW,
  );
}

function pass(state: DoudizhuGameState, playerId: string) {
  return doudizhuPlugin.applyAction(state, playerId, { actionType: "pass", data: {} }, NOW);
}

const HANDS = [
  ["S3", "H3", "S4"],
  ["C5", "D5", "S6"],
  ["H7", "C8", "D9"],
];

describe("Fight the Landlord deal", () => {
  it("deals seventeen cards to each seat and three to the bottom", () => {
    const deal = dealDoudizhu();

    expect(deal.hands).toHaveLength(3);
    expect(deal.hands.every((hand) => hand.length === 17)).toBe(true);
    expect(deal.bottom).toHaveLength(3);

    const all = [...deal.hands.flat(), ...deal.bottom];

    expect(new Set(all).size).toBe(54);
  });

  it("finds the next seat that still has to bid", () => {
    expect(nextBidder([1, null, null], 0, 3)).toBe(1);
    expect(nextBidder([1, 2, null], 1, 3)).toBe(2);
    expect(nextBidder([1, 2, 3], 2, 3)).toBeNull();
  });
});

describe("Fight the Landlord auction", () => {
  it("makes the highest bidder the landlord and hands over the bottom cards", () => {
    const state = table({ hands: HANDS, bottom: ["SA", "H2", "j1"] });

    expect(bid(state, "p1", 1).ok).toBe(true);
    expect(state.turnState.currentPlayerId).toBe("p2");
    expect(bid(state, "p2", 2).ok).toBe(true);
    expect(bid(state, "p3", 0).ok).toBe(true);

    expect(state.landlord).toBe(1);
    expect(state.bottomRevealed).toBe(true);
    expect(state.hands[1]).toHaveLength(6);
    expect(state.hands[1]).toContain("SA");
    expect(state.turnState.phase).toBe("play");
    expect(state.turnState.currentPlayerId).toBe("p2");
  });

  it("ends the auction at once on a bid of three", () => {
    const state = table({ hands: HANDS, bottom: ["SA", "H2", "j1"] });

    expect(bid(state, "p1", 3).ok).toBe(true);
    expect(state.landlord).toBe(0);
    expect(state.turnState.phase).toBe("play");
    expect(state.bids).toEqual([3, null, null]);
  });

  it("refuses a bid that does not raise the current one", () => {
    const state = table({ hands: HANDS, bottom: ["SA", "H2", "j1"] });

    expect(bid(state, "p1", 2).ok).toBe(true);
    expect(bid(state, "p2", 2)).toMatchObject({ ok: false });
    expect(bid(state, "p2", 1)).toMatchObject({ ok: false });
  });

  it("throws the deal in when nobody bids and lets the next seat open", () => {
    const state = table({ hands: HANDS, bottom: ["SA", "H2", "j1"] });

    bid(state, "p1", 0);
    bid(state, "p2", 0);
    bid(state, "p3", 0);

    expect(state.landlord).toBeNull();
    expect(state.turnState.phase).toBe("bid");
    expect(state.deals).toBe(2);
    expect(state.firstBidder).toBe(1);
    expect(state.turnState.currentPlayerId).toBe("p2");
    expect(state.bids).toEqual([null, null, null]);
  });

  it("passes on a bid timeout", () => {
    const state = table({ hands: HANDS, bottom: ["SA", "H2", "j1"] });

    doudizhuPlugin.onTurnTimeout?.(state, "p1", NOW);

    expect(state.bids[0]).toBe(0);
    expect(state.turnState.currentPlayerId).toBe("p2");
  });
});

describe("Fight the Landlord play", () => {
  it("lets the landlord lead and refuses a pass on lead", () => {
    const state = table({
      hands: HANDS,
      phase: "play",
      landlord: 0,
      toAct: 0,
    });

    expect(pass(state, "p1")).toMatchObject({ ok: false });
    expect(play(state, "p1", ["3", "3"]).ok).toBe(true);
    expect(state.turnState.currentPlayerId).toBe("p2");
  });

  it("refuses a bid once the play has started", () => {
    const state = table({ hands: HANDS, phase: "play", landlord: 0, toAct: 0 });

    expect(bid(state, "p1", 1)).toMatchObject({ ok: false, message: "Bidding is over" });
  });

  it("wins for the landlord alone and scores the spring", () => {
    const state = table({
      hands: [["S3"], ["C5", "D5"], ["H7"]],
      phase: "play",
      landlord: 0,
      toAct: 0,
      bid: 2,
    });

    const result = play(state, "p1", ["S3"]);

    expect(result.ok).toBe(true);
    expect(state.winnerSide).toBe("landlord");
    expect(state.score).toBe(4);

    const ended = (result.ok ? (result.effects ?? []) : []).find(
      (effect) => effect.type === "event" && effect.event === "game_ended",
    );

    expect(ended).toMatchObject({ data: { winnerSide: "landlord", spring: true } });
  });

  it("wins for both farmers when a farmer empties", () => {
    const state = table({
      hands: [["S3", "H3"], ["C5"], ["H7"]],
      phase: "play",
      landlord: 0,
      toAct: 1,
      bid: 1,
      trick: { seat: 0, cards: ["S4"], combo: { kind: "single", size: 1, key: 1, len: 1 }, n: 1 },
    });

    expect(play(state, "p2", ["C5"]).ok).toBe(true);
    expect(state.winnerSide).toBe("farmers");
    expect(state.score).toBe(-1);
  });

  it("doubles the score for every bomb played", () => {
    const state = table({
      hands: [["S3", "H3", "C3", "D3"], ["C5"], ["H7"]],
      phase: "play",
      landlord: 0,
      toAct: 0,
      bid: 1,
    });

    play(state, "p1", ["3", "3", "3", "3"]);

    // 1 hand point × 2 for the bomb × 2 for the spring.
    expect(state.multiplier).toBe(1);
    expect(state.score).toBe(4);
  });
});

describe("Fight the Landlord views", () => {
  it("hides the hands and an unrevealed bottom", () => {
    const state = table({ hands: HANDS, bottom: ["SA", "H2", "j1"] });

    const projectionSchema = z
      .object({
        hands: z.unknown().optional(),
        bottom: z.array(z.string()).optional(),
        bottomCount: z.number(),
        hand: z.array(z.string()),
        handCounts: z.array(z.number()),
      })
      .loose();

    const before = projectionSchema.parse(doudizhuPlugin.projectState?.(state, "p1"));

    expect(before.hands).toBeUndefined();
    expect(before.bottom).toBeUndefined();
    expect(before.bottomCount).toBe(3);
    expect(before.hand).toEqual(sortCards(HANDS[0]!));

    state.bottomRevealed = true;
    const after = projectionSchema.parse(doudizhuPlugin.projectState?.(state, "p1"));

    expect(after.bottom).toHaveLength(3);
  });

  it("gives the viewer their side once a landlord exists", () => {
    const state = table({ hands: HANDS, phase: "play", landlord: 1, toAct: 1 });

    expect(doudizhuPlugin.youFields?.(state, "p2", { isSpectator: false })).toEqual({ team: "landlord" });
    expect(doudizhuPlugin.youFields?.(state, "p1", { isSpectator: false })).toEqual({ team: "farmers" });
  });

  it("scores a hand from its bid, bombs and spring", () => {
    expect(doudizhuScore({ bid: 1, multiplier: 0, landlordWon: true, spring: false })).toBe(1);
    expect(doudizhuScore({ bid: 3, multiplier: 2, landlordWon: true, spring: true })).toBe(24);
    expect(doudizhuScore({ bid: 2, multiplier: 0, landlordWon: false, spring: false })).toBe(-2);
    expect(isSpring([1, 0, 0], 0)).toBe(true);
    expect(isSpring([1, 2, 0], 0)).toBe(false);
  });
});
