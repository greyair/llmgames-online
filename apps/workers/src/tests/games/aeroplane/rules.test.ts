import { afterEach, describe, expect, it, vi } from "vitest";

import { aeroplaneColours } from "../../../games/aeroplane/board";
import { aeroplanePlugin } from "../../../games/aeroplane/plugin";
import type { AeroplaneGameState } from "../../../durable-objects/types";

const NOW = 1_800_000_000_000;

const IDS = ["p1", "p2", "p3", "p4"];

const HANGAR = -1;

/**
 * A table in mid-play, so each case starts where the interesting rule fires.
 *
 * `planes` is indexed by seat then plane, exactly as the state carries it; the
 * dice are rigged per test because the platform rolls them with its CSPRNG.
 */
function table(options: {
  seats: number;
  planes: number[][];
  takeoff?: number[];
  roll?: number | null;
  sixes?: number;
  phase?: "roll" | "choose";
  toMove?: number;
}): AeroplaneGameState {
  const state = aeroplanePlugin.createInitialState({ hostId: "p1", hostName: "One" }, "AER234", NOW);

  state.maxPlayers = options.seats;
  state.players = IDS.slice(0, options.seats).map((id, index) => ({ id, name: `Player ${index}` }));
  state.status = "playing";
  state.seats = Object.fromEntries(IDS.slice(0, options.seats).map((id, index) => [id, index]));
  state.colours = aeroplaneColours(options.seats);
  state.planes = options.planes;
  state.takeoff = options.takeoff ?? [6];
  state.roll = options.roll ?? null;
  state.sixes = options.sixes ?? (options.roll === 6 ? 1 : 0);
  state.turnState = {
    currentPlayerId: IDS[options.toMove ?? 0]!,
    turnNumber: 1,
    phase: options.phase ?? (state.roll === null ? "roll" : "choose"),
    startedAt: NOW,
    turnTimeRemaining: 30_000,
  };

  return state;
}

/**
 * One row of hangars, for seats the case does not care about.
 *
 * A factory rather than a constant: the rule module mutates the arrays it is
 * given, so a shared row would leak one test's board into the next.
 */
const parked = () => [HANGAR, HANGAR, HANGAR, HANGAR];

/**
 * Forces the next die rolls.
 *
 * `randomInt` draws a uint32 by rejection sampling and takes the remainder, so
 * writing the face minus one into the buffer fixes the result without touching
 * anything the production path does differently.
 */
