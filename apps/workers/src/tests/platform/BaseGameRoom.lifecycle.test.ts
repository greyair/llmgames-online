import { roomTestEnv } from "../fixtures/room-env";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import type { RoomSql } from "../../durable-objects/runtime";

import type { WireObject, WireValue } from "@llmgames/game-catalog";
import { z } from "zod";
import { TestRoomSocket } from "../fixtures/socket";

import { ROOM_INACTIVITY_MS, ROOM_LIFETIME_MS, TURN_TIME_MAX_MS } from "@llmgames/game-catalog";
import { describe, expect, it, vi } from "vitest";

import { BaseGameRoom, TURN_EXPIRY_GRACE_MS } from "../../durable-objects/BaseGameRoom";
import type { BaseGameState, Player } from "../../durable-objects/types";

class LifecycleTestRoom extends BaseGameRoom<BaseGameState> {
  snapshot() {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }

  protected readonly roomLabel = "LifecycleTestRoom";
  acceptedMoves = 0;
  failTimeout = false;
  protected onGameTimeout(): void {
    if (this.failTimeout) throw new Error("Scoring failed");
  }

  protected createDefaultState(
    config: {
      hostId: string;
      hostName: string;
      maxPlayers?: number;
      gameTotalTime?: number;
      turnTime?: number;
    },
    roomCode: string,
  ): BaseGameState {
    const now = Date.now();
    const gameTotalTime = config.gameTotalTime ?? 60_000;

    return {
      id: "lifecycle-room",
      roomCode,
      type: "test",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      spectators: [],
      hostId: config.hostId,
      maxPlayers: config.maxPlayers ?? 2,
      timerConfig: {
        gameTotalTime,
        turnTime: config.turnTime ?? 30_000,
      },
      gameTimeRemaining: gameTotalTime,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: config.turnTime ?? 30_000,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ROOM_LIFETIME_MS,
    };
  }

  protected async handleGameAction(
    _player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (payload.actionType === "move") {
      this.acceptedMoves++;

      return;
    }

    return `Unknown action: ${payload.actionType}`;
  }

  attachTestSession(ws: WebSocket, player: Player): void {
    this.sessions.set(ws, player);
  }

  protected restoreSessions(): void {
    // Tests inject the current in-memory socket set directly.
  }

  stopForTest(): void {
    this.stopTimers();
  }

  viewForTest() {
    return this.buildClientView("host");
  }
}

function createHarness(
  initialStorage: { gameState?: BaseGameState; lastMeaningfulActivityAt?: number } = {},
  sqlExec?: RoomSql["exec"],
) {
  const storage = new Map<string, unknown>(Object.entries(initialStorage));
  let alarmAt: number | null = null;
  let initialized = Promise.resolve<unknown>(undefined);

  const state = new MemoryRoomRuntime(storage, (at) => {
    alarmAt = at;
  });

  if (sqlExec) state.storage.sql = { exec: sqlExec };

  const newRoom = () => {
    const room = new LifecycleTestRoom(state, roomTestEnv());
    initialized = state.initialized;

    return { room, initialized };
  };

  const initial = newRoom();

  return {
    room: initial.room,
    initialized: initial.initialized,
    newRoom,
    storage,
    getAlarm: () => alarmAt,
  };
}

