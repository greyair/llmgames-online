import { z } from "zod";
import { describe, expect, it } from "vitest";

import { paodekuaiPlugin } from "../../../games/paodekuai/plugin";
import { dealPaodekuai, pdkForcedPlay, pdkMoves, trickIsOver } from "../../../games/paodekuai/rules";
import { sortCards } from "../../../games/cards/deck";
import type { CardActionRecord, PaodekuaiGameState } from "../../../durable-objects/types";

const NOW = 1_800_000_000_000;

function table(options: {
  hands: string[][];
  mustLead?: string | null;
  trick?: CardActionRecord | null;
  passes?: number;
  toPlay?: number;
}): PaodekuaiGameState {
  const state = paodekuaiPlugin.createInitialState(
    {
      hostId: "p1",
      hostName: "P1",
      maxPlayers: options.hands.length,
      turnTime: 30_000,
    },
    "PDK234",
    0,
  );

  state.status = "playing";
  state.players = options.hands.map((_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}` }));
  state.seats = Object.fromEntries(state.players.map((player, index) => [player.id, index]));
  state.hands = options.hands.map((hand) => sortCards(hand));
  state.unused = [];
  state.first = 0;
  state.mustLead = options.mustLead ?? null;
  state.toPlay = options.toPlay ?? 0;
  state.acts = options.hands.map(() => null);
  state.played = options.hands.map(() => 0);
  state.trick = options.trick ?? null;
  state.passes = options.passes ?? 0;
  state.turnState.currentPlayerId = `p${(options.toPlay ?? 0) + 1}`;
  state.turnState.phase = "play";

  return state;
}

function play(state: PaodekuaiGameState, playerId: string, cards: string[]) {
  return paodekuaiPlugin.applyAction(state, playerId, { actionType: "play_cards", data: { cards } }, NOW);
}

function pass(state: PaodekuaiGameState, playerId: string) {
  return paodekuaiPlugin.applyAction(state, playerId, { actionType: "pass", data: {} }, NOW);
}

describe("Run Fast deal", () => {
  it("deals the whole 48-card deck to three seats and makes the spade three lead", () => {
    const deal = dealPaodekuai(3);

    expect(deal.hands).toHaveLength(3);
    expect(deal.hands.every((hand) => hand.length === 16)).toBe(true);
    expect(deal.unused).toEqual([]);
    expect(deal.mustLead).toBe("S3");
    expect(deal.hands[deal.first]).toContain("S3");

    const all = deal.hands.flat();

    expect(new Set(all).size).toBe(48);
  });

  it("sets sixteen cards aside for two seats and lets seat 0 lead", () => {
    const deal = dealPaodekuai(2);

    expect(deal.hands.every((hand) => hand.length === 16)).toBe(true);
    expect(deal.unused).toHaveLength(16);
    expect(deal.mustLead).toBeNull();
    expect(deal.first).toBe(0);
  });
});

describe("Run Fast turns", () => {
  it("plays a single, sets the trick and hands the turn on", () => {
    const state = table({ hands: [["S3", "H4"], ["C5", "D6"]] });

    expect(play(state, "p1", ["S3"]).ok).toBe(true);
    expect(state.trick).toMatchObject({ seat: 0, cards: ["S3"] });
    expect(state.turnState.currentPlayerId).toBe("p2");
  });

  it("refuses a pass while leading", () => {
    const state = table({ hands: [["S3", "H4"], ["C5", "D6"]] });

    expect(pass(state, "p1")).toMatchObject({
      ok: false,
      message: "You lead this trick, so you cannot pass",
    });
  });

  it("refuses a play that does not beat the trick", () => {
    const state = table({
      hands: [["S3", "H4"], ["C3", "D6"]],
      toPlay: 1,
      trick: { seat: 0, cards: ["H4"], combo: { kind: "single", size: 1, key: 1, len: 1 }, n: 1 },
    });

    expect(play(state, "p2", ["C3"])).toMatchObject({ ok: false });
    expect(play(state, "p2", ["D6"]).ok).toBe(true);
  });

  it("refuses a bare triple that is not the whole hand", () => {
    const state = table({ hands: [["S3", "H3", "C3", "S9"], ["C5", "D6"]] });

    expect(play(state, "p1", ["3", "3", "3"])).toMatchObject({
      ok: false,
      message: "A bare triple is only legal as your last cards",
    });
  });

  it("allows a bare triple as the last cards", () => {
    const state = table({ hands: [["S3", "H3", "C3"], ["C5", "D6"]] });

    expect(play(state, "p1", ["3", "3", "3"]).ok).toBe(true);
    expect(state.status).toBe("ended");
  });

  it("requires the spade three in the first play of a three-seat game", () => {
    const state = table({ hands: [["S3", "H4"], ["C5", "D6"], ["S7", "H8"]], mustLead: "S3" });

    expect(play(state, "p1", ["H4"])).toMatchObject({
      ok: false,
      message: "The first play must include the spade three",
    });
    expect(play(state, "p1", ["S3"]).ok).toBe(true);
    expect(state.mustLead).toBeNull();
  });

  it("returns the lead to the last player once everyone else has passed", () => {
    const state = table({ hands: [["S3", "H4"], ["C5", "D6"], ["S7", "H8"]] });

    expect(play(state, "p1", ["S3"]).ok).toBe(true);
    expect(pass(state, "p2").ok).toBe(true);
    expect(state.trick).not.toBeNull();
    expect(pass(state, "p3").ok).toBe(true);

    expect(state.trick).toBeNull();
    expect(state.lastTrick).toMatchObject({ seat: 0, cards: ["S3"] });
    expect(trickIsOver(3, 2)).toBe(true);
    expect(state.turnState.currentPlayerId).toBe("p1");
    expect(state.tricks).toBe(1);
  });

  it("ends the match when a hand empties and flags spring", () => {
    const state = table({ hands: [["S3"], ["C5", "D6"], ["S7", "H8"]] });

    const result = play(state, "p1", ["S3"]);

    expect(result.ok).toBe(true);
    expect(state.status).toBe("ended");
    expect(state.winner).toBe("p1");

    const ended = (result.ok ? (result.effects ?? []) : []).find(
      (effect) => effect.type === "event" && effect.event === "game_ended",
    );

    expect(ended).toMatchObject({ data: { reason: "hand_emptied", spring: true } });
  });
});

describe("Run Fast timeouts", () => {
  it("passes for a seat that is following", () => {
    const state = table({ hands: [["S3", "H4"], ["C5", "D6"]] });

    expect(play(state, "p1", ["S3"]).ok).toBe(true);
    expect(state.turnState.currentPlayerId).toBe("p2");

    const effects = paodekuaiPlugin.onTurnTimeout?.(state, "p2", NOW) ?? [];
    const names = effects.flatMap((effect) => (effect.type === "event" ? [effect.event] : []));

    expect(names).toContain("turn_timeout");
    expect(state.trick).toBeNull();
    expect(state.turnState.currentPlayerId).toBe("p1");
  });

  it("plays the cheapest card for a leader, because a leader may not pass", () => {
    const state = table({ hands: [["H4", "S3"], ["C5", "D6"]] });

    expect(pdkForcedPlay(state.hands[0] ?? [], null, null)).toEqual(["S3"]);
    paodekuaiPlugin.onTurnTimeout?.(state, "p1", NOW);

    expect(state.trick).toMatchObject({ seat: 0, cards: ["S3"] });
    expect(state.hands[0]).toEqual(["H4"]);
  });
});

describe("Run Fast views", () => {
  it("lists legal plays cheapest first and answers only for the seat on turn", () => {
    const hand = sortCards(["S3", "H3", "S4", "H4", "C5"]);

    expect(pdkMoves(hand, null)[0]).toEqual(["S3"]);
    expect(pdkMoves(hand, { kind: "pair", size: 2, key: 0, len: 1 })).toContainEqual(["S4", "H4"]);
    expect(pdkMoves(hand, null).some((cards) => cards.length === 2)).toBe(true);
  });

  it("keeps rival hands off the wire", () => {
    const state = table({ hands: [["S3", "H4"], ["C5", "D6"]] });

    const projectionSchema = z
      .object({
        hands: z.unknown().optional(),
        hand: z.array(z.string()),
        handCounts: z.array(z.number()),
      })
      .loose();

    const projection = projectionSchema.parse(paodekuaiPlugin.projectState?.(state, "p1"));

    expect(projection.hands).toBeUndefined();
    expect(projection.hand).toEqual(["S3", "H4"]);
    expect(projection.handCounts).toEqual([2, 2]);
  });
});
