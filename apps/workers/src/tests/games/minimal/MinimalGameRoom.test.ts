import { compactAgentDecisionState, type WireObject } from "@llmgames/game-catalog";
import { z } from "zod";
import { compactState } from "../../../games/agent-decision";

import { describe, expect, it, vi } from "vitest";

import { roomTestEnv } from "../../fixtures/room-env";
import { MemoryRoomRuntime, type MemoryRoomStorage } from "../../fixtures/memory-runtime";
import { MinimalGameRoom } from "../../fixtures/minimal-game/room";
import { MINIMAL_TARGET_POINTS, minimalGamePlugin } from "../../fixtures/minimal-game/plugin";

/**
 * M3.1 acceptance: a game defined only by a `GamePlugin` runs a whole match
 * through the real platform paths — HTTP create/join/start, socket-free agent
 * actions, projections, timers, persistence and replay — with no special case
 * anywhere in `BaseGameRoom`.
 */

const viewSchema = z.object({
  type: z.string(),
  status: z.string(),
  winner: z.string().nullable(),
  target: z.number(),
  scores: z.record(z.string(), z.number()),
  turnState: z.object({
    currentPlayerId: z.string().nullable(),
    turnNumber: z.number(),
    phase: z.string(),
    turnTimeRemaining: z.number(),
  }),
  you: z.object({
    playerId: z.string(),
    legalActions: z.array(z.string()),
    role: z.string().nullable().optional(),
    seat: z.number().nullable().optional(),
  }),
});

/** Browser projection additionally carries the viewer's private number. */
const browserSchema = viewSchema.extend({
  secrets: z.record(z.string(), z.number().nullable()),
});

const errorSchema = z.object({
  error: z.object({ message: z.string(), code: z.string().optional() }).optional(),
  replayed: z.boolean().optional(),
});

interface Harness {
  room: MinimalGameRoom;
  runtime: MemoryRoomRuntime;
  post: (path: string, body: WireObject) => Promise<Response>;
  view: (playerId: string) => Promise<z.output<typeof viewSchema>>;
  browser: (playerId: string) => z.output<typeof browserSchema>;
  ids: readonly [string, string];
}

async function roomHarness(values?: MemoryRoomStorage["values"]): Promise<Harness> {
  const runtime = new MemoryRoomRuntime(values);
  const room = new MinimalGameRoom(runtime, roomTestEnv());

  await runtime.initialized;

  const post = (path: string, body: WireObject) =>
    room.fetch(
      new Request(`https://minimal.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  const view = async (playerId: string) => {
    const response = await room.fetch(
      new Request(`https://minimal.test/agent/view?playerId=${encodeURIComponent(playerId)}`),
    );

    return viewSchema.parse((await response.json<{ state: object }>()).state);
  };

  // SAFETY: buildClientView always returns this game's projection; the schema
  // above is the single reader, so a shape change fails here instead of leaking.
  const browser = (playerId: string) => browserSchema.parse(room.browserForTest(playerId));

  return { room, runtime, post, view, browser, ids: ["host", "guest"] };
}

async function startedRoom(values?: MemoryRoomStorage["values"]): Promise<Harness> {
  const harness = await roomHarness(values);

  await harness.post("/create", {
    hostId: "host",
    hostName: "Host player",
    roomCode: "MNA234",
    turnTime: 30_000,
    gameTotalTime: 600_000,
  });
  await harness.post("/agent/join", { playerId: "guest", assignedCodename: "SwiftAnchor" });

  const started = await harness.post("/agent/start", { playerId: "host" });

  expect(started.status).toBe(200);

  return harness;
}

function currentPlayer(view: z.output<typeof viewSchema>): string {
  const playerId = view.turnState.currentPlayerId;

  if (!playerId) throw new Error("Fixture view has no current player");

  return playerId;
}