async function post<T>(room: LifecycleTestRoom, path: string, body: T): Promise<Response> {
  return room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function createRoom(room: LifecycleTestRoom, overrides: WireObject = {}): Promise<void> {
  const response = await post(room, "/create", {
    hostId: "host",
    hostName: "Host",
    roomCode: "ABC234",
    gameTotalTime: 4 * 60 * 60 * 1000,
    ...overrides,
  });

  expect(response.status).toBe(200);
}

describe("Durable Object room lifetime", () => {
  it("does not create SQLite history tables when an empty room is read or reconstructed", async () => {
    const sql = vi.fn(() => ({ toArray: () => [] }));
    const harness = createHarness({}, sql);
    await harness.initialized;
    expect((await harness.room.fetch(new Request("https://room.test/state"))).status).toBe(404);
    const restarted = harness.newRoom();
    await restarted.initialized;
    expect((await restarted.room.fetch(new Request("https://room.test/state"))).status).toBe(404);
    expect(sql).not.toHaveBeenCalled();
  });

  it("clears orphan storage without recreating a room", async () => {
    const harness = createHarness({ lastMeaningfulActivityAt: 123 });
    await harness.initialized;
    const response = await post(harness.room, "/maintenance/purge-empty", {});
    expect(response.status).toBe(200);
    expect(harness.storage.size).toBe(0);
    expect(harness.getAlarm()).toBeNull();
    expect((await harness.room.fetch(new Request("https://room.test/state"))).status).toBe(404);
  });

  it("refuses maintenance deletion of a room with game state", async () => {
    const harness = createHarness();
    await harness.initialized;
    await createRoom(harness.room);
    const before = structuredClone(harness.storage.get("gameState"));
    const alarm = harness.getAlarm();
    expect((await post(harness.room, "/maintenance/purge-empty", {})).status).toBe(409);
    expect(harness.storage.get("gameState")).toEqual(before);
    expect(harness.getAlarm()).toBe(alarm);
  });

  it("can create the same room repeatedly after each expired instance is purged", async () => {
    const harness = createHarness();
    const clock = vi.spyOn(Date, "now");

    try {
      let now = Date.now();

      for (let cycle = 0; cycle < 3; cycle++) {
        clock.mockReturnValue(now);
        await createRoom(harness.room);
        const state = harness.room.snapshot();
        expect(state.roomCode).toBe("ABC234");
        now = state.expiresAt + 1;
        clock.mockReturnValue(now);
        await harness.room.alarm();
        await vi.waitFor(() => expect(harness.storage.size).toBe(0));
        expect((await harness.room.fetch(new Request("https://room.test/state"))).status).toBe(404);
      }

      await createRoom(harness.room);
      expect((await harness.room.fetch(new Request("https://room.test/state"))).status).toBe(200);
    } finally {
      clock.mockRestore();
    }
  });

  it("caps direct room creation at the shared maximum turn time", async () => {
    const harness = createHarness();
    await createRoom(harness.room, { turnTime: 10 * 60 * 1000 });

    const stored = harness.room.snapshot();
    expect(stored.timerConfig.turnTime).toBe(TURN_TIME_MAX_MS);
    expect(stored.turnState.turnTimeRemaining).toBe(TURN_TIME_MAX_MS);
  });

  it("subtracts elapsed wall time when a playing room is restored", async () => {
    const checkpoint = new Date("2026-08-24T00:00:00.000Z").getTime();
    const elapsed = 12_345;

    const persisted: BaseGameState = {
      id: "restored-room",
      roomCode: "RST234",
      type: "test",
      status: "playing",
      players: [
        { id: "host", name: "Host" },
        { id: "guest", name: "Guest" },
      ],
      spectators: [],
      hostId: "host",
      maxPlayers: 2,
      timerConfig: { gameTotalTime: 60_000, turnTime: 30_000 },
      gameTimeRemaining: 50_000,
      turnState: {
        currentPlayerId: "host",
        turnNumber: 1,
        phase: "play",
        startedAt: checkpoint - 10_000,
        turnTimeRemaining: 20_000,
      },
      createdAt: checkpoint - 60_000,
      updatedAt: checkpoint,
      expiresAt: checkpoint + ROOM_LIFETIME_MS,
    };

    const clock = vi.spyOn(Date, "now").mockReturnValue(checkpoint + elapsed);

    const harness = createHarness({
      gameState: persisted,
      lastMeaningfulActivityAt: checkpoint,
    });

    await harness.initialized;

    const restored = harness.room.snapshot();
    expect(restored.gameTimeRemaining).toBe(50_000 - elapsed);
    expect(restored.turnState.turnTimeRemaining).toBe(20_000 - elapsed);

    harness.room.stopForTest();
    const restartedAgain = harness.newRoom();
    await restartedAgain.initialized;
    const restoredAgain = restartedAgain.room.snapshot();
    expect(restoredAgain.gameTimeRemaining).toBe(50_000 - elapsed);
    expect(restoredAgain.turnState.turnTimeRemaining).toBe(20_000 - elapsed);

    await post(restartedAgain.room, "/agent/action", {
      playerId: "host",
      actionType: "end_game",
      data: {},
    });
    clock.mockRestore();
  });

  it.each([false, true])(
    "settles match deadlines even when local ticks stop and scoring fails=%s",
    async (failTimeout) => {
      const harness = createHarness();
      await createRoom(harness.room, { gameTotalTime: 60_000, turnTime: 150_000 });
      await post(harness.room, "/agent/join", {
        playerId: "guest",
        assignedCodename: "SwiftAnchor",
      });
      await post(harness.room, "/agent/start", { playerId: "host" });
      harness.room.failTimeout = failTimeout;
      const alarmAt = harness.getAlarm()!;
      expect(alarmAt).toBeLessThanOrEqual(Date.now() + 60_000);
      const clock = vi.spyOn(Date, "now").mockReturnValue(alarmAt + 1);

      try {
        await harness.room.alarm();

        const final = await harness.room.fetch(
          new Request("https://room.test/agent/view?playerId=host"),
        );

        expect(await final.json()).toMatchObject({ state: { status: "ended" } });
        expect(harness.room.snapshot().status).toBe("ended");
      } finally {
        harness.room.stopForTest();
        clock.mockRestore();
      }
    },
  );

  it("settles a turn from its durable alarm without renewing player activity", async () => {
    const harness = createHarness();
    await createRoom(harness.room, { gameTotalTime: 120_000, turnTime: 30_000 });
    await post(harness.room, "/agent/join", { playerId: "guest", assignedCodename: "SwiftAnchor" });
    await post(harness.room, "/agent/start", { playerId: "host" });
    const activity = harness.storage.get("lastMeaningfulActivityAt");
    const turn = harness.room.snapshot().turnState.turnNumber;
    const clock = vi.spyOn(Date, "now").mockReturnValue(harness.getAlarm()! + 1);

    try {
      await harness.room.alarm();
      expect(harness.room.snapshot().turnState.turnNumber).toBe(turn + 1);
      expect(harness.storage.get("lastMeaningfulActivityAt")).toBe(activity);
      expect(harness.getAlarm()).toBeGreaterThan(Date.now());
    } finally {
      harness.room.stopForTest();
      clock.mockRestore();
    }
  });

  it("does not create an unregistered room through WebSocket upgrade", async () => {
    const harness = createHarness();

    const response = await harness.room.fetch(
      new Request("https://room.test/ws?roomCode=ABC234", {
        headers: {
          Upgrade: "websocket",
          "x-user-id": "host",
          "x-user-name": "Host",
        },
      }),
    );

    expect(response.status).toBe(404);
    await vi.waitFor(() => expect(harness.storage.size).toBe(0));
  });

  it("schedules inactivity cleanup after five minutes and caps room lifetime", async () => {
    const harness = createHarness();
    await createRoom(harness.room);

    const stored = harness.room.snapshot();
    expect(stored.expiresAt).toBe(stored.createdAt + ROOM_LIFETIME_MS);
    expect(harness.getAlarm()).toBe(stored.createdAt + ROOM_INACTIVITY_MS);
    expect(stored.timerConfig.gameTotalTime).toBe(ROOM_LIFETIME_MS);
    expect(stored.gameTimeRemaining).toBe(ROOM_LIFETIME_MS);
  });

  it("purges an inactive waiting lobby when its five-minute alarm fires", async () => {
    const harness = createHarness();
    await createRoom(harness.room);

    const clock = vi.spyOn(Date, "now").mockReturnValue(harness.getAlarm()!);

    try {
      await harness.room.alarm();
    } finally {
      clock.mockRestore();
    }

    await vi.waitFor(() => expect(harness.storage.size).toBe(0));
    expect(harness.getAlarm()).toBeNull();

    const stateResponse = await harness.room.fetch(new Request("https://room.test/state"));

    expect(stateResponse.status).toBe(404);
  });

  it("purges an inactive waiting lobby even with a hibernatable browser socket", async () => {
    const harness = createHarness();
    await createRoom(harness.room);
    const stored = harness.room.snapshot();
    const sent: string[] = [];

    const ws = Object.assign(new TestRoomSocket(), {
      readyState: WebSocket.OPEN,
      send: vi.fn((message: string) => sent.push(message)),
      close: vi.fn(),
    });

    harness.room.attachTestSession(ws, {
      id: "host",
      name: "Host",
      socket: ws,
      isConnected: true,
      joinedAt: stored.createdAt,
    });

    const idleClock = vi.spyOn(Date, "now").mockReturnValue(harness.getAlarm()!);

    try {
      await harness.room.alarm();
    } finally {
      idleClock.mockRestore();
    }

    expect(harness.storage.size).toBeGreaterThan(0);
    expect(ws.close).not.toHaveBeenCalled();
    expect(JSON.parse(sent.at(-1)!)).toMatchObject({
      type: "game_ended",
      payload: {
        reason: "room_inactive",
        finalState: { status: "ended" },
      },
    });

    await harness.room.webSocketMessage(ws, JSON.stringify({ type: "rewatch_saved" }));
    await vi.waitFor(() => expect(harness.storage.size).toBe(0));
    expect(harness.getAlarm()).toBeNull();
    expect(ws.close).toHaveBeenCalledWith(1000, "Final state saved");
  });

  it("does not renew inactivity when an MCP agent checks state", async () => {
    const harness = createHarness();
    await createRoom(harness.room);
    const firstAlarm = harness.getAlarm()!;
    const activeAt = firstAlarm - 2 * 60 * 1000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(activeAt);

    try {
      const response = await harness.room.fetch(
        new Request("https://room.test/agent/view?playerId=host"),
      );

      expect(response.status).toBe(200);
    } finally {
      clock.mockRestore();
    }

    expect(harness.getAlarm()).toBe(firstAlarm);
  });

  it("does not renew inactivity when an already-seated MCP agent rejoins", async () => {
    const harness = createHarness();
    await createRoom(harness.room);

    const joinBody = {
      playerId: "host",
      assignedCodename: "SwiftAnchor",
    };

    expect((await post(harness.room, "/agent/join", joinBody)).status).toBe(200);
    const firstAlarm = harness.getAlarm()!;

    const retryAt = firstAlarm - 60_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(retryAt);

    try {
      expect((await post(harness.room, "/agent/join", joinBody)).status).toBe(200);
    } finally {
      clock.mockRestore();
    }

    expect(harness.getAlarm()).toBe(firstAlarm);
  });

  it("does not renew inactivity when wait_for_turn times out", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-08-23T00:00:00Z"));
      const harness = createHarness();
      await createRoom(harness.room);
      const firstAlarm = harness.getAlarm();

      const waiting = post(harness.room, "/agent/wait-turn", {
        playerId: "host",
        timeoutMs: 1_000,
      });

      await vi.advanceTimersByTimeAsync(1_000);

      expect(await (await waiting).json()).toEqual({
        timedOut: true,
        reason: "timeout",
        revision: 0,
      });
      expect(harness.getAlarm()).toBe(firstAlarm);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends an open wait_for_turn request when inactivity expires", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-08-23T00:00:00Z"));
      const harness = createHarness();
      await createRoom(harness.room);
      const inactivityAlarm = harness.getAlarm()!;

      vi.setSystemTime(inactivityAlarm - 1_000);

      const waiting = post(harness.room, "/agent/wait-turn", {
        playerId: "host",
        timeoutMs: 30_000,
      });

      await vi.advanceTimersByTimeAsync(0);

      vi.setSystemTime(inactivityAlarm);
      await harness.room.alarm();

      const result = await (
        await waiting
      ).json<{
        timedOut: boolean;
        reason: string;
      }>();

      expect(result.timedOut).toBe(false);
      expect(result.reason).toBe("ended");
      await vi.waitFor(() => expect(harness.storage.size).toBe(0));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the original host seat without treating disconnect as activity", async () => {
    const harness = createHarness();
    await createRoom(harness.room);
    const stored = harness.room.snapshot();
    const inactivityAlarm = harness.getAlarm();
    const ws = new TestRoomSocket();

    const host: Player = {
      id: "host",
      name: "Host",
      socket: ws,
      isConnected: true,
      joinedAt: stored.createdAt,
    };

    harness.room.attachTestSession(ws, host);
    const disconnectedAt = stored.createdAt + 60_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(disconnectedAt);

    try {
      await harness.room.webSocketClose(ws);
    } finally {
      clock.mockRestore();
    }

    const afterDisconnect = harness.room.snapshot();
    expect(host.isConnected).toBe(false);
    expect(afterDisconnect.hostId).toBe("host");
    expect(afterDisconnect.players.map((seat) => seat.id)).toEqual(["host"]);
    expect(harness.getAlarm()).toBe(inactivityAlarm);
  });

  it("does not recreate storage after an explicit end action", async () => {
    const harness = createHarness();
    await createRoom(harness.room);

    const response = await post(harness.room, "/agent/action", {
      playerId: "host",
      actionType: "end_game",
      data: {},
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      state: { status: "ended" },
    });
    await vi.waitFor(() => expect(harness.storage.size).toBe(0));
    expect(harness.getAlarm()).toBeNull();
  });

  it("anchors clocks without periodic messages or storage writes and enforces the alarm deadline", async () => {
    vi.useFakeTimers();

    try {
      const harness = createHarness();
      await createRoom(harness.room, { turnTime: 30_000 });
      await post(harness.room, "/agent/join", {
        playerId: "guest",
        assignedCodename: "SwiftAnchor",
      });
      await post(harness.room, "/agent/start", { playerId: "host" });

      const first = z
        .object({
          clock: z
            .object({ serverTime: z.number(), gameEndsAt: z.number(), turnEndsAt: z.number() })
            .passthrough(),
        })
        .passthrough()
        .parse(harness.room.viewForTest());

      expect(first.clock.turnEndsAt - first.clock.serverTime).toBe(30_000);

      const ws = Object.assign(new TestRoomSocket(), {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        close: vi.fn(),
      });

      harness.room.attachTestSession(ws, {
        id: "host",
        name: "Host",
        isConnected: true,
        joinedAt: Date.now(),
      });
      const persistedAt = harness.room.snapshot().updatedAt;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(ws.send).not.toHaveBeenCalled();
      expect(harness.room.snapshot().updatedAt).toBe(persistedAt);
      expect(harness.room.viewForTest()).toMatchObject({
        gameTimeRemaining: first.clock.gameEndsAt - first.clock.serverTime - 20_000,
        clock: { gameEndsAt: first.clock.gameEndsAt, turnEndsAt: first.clock.turnEndsAt },
      });
      vi.setSystemTime(first.clock.turnEndsAt);
      await harness.room.alarm();
      expect(
        z
          .object({ turnState: z.object({ turnNumber: z.number() }).passthrough() })
          .passthrough()
          .parse(harness.room.viewForTest()).turnState.turnNumber,
      ).toBe(1);
      vi.setSystemTime(first.clock.turnEndsAt + TURN_EXPIRY_GRACE_MS);
      await harness.room.alarm();
      expect(
        z
          .object({ turnState: z.object({ turnNumber: z.number() }).passthrough() })
          .passthrough()
          .parse(harness.room.viewForTest()).turnState.turnNumber,
      ).toBe(2);
      expect(harness.room.viewForTest()).toMatchObject({
        clock: {
          gameEndsAt: first.clock.gameEndsAt,
          turnEndsAt: first.clock.turnEndsAt + TURN_EXPIRY_GRACE_MS + 30_000,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects removed pause controls and lets the host end a timed game", async () => {
    const harness = createHarness();
    await createRoom(harness.room);

    const joined = await post(harness.room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });

    expect(joined.status).toBe(200);

    const started = await post(harness.room, "/agent/start", {
      playerId: "host",
    });

    expect(started.status).toBe(200);
    expect(harness.getAlarm()).toBeLessThanOrEqual(Date.now() + 30_000 + TURN_EXPIRY_GRACE_MS);

    try {
      for (const actionType of ["pause_game", "resume_game"]) {
        const response = await post(harness.room, "/agent/action", {
          playerId: "host",
          actionType,
          data: {},
        });

        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    } finally {
      await post(harness.room, "/agent/action", {
        playerId: "host",
        actionType: "end_game",
        data: {},
      });
    }
  });

  it("accepts an otherwise legal action during the turn-expiry grace", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-08-26T00:00:00Z"));
      const harness = createHarness();
      await createRoom(harness.room, { turnTime: 30_000 });
      await post(harness.room, "/agent/join", {
        playerId: "guest",
        assignedCodename: "SwiftAnchor",
      });
      await post(harness.room, "/agent/start", { playerId: "host" });

      vi.setSystemTime(Date.now() + 30_001);

      const response = await post(harness.room, "/agent/action", {
        playerId: "host",
        actionType: "move",
        data: {},
      });

      expect(response.status).toBe(200);
      expect(harness.room.acceptedMoves).toBe(1);
      expect(harness.room.snapshot().turnState.currentPlayerId).toBe("host");
    } finally {
      vi.useRealTimers();
    }
  });

  it("adjudicates an expired turn after the grace before rejecting a stale action", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-08-26T00:00:00Z"));
      const harness = createHarness();
      await createRoom(harness.room, { turnTime: 30_000 });
      await post(harness.room, "/agent/join", {
        playerId: "guest",
        assignedCodename: "SwiftAnchor",
      });
      await post(harness.room, "/agent/start", { playerId: "host" });

      vi.setSystemTime(Date.now() + 30_000 + TURN_EXPIRY_GRACE_MS + 1);

      const response = await post(harness.room, "/agent/action", {
        playerId: "host",
        actionType: "move",
        data: {},
      });

      const body = await response.json<{
        error: { message: string };
        state: BaseGameState;
      }>();

      expect(response.status).not.toBe(200);
      expect(body.error.message).toBe("Action arrived after timer expired");
      expect(body.state.turnState.currentPlayerId).toBe("guest");
      expect(harness.room.acceptedMoves).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists an overall timeout before rejecting the late action", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-08-26T00:00:00Z"));
      const harness = createHarness();
      await createRoom(harness.room, {
        gameTotalTime: 5_000,
        turnTime: 10_000,
      });
      await post(harness.room, "/agent/join", {
        playerId: "guest",
        assignedCodename: "SwiftAnchor",
      });
      await post(harness.room, "/agent/start", { playerId: "host" });

      const ws = Object.assign(new TestRoomSocket(), {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        close: vi.fn(),
      });

      harness.room.attachTestSession(ws, {
        id: "host",
        name: "Host",
        socket: ws,
        isConnected: true,
        joinedAt: Date.now(),
      });

      vi.setSystemTime(Date.now() + 5_001);

      const response = await post(harness.room, "/agent/action", {
        playerId: "host",
        actionType: "move",
        data: {},
      });

      expect(response.status).not.toBe(200);

      const stored = harness.room.snapshot();
      expect(stored.status).toBe("ended");
      expect(stored.turnState.phase).toBe("ended");
      expect(stored.turnState.currentPlayerId).toBeNull();
      expect(harness.room.acceptedMoves).toBe(0);

      await harness.room.fetch(new Request("https://room.test/end", { method: "POST" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists normalized terminal state before waiting for rewatch acknowledgement", async () => {
    const harness = createHarness();
    await createRoom(harness.room);
    await post(harness.room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });
    await post(harness.room, "/agent/start", { playerId: "host" });

    const ws = Object.assign(new TestRoomSocket(), {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      close: vi.fn(),
    });

    harness.room.attachTestSession(ws, {
      id: "host",
      name: "Host",
      socket: ws,
      isConnected: true,
      joinedAt: Date.now(),
    });

    const response = await post(harness.room, "/agent/action", {
      playerId: "host",
      actionType: "end_game",
      data: {},
    });

    expect(response.status).toBe(200);

    const stored = harness.room.snapshot();
    expect(stored.status).toBe("ended");
    expect(stored.turnState.phase).toBe("ended");
    expect(stored.turnState.currentPlayerId).toBeNull();
    expect(ws.send).toHaveBeenCalled();

    await harness.room.fetch(new Request("https://room.test/end", { method: "POST" }));
  });

  it("renews inactivity after an accepted player action", async () => {
    const harness = createHarness();
    await createRoom(harness.room, { turnTime: TURN_TIME_MAX_MS });
    await post(harness.room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });
    await post(harness.room, "/agent/start", { playerId: "host" });

    const firstAlarm = harness.getAlarm()!;
    const actionAt = Date.now() + 10_000;
    const actionClock = vi.spyOn(Date, "now").mockReturnValue(actionAt);

    try {
      const response = await post(harness.room, "/agent/action", {
        playerId: "host",
        actionType: "move",
        data: {},
      });

      expect(response.status).toBe(200);
    } finally {
      actionClock.mockRestore();
    }

    expect(harness.storage.get("lastMeaningfulActivityAt")).toBe(actionAt);

    const expiryClock = vi.spyOn(Date, "now").mockReturnValue(harness.getAlarm()!);

    try {
      await harness.room.alarm();
    } finally {
      expiryClock.mockRestore();
    }
  });

  it("purges a playing room after five minutes without a player action", async () => {
    const harness = createHarness();
    await createRoom(harness.room);
    await post(harness.room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });
    await post(harness.room, "/agent/start", { playerId: "host" });

    const inactivityAlarm =
      z.number().parse(harness.storage.get("lastMeaningfulActivityAt")) + ROOM_INACTIVITY_MS;

    const clock = vi.spyOn(Date, "now").mockReturnValue(inactivityAlarm);

    try {
      await harness.room.alarm();
    } finally {
      clock.mockRestore();
    }

    expect(harness.storage.size).toBeGreaterThan(0);

    const hostFinal = await harness.room.fetch(
      new Request("https://room.test/agent/view?playerId=host"),
    );

    const guestFinal = await harness.room.fetch(
      new Request("https://room.test/agent/view?playerId=guest"),
    );

    expect(await hostFinal.json()).toMatchObject({ state: { status: "ended" } });
    expect(await guestFinal.json()).toMatchObject({ state: { status: "ended" } });
    await vi.waitFor(() => expect(harness.storage.size).toBe(0));
    expect(harness.getAlarm()).toBeNull();
  });

  it("marks an attached seat disconnected after a WebSocket transport error", async () => {
    const harness = createHarness();
    await createRoom(harness.room);
    await post(harness.room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });
    await post(harness.room, "/agent/start", { playerId: "host" });

    const ws = new TestRoomSocket();

    const player: Player = {
      id: "guest",
      name: "SwiftAnchor",
      socket: ws,
      isConnected: true,
      joinedAt: Date.now(),
    };

    harness.room.attachTestSession(ws, player);

    await harness.room.webSocketError(ws, new Error("connection reset"));

    const stored = harness.room.snapshot();
    expect(player.isConnected).toBe(false);
    expect(stored.status).toBe("playing");
    expect(stored.players.map((seat) => seat.id)).toEqual(["host", "guest"]);

    await post(harness.room, "/agent/action", {
      playerId: "host",
      actionType: "end_game",
      data: {},
    });
  });
});