function rigDice(faces: readonly number[]) {
  let index = 0;

  return vi.spyOn(crypto, "getRandomValues").mockImplementation(
    // SAFETY: the room only reads a Uint32Array back, and a face minus one is a
    // draw it could have made; nothing else about the signature changes.
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

function roll(state: AeroplaneGameState, seat = 0) {
  return aeroplanePlugin.applyAction(state, IDS[seat]!, { actionType: "roll", data: null }, NOW);
}

function play(state: AeroplaneGameState, plane: number, actionType = "move_plane", seat = 0) {
  return aeroplanePlugin.applyAction(
    state,
    IDS[seat]!,
    { actionType, data: { plane } },
    NOW,
  );
}

describe("Aeroplane colours", () => {
  it("uses opposite corners for two seats and every corner beyond", () => {
    expect(aeroplaneColours(2)).toEqual([0, 2]);
    expect(aeroplaneColours(3)).toEqual([0, 1, 2]);
    expect(aeroplaneColours(4)).toEqual([0, 1, 2, 3]);
  });
});

describe("Aeroplane take-off", () => {
  it("clears the hangar on a six and nowhere else", () => {
    const dice = rigDice([5]);

    const state = table({ seats: 2, planes: [[5, HANGAR, HANGAR, HANGAR], parked()] });

    expect(roll(state)).toMatchObject({ ok: true });
    // A five leaves every hangar shut, so only the plane already out may move.
    expect(aeroplanePlugin.turnActions(state, "p1", { isSpectator: false })).toEqual([
      "move_plane",
    ]);
    expect(play(state, 2, "launch_plane")).toMatchObject({
      ok: false,
      message: "A plane leaves the hangar on a 6",
    });
    expect(dice).toHaveBeenCalledTimes(1);
  });

  it("puts a launched plane on the take-off square", () => {
    rigDice([6]);
    const state = table({ seats: 2, planes: [parked(), parked()] });

    expect(roll(state)).toMatchObject({ ok: true });
    expect(state.turnState.phase).toBe("choose");
    expect(play(state, 2, "launch_plane")).toMatchObject({ ok: true });
    expect(state.planes[0]).toEqual([HANGAR, 0, HANGAR, HANGAR]);
  });

  it("refuses to launch a plane that has already taken off", () => {
    const state = table({
      seats: 2,
      planes: [[10, HANGAR, HANGAR, HANGAR], parked()],
      roll: 3,
      phase: "choose",
    });

    expect(play(state, 1, "launch_plane", 0)).toMatchObject({
      ok: false,
      message: "Plane 1 has already taken off; move it instead",
    });
  });

  it("refuses to move a plane that is still in the hangar", () => {
    const state = table({
      seats: 2,
      planes: [[10, HANGAR, HANGAR, HANGAR], parked()],
      roll: 6,
      phase: "choose",
    });

    expect(play(state, 2, "move_plane", 0)).toMatchObject({
      ok: false,
      message: "Plane 2 is in the hangar; launch it instead",
    });
  });
});

describe("Aeroplane movement", () => {
  it("jumps to the next square of its own colour", () => {
    rigDice([2]);
    const state = table({ seats: 2, planes: [[2, HANGAR, HANGAR, HANGAR], parked()] });

    expect(roll(state)).toMatchObject({ ok: true });
    expect(play(state, 1)).toMatchObject({ ok: true });
    expect(state.planes[0]![0]).toBe(8);
  });

  it("does not jump from the entrance into the home column", () => {
    rigDice([3]);
    const state = table({ seats: 2, planes: [[49, HANGAR, HANGAR, HANGAR], parked()] });

    expect(roll(state)).toMatchObject({ ok: true });
    expect(play(state, 1)).toMatchObject({ ok: true });
    expect(state.planes[0]![0]).toBe(52);
  });

  it("flies the shortcut from its own step 20", () => {
    rigDice([3]);
    const state = table({ seats: 2, planes: [[17, HANGAR, HANGAR, HANGAR], parked()] });

    expect(roll(state)).toMatchObject({ ok: true });
    expect(play(state, 1)).toMatchObject({ ok: true });
    expect(state.planes[0]![0]).toBe(32);
    expect(state.lastMove).toMatchObject({ jump: null, fly: 32 });
  });

  it("chains one jump then one fly, never two of either", () => {
    rigDice([2]);
    const state = table({ seats: 2, planes: [[14, HANGAR, HANGAR, HANGAR], parked()] });

    expect(roll(state)).toMatchObject({ ok: true });
    expect(play(state, 1)).toMatchObject({ ok: true });
    expect(state.planes[0]![0]).toBe(32);
    expect(state.lastMove).toMatchObject({ jump: 20, fly: 32 });
  });

  it("sends every rival sharing the landing square back to their hangars", () => {
    rigDice([2]);

    // Seat 0 step 7 is the same square as colour 2's step 33.
    const state = table({
      seats: 2,
      planes: [[5, HANGAR, HANGAR, HANGAR], [33, 33, 10, HANGAR]],
    });

    expect(roll(state)).toMatchObject({ ok: true });
    const result = play(state, 1);

    expect(result.ok).toBe(true);
    expect(state.planes[1]).toEqual([HANGAR, HANGAR, 10, HANGAR]);
    expect(state.planes[0]![0]).toBe(7);
    expect(state.lastMove?.captures).toEqual([{ seat: 1, planes: [1, 2] }]);
  });

  it("never captures its own planes sharing a square", () => {
    rigDice([2]);
    const state = table({ seats: 2, planes: [[5, 7, HANGAR, HANGAR], parked()] });

    expect(roll(state)).toMatchObject({ ok: true });
    expect(play(state, 1)).toMatchObject({ ok: true });
    expect(state.planes[0]).toEqual([7, 7, HANGAR, HANGAR]);
  });

  it("bounces back from the centre and only lands there exactly", () => {
    rigDice([3]);
    let state = table({ seats: 2, planes: [[56, 57, HANGAR, HANGAR], parked()] });

    expect(roll(state)).toMatchObject({ ok: true });
    expect(play(state, 1)).toMatchObject({ ok: true });
    expect(state.planes[0]![0]).toBe(59);
    expect(state.lastMove).toMatchObject({ home: true, bounce: false });

    rigDice([5]);
    state = table({ seats: 2, planes: [[57, HANGAR, HANGAR, HANGAR], parked()] });
    expect(roll(state)).toMatchObject({ ok: true });
    expect(play(state, 1)).toMatchObject({ ok: true });
    expect(state.planes[0]![0]).toBe(56);
    expect(state.lastMove?.bounce).toBe(true);
  });

  it("does not jump inside the home column", () => {
    rigDice([3]);
    const state = table({ seats: 2, planes: [[53, HANGAR, HANGAR, HANGAR], parked()] });

    expect(roll(state)).toMatchObject({ ok: true });
    expect(play(state, 1)).toMatchObject({ ok: true });
    expect(state.planes[0]![0]).toBe(56);
  });
});

describe("Aeroplane sixes", () => {
  it("keeps the dice for the same seat after a six", () => {
    rigDice([6, 2]);
    const state = table({ seats: 2, planes: [[1, HANGAR, HANGAR, HANGAR], parked()] });

    expect(roll(state)).toMatchObject({ ok: true });
    expect(play(state, 1)).toMatchObject({ ok: true });
    expect(state.planes[0]![0]).toBe(7);
    expect(state.turnState.currentPlayerId).toBe("p1");
    expect(state.turnState.phase).toBe("roll");

    expect(roll(state)).toMatchObject({ ok: true });
    expect(play(state, 1)).toMatchObject({ ok: true });
    expect(state.planes[0]![0]).toBe(9);
    expect(state.turnState.currentPlayerId).toBe("p2");
  });

  it("sends the chosen plane home on the third six and ends the turn", () => {
    rigDice([6, 6, 6]);
    const state = table({ seats: 2, planes: [[1, 30, HANGAR, HANGAR], parked()] });

    expect(roll(state)).toMatchObject({ ok: true });
    expect(play(state, 1)).toMatchObject({ ok: true });
    expect(state.planes[0]![0]).toBe(7);

    expect(roll(state)).toMatchObject({ ok: true });
    expect(play(state, 1)).toMatchObject({ ok: true });
    expect(state.planes[0]![0]).toBe(13);

    expect(roll(state)).toMatchObject({ ok: true });
    expect(state.sixes).toBe(3);
    expect(play(state, 1)).toMatchObject({ ok: true });
    expect(state.planes[0]![0]).toBe(HANGAR);
    expect(state.turnState.currentPlayerId).toBe("p2");
  });
});

describe("Aeroplane turns", () => {
  it("passes to the next seat when nothing can move", () => {
    rigDice([4]);
    const state = table({ seats: 3, planes: [parked(), parked(), parked()] });

    expect(roll(state)).toMatchObject({ ok: true });
    expect(state.turnState.currentPlayerId).toBe("p2");
    expect(state.turnState.phase).toBe("roll");
    expect(state.roll).toBeNull();
  });

  it("rolls again when a six cannot be used yet", () => {
    rigDice([6]);
    const state = table({ seats: 2, planes: [[59, 59, 59, 59], parked()] });

    expect(roll(state)).toMatchObject({ ok: true });
    expect(state.turnState.currentPlayerId).toBe("p1");
    expect(state.turnState.phase).toBe("roll");
    expect(state.sixes).toBe(1);
  });

  it("turns go round in seat order", () => {
    rigDice([1, 2, 3, 4, 5, 6]);
    const state = table({ seats: 4, planes: [parked(), parked(), parked(), parked()] });
    const order: (string | null)[] = [];

    for (let index = 0; index < 4; index += 1) {
      const current = state.turnState.currentPlayerId;
      const seat = state.seats[current ?? ""] ?? 0;

      order.push(current);
      expect(roll(state, seat)).toMatchObject({ ok: true });
      // Nobody can use these rolls, so every turn passes on without a choice.
      expect(state.turnState.phase).toBe("roll");
    }

    expect(order).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("forfeits the roll on a turn timeout without moving anything", () => {
    rigDice([3]);
    const state = table({ seats: 2, planes: [[5, HANGAR, HANGAR, HANGAR], parked()] });

    expect(roll(state)).toMatchObject({ ok: true });

    const before = [...state.planes[0]!];
    const effects = aeroplanePlugin.onTurnTimeout?.(state, "p1", NOW + 30_000) ?? [];

    expect(
      effects.map((effect) => (effect.type === "event" ? effect.event : effect.type)),
    ).toContain("turn_timeout");
    expect(state.planes[0]).toEqual(before);
    expect(state.roll).toBeNull();
    expect(state.sixes).toBe(0);
    expect(state.turnState.currentPlayerId).toBe("p2");
    expect(state.turnState.phase).toBe("roll");
  });
});

describe("Aeroplane endings", () => {
  it("wins when the fourth plane reaches home", () => {
    rigDice([4]);

    const state = table({
      seats: 2,
      planes: [[59, 59, 55, 59], [59, 59, 3, HANGAR]],
    });

    expect(roll(state)).toMatchObject({ ok: true });

    const result = play(state, 3);

    expect(result.ok).toBe(true);
    expect(state.status).toBe("ended");
    expect(state.winner).toBe("p1");
    expect(state.turnState.phase).toBe("ended");
    expect(state.planes[0]).toEqual([59, 59, 59, 59]);

    if (!result.ok) return;

    expect(result.effects.map((effect) => effect.type)).toContain("match_ended");
  });

  it("refuses actions once the match is over", () => {
    const state = table({ seats: 2, planes: [parked(), parked()] });

    state.status = "ended";
    state.turnState.phase = "ended";

    expect(roll(state)).toMatchObject({ ok: false, message: "Game is not playing" });
  });
});

describe("Aeroplane intent validation", () => {
  it("requires a roll before a plane is chosen", () => {
    const state = table({ seats: 2, planes: [[10, HANGAR, HANGAR, HANGAR], parked()] });

    expect(play(state, 1)).toMatchObject({ ok: false, message: "Roll the dice first" });
  });

  it("refuses a second roll while a plane is owed", () => {
    const state = table({ seats: 2, planes: [[10, HANGAR, HANGAR, HANGAR], parked()], roll: 3, phase: "choose" });

    expect(roll(state)).toMatchObject({
      ok: false,
      message: "You already rolled a 3; choose a plane",
    });
  });

  it("refuses a plane number outside 1-4 and a seat that is not the table", () => {
    const state = table({ seats: 2, planes: [[10, HANGAR, HANGAR, HANGAR], parked()], roll: 3, phase: "choose" });

    expect(play(state, 5)).toMatchObject({
      ok: false,
      message: "Plane number must be 1-4",
    });
    expect(play(state, 2, "move_plane", 1)).toMatchObject({ ok: false, message: "Not your turn" });
  });

  it("refuses a plane that is already home", () => {
    const state = table({ seats: 2, planes: [[59, HANGAR, HANGAR, HANGAR], parked()], roll: 3, phase: "choose" });

    expect(play(state, 1)).toMatchObject({ ok: false, message: "Plane 1 is already home" });
  });

  it("refuses an unknown action", () => {
    const state = table({ seats: 2, planes: [parked(), parked()] });

    expect(
      aeroplanePlugin.applyAction(state, "p1", { actionType: "taxi", data: null }, NOW),
    ).toMatchObject({ ok: false, message: "Unknown action: taxi" });
  });
});
