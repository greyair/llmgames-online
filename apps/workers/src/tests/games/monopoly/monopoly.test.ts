import { afterEach, describe, expect, it, vi } from "vitest";

import { monopolyPlugin } from "../../../games/monopoly/plugin";
import { MONOPOLY_SPACES, MONOPOLY_START_CASH, advance, monopolySpace } from "../../../games/monopoly/board";
import { canBuild, netWorth, rentFor } from "../../../games/monopoly/rules";
import type { MonopolyGameState } from "../../../durable-objects/types";

const NOW = 1_800_000_000_000;

/**
 * Fixes the next dice.
 *
 * `randomInt(6)` draws a uint32 and takes the remainder, so writing the face
 * minus one into the buffer fixes the result without touching the production
 * path.
 */
function rigDice(faces: readonly number[]) {
  let index = 0;

  return vi.spyOn(crypto, "getRandomValues").mockImplementation(
    // SAFETY: die faces are read back as a uint32 remainder; the buffer contract is unchanged.
    ((buffer: Uint32Array) => {
      const face = faces[index] ?? faces[faces.length - 1] ?? 1;

      index += 1;
      buffer[0] = face - 1;

      return buffer;
    }) as typeof crypto.getRandomValues,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

function table(options: {
  seats?: number;
  position?: number[];
  cash?: number[];
  owners?: Record<number, number>;
  houses?: Record<number, number>;
  jail?: boolean[];
  jailTurns?: number[];
  jailCards?: number[];
}): MonopolyGameState {
  const state = monopolyPlugin.createInitialState(
    { hostId: "p1", hostName: "P1", maxPlayers: options.seats ?? 2, turnTime: 30_000 },
    "MON234",
    0,
  );

  const seats = options.seats ?? 2;

  state.status = "playing";
  state.players = Array.from({ length: seats }, (_, index) => ({
    id: `p${index + 1}`,
    name: `P${index + 1}`,
  }));
  state.seats = Object.fromEntries(state.players.map((player, index) => [player.id, index]));
  state.cash = options.cash ?? state.players.map(() => MONOPOLY_START_CASH);
  state.position = options.position ?? state.players.map(() => 0);
  state.jail = options.jail ?? state.players.map(() => false);
  state.jailTurns = options.jailTurns ?? state.players.map(() => 0);
  state.jailCards = options.jailCards ?? state.players.map(() => 0);
  state.owners = MONOPOLY_SPACES.map((space) => options.owners?.[space.index] ?? null);
  state.houses = MONOPOLY_SPACES.map((space) => options.houses?.[space.index] ?? 0);
  state.bankrupt = state.players.map(() => false);
  state.deck = [6, 5, 4, 3, 2, 1, 0, 7, 8, 9, 10];
  state.turnState.phase = "roll";
  state.turnState.currentPlayerId = "p1";
  state.turnState.turnNumber = 1;

  return state;
}

function act(state: MonopolyGameState, playerId: string, actionType: string, data = {}) {
  return monopolyPlugin.applyAction(state, playerId, { actionType, data }, NOW);
}

describe("Monopoly board", () => {
  it("wraps clockwise and keeps the four corners", () => {
    expect(advance(0, 5)).toBe(5);
    expect(advance(22, 5)).toBe(3);
    expect(advance(1, -3)).toBe(22);
    expect(monopolySpace(0).kind).toBe("start");
    expect(monopolySpace(6).kind).toBe("jail");
    expect(monopolySpace(12).kind).toBe("rest");
    expect(monopolySpace(18).kind).toBe("gotojail");
  });

  it("has sixteen properties in eight groups of two", () => {
    const properties = MONOPOLY_SPACES.filter((space) => space.kind === "property");

    expect(properties).toHaveLength(16);

    for (let group = 0; group < 8; group += 1)
      expect(properties.filter((space) => space.group === group)).toHaveLength(2);
  });
});

describe("Monopoly turns", () => {
  it("moves, buys an unowned space and charges the price", () => {
    rigDice([1, 2]);
    const state = table({ position: [1, 0] });

    expect(act(state, "p1", "roll").ok).toBe(true);
    expect(state.position[0]).toBe(4);
    expect(state.turnState.phase).toBe("buy");

    expect(act(state, "p1", "buy").ok).toBe(true);
    expect(state.owners[4]).toBe(0);
    expect(state.cash[0]).toBe(MONOPOLY_START_CASH - 100);
    expect(state.turnState.currentPlayerId).toBe("p2");
  });

  it("skips the purchase and moves on", () => {
    rigDice([1, 2]);
    const state = table({ position: [1, 0] });

    act(state, "p1", "roll");
    expect(act(state, "p1", "skip").ok).toBe(true);
    expect(state.owners[4]).toBeNull();
    expect(state.turnState.currentPlayerId).toBe("p2");
  });

  it("collects 200 when passing the start", () => {
    rigDice([5, 4]);
    const state = table({ position: [20, 0] });

    act(state, "p1", "roll");

    expect(state.position[0]).toBe(5);
    expect(state.cash[0]).toBe(MONOPOLY_START_CASH + 200);
  });

  it("pays rent automatically, doubled on a full group", () => {
    rigDice([1, 2]);
    const single = table({ position: [1, 0], owners: { 4: 1 } });

    act(single, "p1", "roll");
    expect(single.cash[0]).toBe(MONOPOLY_START_CASH - 10);

    const full = table({ position: [1, 0], owners: { 4: 1, 5: 1 } });

    act(full, "p1", "roll");
    expect(full.cash[0]).toBe(MONOPOLY_START_CASH - 20);
  });

  it("sends a third double to jail instead of moving", () => {
    rigDice([2, 2, 2, 2, 2, 2]);
    const state = table({ position: [5, 0] });

    // Two doubles keep the dice; the third sends the token to jail.
    act(state, "p1", "roll");
    act(state, "p1", "roll");
    act(state, "p1", "skip");

    expect(state.turnState.phase).toBe("roll");

    act(state, "p1", "roll");

    expect(state.jail[0]).toBe(true);
    expect(state.position[0]).toBe(monopolySpace(6).index);
    expect(state.turnState.phase).toBe("end");
  });

  it("refuses to end a turn with a double pending", () => {
    rigDice([2, 2]);
    const state = table({ position: [5, 0] });

    act(state, "p1", "roll");

    expect(state.turnState.phase).toBe("roll");
    expect(act(state, "p1", "end")).toMatchObject({ ok: false });
  });
});

describe("Monopoly jail", () => {
  it("pays the fine and rolls again", () => {
    const state = table({ position: [6, 0], jail: [true, false] });

    expect(act(state, "p1", "pay").ok).toBe(true);
    expect(state.jail[0]).toBe(false);
    expect(state.cash[0]).toBe(MONOPOLY_START_CASH - 50);
    expect(state.turnState.phase).toBe("roll");
  });

  it("frees a seat that rolls doubles, with no extra roll", () => {
    rigDice([3, 3]);
    const state = table({ position: [6, 0], jail: [true, false] });

    act(state, "p1", "roll");

    expect(state.jail[0]).toBe(false);
    expect(state.position[0]).toBe(12);
    expect(state.turnState.currentPlayerId).toBe("p2");
  });

  it("charges the fine on the third failed attempt and still moves", () => {
    rigDice([1, 2]);
    const state = table({ position: [6, 0], jail: [true, false], jailTurns: [2, 0] });

    act(state, "p1", "roll");

    expect(state.jail[0]).toBe(false);
    // The fine, then the 100 tax on the space the roll reached.
    expect(state.cash[0]).toBe(MONOPOLY_START_CASH - 50 - 100);
    expect(state.position[0]).toBe(9);
  });
});

describe("Monopoly building", () => {
  it("needs the whole group before a house", () => {
    const half = table({ owners: { 1: 0 } });
    const full = table({ owners: { 1: 0, 2: 0 } });

    expect(canBuild(half, 0, 1)).toBe(false);
    expect(canBuild(full, 0, 1)).toBe(true);

    expect(act(half, "p1", "build", { space: 1 })).toMatchObject({ ok: false });
    expect(act(full, "p1", "build", { space: 1 }).ok).toBe(true);
    expect(full.houses[1]).toBe(1);
    expect(full.cash[0]).toBe(MONOPOLY_START_CASH - 50);
  });

  it("raises the rent with every level", () => {
    const state = table({ owners: { 1: 0, 2: 0 }, houses: { 1: 2 } });

    expect(rentFor(state, 1)).toBe(90);
    expect(netWorth(state, 0)).toBe(MONOPOLY_START_CASH + 120 + 100);
  });

  it("stops at three levels", () => {
    const state = table({ owners: { 1: 0, 2: 0 }, houses: { 1: 3 } });

    expect(canBuild(state, 0, 1)).toBe(false);
  });
});

describe("Monopoly endings", () => {
  it("sells houses and properties before declaring bankruptcy", () => {
    rigDice([1, 2]);

    const state = table({
      position: [1, 0],
      cash: [10, MONOPOLY_START_CASH],
      owners: { 4: 1, 1: 0 },
      houses: { 4: 1, 1: 1 },
    });

    // Rent 50 against 10 cash: the house sells for 25, then the property for 30.
    act(state, "p1", "roll");

    expect(state.bankrupt[0]).toBe(false);
    expect(state.houses[1]).toBe(0);
    expect(state.owners[1]).toBeNull();

    const broke = table({
      position: [1, 0],
      cash: [5, MONOPOLY_START_CASH],
      owners: { 4: 1 },
      houses: { 4: 1 },
    });

    rigDice([1, 2]);
    act(broke, "p1", "roll");

    expect(broke.bankrupt[0]).toBe(true);
    expect(broke.status).toBe("ended");
    expect(broke.winner).toBe("p2");
  });

  it("gives the match to the richest seat when the clock runs out", () => {
    const state = table({ cash: [1000, 2000] });

    monopolyPlugin.onMatchTimeout?.(state, NOW);

    expect(state.status).toBe("ended");
    expect(state.winner).toBe("p2");
  });
});
