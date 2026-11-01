import { describe, expect, it } from "vitest";
import { wireValueSchema, type WireValue } from "@llmgames/game-catalog";
import { z } from "zod";

import { GoRoom } from "../../durable-objects/GoRoom";
import { AeroplaneRoom } from "../../durable-objects/AeroplaneRoom";
import { MonopolyRoom } from "../../durable-objects/MonopolyRoom";
import type { RoomRuntime } from "../../durable-objects/runtime";
import type { Env } from "../../types";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { SqliteRoomSql } from "../fixtures/sqlite-room";
import { roomTestEnv } from "../fixtures/room-env";
import { aeroplaneChoices } from "../../games/aeroplane/rules";
import { monopolyPlugin } from "../../games/monopoly/plugin";

/**
 * C2 behaviour, checked against the real rule modules and room adapters.
 *
 * Options are asserted where they change play, not just where they are stored:
 * a 13-line board must accept a 13th line, a 5-or-6 room must accept a five,
 * and a round-limited match must stop on assets.
 */

/** Exposes the persisted state so a test reads real fields instead of casting. */
class GoProbe extends GoRoom {
  /** The seat to move: `start()` draws the starter, so tests must ask. */
  toMove() {
    return this.gameState?.turnState.currentPlayerId ?? "host";
  }

  boardSize() {
    return this.gameState?.boardSize;
  }

  cellCount() {
    return this.gameState?.cells.length;
  }

  roomOptions() {
    return this.gameState?.roomOptions;
  }
}

class AeroplaneProbe extends AeroplaneRoom {
  takeoff() {
    return this.gameState?.takeoff;
  }
}

class MonopolyProbe extends MonopolyRoom {
  roundLimit() {
    return this.gameState?.roundLimit;
  }
}

type Probe = GoProbe | AeroplaneProbe | MonopolyProbe;

async function createRoom<R extends Probe>(
  Room: new (state: RoomRuntime, env: Env) => R,
  body: Record<string, WireValue>,
  runtime?: MemoryRoomRuntime,
) {
  const store = runtime ?? new MemoryRoomRuntime(new Map());

  if (!runtime) store.storage.sql = new SqliteRoomSql();

  const room = new Room(store, roomTestEnv());
  await store.initialized;

  const created = await room.fetch(
    new Request("https://room.test/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostId: "host", hostName: "Host", roomCode: "ABC234", ...body }),
    }),
  );

  return { room, runtime: store, created };
}