describe("Minimal plugin game", () => {
  it("creates a room, seats two distinct players and starts through the platform", async () => {
    const harness = await startedRoom();
    const host = await harness.view("host");
    const guest = await harness.view("guest");

    expect(host.type).toBe("minimal");
    expect(host.status).toBe("playing");
    expect(host.turnState.turnNumber).toBe(1);
    expect(host.you.playerId).toBe("host");
    expect(new Set([host.you.playerId, guest.you.playerId])).toEqual(new Set(["host", "guest"]));

    expect(harness.browser("host").you.seat).toBe(1);
    expect(harness.browser("guest").you.seat).toBe(2);
    expect(harness.browser("host").you.role).toBe("player1");
    expect(harness.browser("guest").you.role).toBe("player2");

    const first = currentPlayer(host);
    const second = first === "host" ? "guest" : "host";

    expect((await harness.view(first)).you.legalActions).toContain("stake");
    expect((await harness.view(second)).you.legalActions).not.toContain("stake");

    harness.room.stopForTest();
  });

  it("applies a legal stake and refuses invalid intents without touching the state", async () => {
    const harness = await startedRoom();
    const first = currentPlayer(await harness.view("host"));
    const second = first === "host" ? "guest" : "host";

    const accepted = await harness.post("/agent/action", {
      playerId: first,
      actionType: "stake",
      data: { points: 2 },
    });

    expect(accepted.status).toBe(200);
    expect((await harness.view(first)).scores[first]).toBe(2);

    const before = harness.room.snapshot().scores;

    const outOfTurn = await harness.post("/agent/action", {
      playerId: first,
      actionType: "stake",
      data: { points: 1 },
    });

    const tooMany = await harness.post("/agent/action", {
      playerId: second,
      actionType: "stake",
      data: { points: 9 },
    });

    const unknown = await harness.post("/agent/action", {
      playerId: second,
      actionType: "teleport",
      data: {},
    });

    expect(outOfTurn.status).toBe(409);
    expect(errorSchema.parse(await outOfTurn.json()).error?.message).toBe("Not your turn");
    expect(tooMany.status).toBe(400);
    expect(errorSchema.parse(await tooMany.json()).error?.message).toBe("Points must be integer 1–2");
    expect(unknown.status).toBe(400);
    expect(errorSchema.parse(await unknown.json()).error?.message).toBe("Unknown action: teleport");
    expect(harness.room.snapshot().scores).toEqual(before);

    harness.room.stopForTest();
  });

  it("hides every other player's hidden number from live projections", async () => {
    const harness = await startedRoom();
    const authoritative = harness.room.snapshot().secrets;

    expect(Object.keys(authoritative)).toHaveLength(2);

    for (const playerId of harness.ids) {
      const opponentId = playerId === "host" ? "guest" : "host";
      const browser = harness.browser(playerId);
      const agentState = JSON.stringify(await harness.view(playerId));

      expect(browser.secrets[playerId]).toBe(authoritative[playerId]);
      expect(browser.secrets).not.toHaveProperty(opponentId);
      expect(agentState).not.toContain('"secrets"');
    }

    harness.room.stopForTest();
  });

  it("passes the turn on a timeout and forfeits after three by the same player", async () => {
    const harness = await startedRoom();
    const first = currentPlayer(await harness.view("host"));
    const second = first === "host" ? "guest" : "host";
    const clock = vi.spyOn(Date, "now");
    let now = Date.now();
    let turns = harness.room.snapshot().turnState.turnNumber;

    clock.mockImplementation(() => now);

    try {
      now += 33_000;
      await harness.room.alarm();

      const afterOne = harness.room.snapshot();

      expect(afterOne.status).toBe("playing");
      expect(afterOne.turnState.currentPlayerId).toBe(second);
      expect(afterOne.turnState.turnNumber).toBe(turns + 1);
      expect(afterOne.timeouts[first]).toBe(1);

      // Every turn expires: the same player collects the third timeout first.
      for (let alarm = 0; alarm < 6 && harness.room.snapshot().status === "playing"; alarm++) {
        now += 33_000;
        await harness.room.alarm();
        turns++;
      }

      const final = harness.room.snapshot();

      expect(final.status).toBe("ended");
      expect(final.turnState.phase).toBe("ended");
      expect(final.turnState.currentPlayerId).toBeNull();
      expect(final.timeouts[first]).toBe(3);
      expect(final.timeouts[second]).toBe(2);
      expect(final.winner).toBe(second);
    } finally {
      harness.room.stopForTest();
      clock.mockRestore();
    }
  });

  it("ends at the target score and keeps a full-reveal replay", async () => {
    const harness = await startedRoom();
    const first = currentPlayer(await harness.view("host"));
    const second = first === "host" ? "guest" : "host";

    await harness.post("/agent/action", { playerId: first, actionType: "stake", data: { points: 2 } });
    await harness.post("/agent/action", { playerId: second, actionType: "stake", data: { points: 1 } });

    const final = await harness.post("/agent/action", {
      playerId: first,
      actionType: "stake",
      data: { points: 1 },
    });

    expect(final.status).toBe(200);

    const state = harness.room.snapshot();

    expect(state.scores[first]).toBe(MINIMAL_TARGET_POINTS);
    expect(state.status).toBe("ended");
    expect(state.winner).toBe(first);
    expect((await harness.view(first)).winner).toBe(first);

    const replay = z
      .object({
        status: z.string(),
        secrets: z.record(z.string(), z.number()),
        scores: z.record(z.string(), z.number()),
      })
      .parse(harness.room.rewatchForTest());

    expect(replay.status).toBe("ended");
    expect(Object.keys(replay.secrets).sort()).toEqual(["guest", "host"]);
    expect(replay.scores[first]).toBe(MINIMAL_TARGET_POINTS);

    harness.room.stopForTest();
  });

  it("restores the match from storage after the Durable Object restarts", async () => {
    const harness = await startedRoom();
    const first = currentPlayer(await harness.view("host"));

    await harness.post("/agent/action", { playerId: first, actionType: "stake", data: { points: 2 } });
    harness.room.stopForTest();

    const runtime = new MemoryRoomRuntime(harness.runtime.storage.values);
    const restarted = new MinimalGameRoom(runtime, roomTestEnv());

    await runtime.initialized;

    const restored = restarted.snapshot();

    expect(restored.status).toBe("playing");
    expect(restored.scores[first]).toBe(2);
    expect(restored.turnState.currentPlayerId).toBe(first === "host" ? "guest" : "host");

    const response = await restarted.fetch(
      new Request("https://minimal.test/agent/view?playerId=host"),
    );

    expect(viewSchema.parse((await response.json<{ state: object }>()).state).status).toBe("playing");

    restarted.stopForTest();
  });

  it("replays a repeated requestId instead of staking twice", async () => {
    const harness = await startedRoom();
    const first = currentPlayer(await harness.view("host"));

    const body = {
      playerId: first,
      actionType: "stake",
      data: { points: 2 },
      requestId: "minimal-request-1",
    };

    const original = await harness.post("/agent/action", body);
    const replay = await harness.post("/agent/action", body);

    expect(original.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(errorSchema.parse(await replay.json()).replayed).toBe(true);
    expect(harness.room.snapshot().scores[first]).toBe(2);

    harness.room.stopForTest();
  });

  it("refuses an outsider and offers nothing to a spectator", async () => {
    const harness = await startedRoom();

    const outsider = await harness.post("/agent/action", {
      playerId: "watcher",
      actionType: "stake",
      data: { points: 1 },
    });

    expect(outsider.status).toBe(403);
    expect(errorSchema.parse(await outsider.json()).error?.message).toContain("not in room");

    // The plugin honours the platform's spectator flag instead of trusting a seat.
    const state = harness.room.snapshot();
    const viewer = { isSpectator: true };

    expect(minimalGamePlugin.turnActions(state, state.hostId, viewer)).toEqual([]);
    expect(minimalGamePlugin.seatIdentity(state, state.hostId, viewer)).toEqual({
      seat: null,
      role: "spectator",
    });

    harness.room.stopForTest();
  });

  it("keeps the compact MCP decision state intact", async () => {
    const harness = await startedRoom();
    const view = await harness.view("host");
    const current = currentPlayer(view);

    const decision = z
      .object({
        gameType: z.string(),
        status: z.string(),
        legalActions: z.array(z.string()),
        turnNumber: z.number(),
      })
      .parse(compactState(await harness.view(current)));

    expect(decision.gameType).toBe("minimal");
    expect(decision.status).toBe("playing");
    expect(decision.turnNumber).toBe(1);
    expect(decision.legalActions.length).toBeGreaterThan(0);

    harness.room.stopForTest();
  });
});