async function agentAction(room: Probe, body: Record<string, WireValue>) {
  const response = await room.fetch(
    new Request("https://room.test/agent/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

  const parsed = z.object({ ok: z.boolean() }).parse(wireValueSchema.parse(await response.json()));

  return { status: response.status, ok: parsed.ok };
}

async function joinAndStart(room: Probe) {
  const steps = [
    { path: "/agent/join", body: { playerId: "guest", assignedCodename: "SwiftAnchor" } },
    { path: "/agent/start", body: { playerId: "host" } },
  ];

  for (const step of steps) {
    const response = await room.fetch(
      new Request(`https://room.test${step.path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(step.body),
      }),
    );

    expect(response.ok).toBe(true);
  }
}

describe("go board size", () => {
  it("creates a 9-line board by default", async () => {
    const { room } = await createRoom(GoProbe, {});

    expect(room.boardSize()).toBe(9);
    expect(room.cellCount()).toBe(81);
    expect(room.roomOptions()).toEqual({ size: "9" });
  });

  it.each([
    ["13", 169],
    ["19", 361],
  ])("creates a %s-line board on request", async (size, cells) => {
    const { room, created } = await createRoom(GoProbe, { options: { size } });

    expect(created.ok).toBe(true);
    expect(room.boardSize()).toBe(Number(size));
    expect(room.cellCount()).toBe(cells);
    expect(room.roomOptions()).toEqual({ size });
  });

  it("refuses a board size the game does not offer", async () => {
    const { created, room } = await createRoom(GoProbe, { options: { size: "11" } });

    expect(created.status).toBe(400);
    expect(room.boardSize()).toBeUndefined();
  });

  it("accepts a move on the extra lines of a 13-line board", async () => {
    const { room } = await createRoom(GoProbe, { options: { size: "13" } });

    await joinAndStart(room);

    // Row/column 12 does not exist on 9 lines; it is the far corner on 13.
    const played = await agentAction(room, {
      playerId: room.toMove(),
      actionType: "place_go_stone",
      data: { row: 12, col: 12 },
    });

    expect(played.ok).toBe(true);
  });

  it("rejects that same move on a 9-line board", async () => {
    const { room } = await createRoom(GoProbe, {});

    await joinAndStart(room);

    const played = await agentAction(room, {
      playerId: room.toMove(),
      actionType: "place_go_stone",
      data: { row: 12, col: 12 },
    });

    expect(played.ok).toBe(false);
  });

  it("keeps the chosen size after the room restarts", async () => {
    const runtime = new MemoryRoomRuntime(new Map());

    const first = await createRoom(GoProbe, { options: { size: "19" } }, runtime);

    expect(first.room.boardSize()).toBe(19);

    // A wake on the same storage is what an isolate restart looks like.
    const revived = new GoProbe(runtime, roomTestEnv());
    await runtime.initialized;

    expect(revived.boardSize()).toBe(19);
    expect(revived.cellCount()).toBe(361);
    expect(revived.roomOptions()).toEqual({ size: "19" });
  });
});

describe("aeroplane take-off rule", () => {
  it("defaults to needing a six", async () => {
    const { room } = await createRoom(AeroplaneProbe, {});

    expect(room.takeoff()).toEqual([6]);
  });

  it("accepts a five when the room says 5 or 6", async () => {
    const { room } = await createRoom(AeroplaneProbe, { options: { takeoff: "56" } });

    expect(room.takeoff()).toEqual([5, 6]);
  });

  it("keeps the 5-or-6 rule through the start of the match", async () => {
    const { room } = await createRoom(AeroplaneProbe, { options: { takeoff: "56" } });

    await joinAndStart(room);

    expect(room.takeoff()).toEqual([5, 6]);
  });

  it("refuses an undeclared take-off rule", async () => {
    const { created } = await createRoom(AeroplaneProbe, { options: { takeoff: "4" } });

    expect(created.status).toBe(400);
  });

  it("lets a five launch a plane under the 5-or-6 rule and not under a six-only rule", () => {
    const table = { colours: [0, 1], planes: [[-1, -1, -1, -1]], roll: 5, sixes: 0 };

    expect(aeroplaneChoices({ ...table, takeoff: [5, 6] }, 0, 5)).not.toHaveLength(0);
    expect(aeroplaneChoices({ ...table, takeoff: [6] }, 0, 5)).toHaveLength(0);
  });
});

describe("monopoly round limit", () => {
  it("defaults to no round limit", async () => {
    const { room } = await createRoom(MonopolyProbe, {});

    expect(room.roundLimit()).toBe(0);
  });

  it("stores the requested limit", async () => {
    const { room } = await createRoom(MonopolyProbe, { options: { rounds: "20" } });

    expect(room.roundLimit()).toBe(20);
  });

  it("refuses an undeclared limit", async () => {
    const { created } = await createRoom(MonopolyProbe, { options: { rounds: "10" } });

    expect(created.status).toBe(400);
  });

  it("settles on assets when the last round ends", () => {
    const now = Date.now();

    const state = monopolyPlugin.createInitialState(
      { hostId: "a", hostName: "A", options: { rounds: "20" } },
      "ABC234",
      now,
    );

    state.players.push({ id: "b", name: "B" });
    monopolyPlugin.start(state, { firstPlayerIndex: 0, now });
    // `start` is the rule half of the transition; the platform flips status.
    state.status = "playing";

    // One turn short of twenty complete rounds for two seats.
    state.turns = 39;
    state.turnState.phase = "end";
    state.doubles = 0;
    state.cash = [1500, 900];

    const result = monopolyPlugin.applyAction(
      state,
      "a",
      { actionType: "end", data: {} },
      now + 1_000,
    );

    expect(result.ok).toBe(true);
    expect(state.status).toBe("ended");
    expect(state.rounds).toBe(20);
    expect(state.roundLimit).toBe(20);
    // The richer seat takes it; a tie would be a draw.
    expect(state.winner).toBe("a");

    const ended = (result.ok ? result.effects : []).find((effect) => effect.type === "match_ended");

    expect(ended).toEqual({ type: "match_ended", reason: "round_limit" });
  });

  it("plays on with no limit set", () => {
    const now = Date.now();

    const state = monopolyPlugin.createInitialState({ hostId: "a", hostName: "A" }, "ABC234", now);

    state.players.push({ id: "b", name: "B" });
    monopolyPlugin.start(state, { firstPlayerIndex: 0, now });
    state.status = "playing";

    state.turns = 39;
    state.turnState.phase = "end";
    state.doubles = 0;

    const result = monopolyPlugin.applyAction(
      state,
      "a",
      { actionType: "end", data: {} },
      now + 1_000,
    );

    expect(result.ok).toBe(true);
    expect(state.status).toBe("playing");
    expect(state.rounds).toBe(20);
  });
});
