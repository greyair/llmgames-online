import { wireObjectSchema } from "@llmgames/game-catalog";
import { SQLiteD1 } from "../fixtures/sqlite-d1";
import { MemoryR2Bucket } from "../fixtures/memory-r2";
import { testEnv, testNamespace } from "../fixtures/env";
import type { WireObject } from "@llmgames/game-catalog";
import { z } from "zod";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { releaseRoomCode } from "../../lib/activeRooms";
import { DatabaseSync } from "node:sqlite";
import { URL as NodeURL } from "node:url";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLlmgamesMcpServer } from "../../mcp/createServer";
import { GameSeries } from "../../durable-objects/GameSeries";
import { seriesConfigSchema, seriesRequest } from "../../lib/series";
import {
  seriesStandings,
  type SeriesConfig,
  type SeriesView,
  type SeriesResult,
} from "@llmgames/game-catalog";

import { resolveMcpAgentController } from "../../auth/mcpAgentControllers";
import { getActiveRoomForMcpAgent } from "../../auth/mcpAgentSeats";

const config: SeriesConfig = {
  name: "Two game benchmark",
  rounds: [
    { gameType: "connect4", repeats: 2, gameTotalTime: 900_000, turnTime: 90_000 },
    { gameType: "reversi", repeats: 1, gameTotalTime: 900_000, turnTime: 90_000 },
  ],
  firstSeat: "alternate",
  gapMs: 15_000,
  progression: "automatic",
};

function harness() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('host'); INSERT INTO users VALUES ('guest');
    CREATE TABLE active_rooms(room_code TEXT PRIMARY KEY, game_type TEXT, room_id TEXT UNIQUE, status TEXT, expires_at INTEGER, created_at INTEGER);
    CREATE TABLE mcp_room_players(room_id TEXT, agent_id TEXT, player_id TEXT, created_at INTEGER, last_used_at INTEGER, UNIQUE(room_id, agent_id));
    CREATE TABLE mcp_agent_seats(id TEXT PRIMARY KEY, owner_user_id TEXT, codename TEXT, client_id TEXT, environment_label TEXT, created_at INTEGER, last_used_at INTEGER);
    CREATE TABLE mcp_agent_controllers(controller_id TEXT PRIMARY KEY, agent_id TEXT, owner_user_id TEXT, client_id TEXT, created_at INTEGER, last_used_at INTEGER, expires_at INTEGER, active_wait_token TEXT, active_wait_expires_at INTEGER);`);
  sql.exec(
    readFileSync(new NodeURL("../../../migrations/0051_game_series.sql", import.meta.url), "utf8"),
  );
  sql.exec(
    readFileSync(
      new NodeURL("../../../migrations/0052_series_archives.sql", import.meta.url),
      "utf8",
    ),
  );

  const db = new SQLiteD1(sql);

  const storage = new Map<string, unknown>();

  let initialized: Promise<unknown> = Promise.resolve(),
    alarmAt: number | null = null;

  const state = new MemoryRoomRuntime(storage, (at) => {
    alarmAt = at;
  });

  const launches: Array<{
    roomId: string;
    body: { players: Array<{ id: string }>; series: { firstPlayerId: string } };
  }> = [];

  let failStarts = 0;

  const ns = testNamespace(async (roomId, request) => {
    if (request.url.endsWith("/series/setup"))
      launches.push({ roomId, body: await request.json() });

    if (request.url.endsWith("/agent/start") && failStarts-- > 0)
      return Response.json({ error: "Transient failure" }, { status: 500 });

    return Response.json({ ok: true, expiresAt: Date.now() + 2_700_050 });
  });

  const bucket = new MemoryR2Bucket();
  const archives = bucket.objects;
  const env = testEnv({ DB: db, GAME_LOGS: bucket, CONNECT4_ROOM: ns, REVERSI_ROOM: ns });
  let series = new GameSeries(state, env);
  initialized = state.initialized;
  initialized = state.initialized;

  const post = async <T>(path: string, body: T | WireObject = {}, userId = "host") => {
    await initialized;

    return series.fetch(
      new Request(`https://fixture.internal${path}`, {
        method: "POST",
        body: JSON.stringify({ userId, ...body }),
      }),
    );
  };

  const view = async () => (await post("/view")).json<SeriesView>();
  env.GAME_SERIES = testNamespace(async (_name, request) =>
    post(new URL(request.url).pathname, await request.json()),
  );

  const archived = (userId = "host", participantId?: string, path = "/view") =>
    seriesRequest(env, "ABC234", path, { userId, participantId });

  const create = async (overrides: Partial<SeriesConfig> = {}, agents = false) => {
    if (agents)
      sql.exec(
        `INSERT INTO mcp_agent_seats VALUES ('private-agent', 'host', 'SwiftAnchor', NULL, 'Codex', 1, 1); INSERT INTO mcp_room_players VALUES ('series-ABC234', 'private-agent', 'public-series-player', 1, 1);`,
      );
    expect(
      (
        await post("/create", {
          code: "ABC234",
          hostName: "Host",
          config: { ...config, ...overrides },
          participant: {
            id: agents ? "public-series-player" : "p1",
            browserId: agents ? undefined : "host",
            name: "First",
            kind: agents ? "agent" : "human",
            modelLabel: "",
            promptLabel: "",
          },
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await post(
          "/join",
          {
            participant: {
              id: "p2",
              browserId: "guest",
              name: "Second",
              kind: "human",
              modelLabel: "",
              promptLabel: "",
            },
          },
          "guest",
        )
      ).ok,
    ).toBe(true);
  };

  const report = async (outcome: SeriesResult["outcome"] = "win") => {
    const current = (await view()).currentMatch!;

    const result: SeriesResult = {
      index: current.index,
      gameType: current.gameType,
      gameId: `game-${current.index}`,
      firstParticipantId: null,
      winnerId: current.players[0]!.playerId,
      outcome,
      reason: "fixture",
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      metrics: { [current.players[0]!.playerId]: { actions: 4, decisionMs: 8000, timeouts: 1 } },
    };

    expect((await post("/result", { roomId: current.roomId, result })).ok).toBe(true);

    return { result, roomId: current.roomId };
  };

  return {
    sql,
    db,
    env,
    bucket,
    archives,
    archived,
    storage,
    state,
    launches,
    post,
    view,
    create,
    report,
    alarm: () => series.alarm(),
    alarmAt: () => alarmAt,
    failStart: (count = 1) => {
      failStarts = count;
    },
    restore: async () => {
      series = new GameSeries(state, env);
      initialized = state.initialized;
      await initialized;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("server-managed game series", () => {
  it("uses the room expiry so cleanup releases its directory entry", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.create();
    await h.post("/start");
    const match = (await h.view()).currentMatch!;
    const expiresAt = Date.now() + 2_700_050;
    expect(
      h.sql.prepare("SELECT expires_at FROM active_rooms WHERE room_id = ?").get(match.roomId)
        ?.expires_at,
    ).toBe(expiresAt);
    await releaseRoomCode(h.db, match.roomCode, match.roomId, expiresAt);
    expect(
      h.sql.prepare("SELECT room_id FROM active_rooms WHERE room_id = ?").get(match.roomId),
    ).toBeUndefined();
  });
  it("restores active results, rotates seats, and archives completed series before DO cleanup", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.create();
    await h.post("/start");
    expect(h.launches[0]!.body.series.firstPlayerId).toBe("host");
    const first = await h.report();
    await h.post("/result", first);
    expect((await h.view()).results).toHaveLength(1);
    await h.restore();
    await h.alarm();
    expect(h.launches).toHaveLength(1);
    vi.advanceTimersByTime(15_000);
    await h.alarm();
    expect(h.launches[1]!.body.series.firstPlayerId).toBe("guest");
    await h.report();
    vi.advanceTimersByTime(15_000);
    await h.alarm();
    expect(h.launches[2]!.body.series.firstPlayerId).toBe("host");
    const last = await h.report();
    const cleanupAt = h.alarmAt();
    await h.restore();
    const view = await h.view();
    expect(view.status).toBe("completed");
    expect(view.results).toHaveLength(3);
    expect(cleanupAt).toBe(Date.now() + 30_000);
    expect(seriesStandings(view)[0]!.participants[0]).toMatchObject({
      wins: 2,
      timeouts: 2,
      averageDecisionMs: 2000,
    });
    vi.advanceTimersByTime(29_999);
    await h.post("/result", last);
    await h.alarm();
    expect(h.alarmAt()).toBe(cleanupAt);
    expect((await h.view()).status).toBe("completed");
    vi.advanceTimersByTime(1);
    await h.alarm();
    await h.restore();
    expect((await h.post("/view")).status).toBe(404);
    expect(h.storage.size).toBe(0);
    expect(h.alarmAt()).toBeNull();
    expect(h.sql.prepare("SELECT r2_key FROM game_series").get()).toMatchObject({
      r2_key: expect.stringMatching(/^series-logs\/v1\//),
    });
    expect(h.archives.size).toBe(1);
    expect(await (await h.archived()).json()).toMatchObject({
      status: "completed",
      results: view.results,
      config: view.config,
      isHost: true,
      you: "p1",
    });
    expect(await (await h.archived("guest")).json()).toMatchObject({ isHost: false, you: "p2" });
    expect((await h.archived("stranger")).status).toBe(403);
    expect((await h.archived("guest", "p1")).status).toBe(403);
    expect((await h.archived("guest", undefined, "/join")).status).toBe(409);
    expect((await h.post("/create", { code: "ABC234", config })).status).toBe(409);
    expect(h.storage.size).toBe(0);
    expect((await h.post("/result", last)).ok).toBe(true);
    expect(h.storage.size).toBe(0);
  });
  it("waits for both participants after the minimum gap, including readiness after an alarm", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.create({ progression: "ready" });
    await h.post("/start");
    await h.report();
    await h.post("/ready");
    vi.advanceTimersByTime(15_000);
    await h.alarm();
    expect((await h.view()).status).toBe("break");
    expect(h.launches).toHaveLength(1);
    await h.post("/ready", {}, "guest");
    expect((await h.view()).status).toBe("playing");
    expect(h.launches).toHaveLength(2);
  });
  it("rejects unauthorized changes and archives cancelled series with private ownership metadata", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.create({}, true);
    expect((await h.post("/view", {}, "stranger")).status).toBe(403);
    expect((await h.post("/start", {}, "guest")).status).toBe(403);
    expect((await h.post("/join", { participant: { id: "third" } }, "stranger")).status).toBe(409);
    await h.post("/start");
    await h.report();
    expect((await h.post("/cancel", {}, "guest")).status).toBe(403);
    await h.post("/cancel");
    await h.restore();
    expect((await h.view()).status).toBe("cancelled");
    expect((await h.view()).results).toHaveLength(1);
    vi.advanceTimersByTime(30_000);
    await h.alarm();
    expect(h.storage.size).toBe(0);
    expect(h.alarmAt()).toBeNull();
    expect(
      h.sql
        .prepare("SELECT COUNT(*) AS count FROM mcp_room_players WHERE room_id = ?")
        .get("series-ABC234"),
    ).toMatchObject({ count: 1 });
    expect(h.sql.prepare("SELECT COUNT(*) AS count FROM mcp_agent_seats").get()).toMatchObject({
      count: 1,
    });

    const restored = await (
      await h.archived("host", "public-series-player", "/wait")
    ).json<SeriesView>();

    expect(restored).toMatchObject({ status: "cancelled", you: "public-series-player" });
    expect(JSON.stringify(restored)).not.toMatch(
      /private-agent|browserId|hostUserId|participantOwners/,
    );

    const document = await new Response(
      new Blob([...h.archives.values()]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();

    expect(document).not.toContain("private-agent");
  });
  it("retries a partially prepared match without allocating a second room", async () => {
    const h = harness();
    await h.create();
    h.failStart();
    await h.post("/start");
    expect((await h.view()).status).toBe("preparing");
    const roomId = h.launches[0]!.roomId;
    await h.restore();
    await h.alarm();
    expect((await h.view()).status).toBe("playing");
    expect(h.launches[1]!.roomId).toBe(roomId);
  });
  it("keeps credentials in D1, leases the identity during breaks, and renews an expired controller", async () => {
    const h = harness();
    await h.create({}, true);
    const now = Math.floor(Date.now() / 1000);
    h.sql
      .prepare(
        "INSERT INTO mcp_agent_controllers (controller_id, agent_id, owner_user_id, client_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, NULL, 1, 1, ?)",
      )
      .run("controller", "private-agent", "host", now - 100);
    expect(await getActiveRoomForMcpAgent(h.db, "host", "private-agent")).toBe("series-ABC234");
    expect((await resolveMcpAgentController(h.db, "host", "controller")).seat.id).toBe(
      "private-agent",
    );
    await h.post("/start");
    expect(JSON.stringify(h.launches)).not.toContain("private-agent");
    expect(JSON.stringify(await h.view())).not.toContain("private-agent");
    await h.report();
    expect((await h.view()).results[0]!.winnerId).toBe("public-series-player");
    expect(
      await getActiveRoomForMcpAgent(h.db, "host", "private-agent", h.launches[0]!.roomId),
    ).toBe("series-ABC234");
  });
  it("stops an aborted match without recording a draw", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.create();
    await h.post("/start");
    await h.report("aborted");
    const view = await h.view();
    expect(view.status).toBe("failed");
    expect(seriesStandings(view)[0]!.participants[0]).toMatchObject({ wins: 0, draws: 0 });
    vi.advanceTimersByTime(30_000);
    await h.alarm();
    expect(h.storage.size).toBe(0);
  });
  it("clears expired series and series that exhaust launch retries", async () => {
    vi.useFakeTimers();

    for (const failLaunch of [false, true]) {
      const h = harness();
      await h.create();

      if (failLaunch) {
        h.failStart(3);
        await h.post("/start");
        await h.alarm();
        await h.alarm();
      } else {
        vi.advanceTimersByTime(86_400_000);
        await h.alarm();
      }

      expect((await h.view()).status).toBe("failed");
      vi.advanceTimersByTime(30_000);
      await h.alarm();
      await h.restore();
      expect((await h.post("/view")).status).toBe(404);
      expect(h.storage.size).toBe(0);
      expect(h.alarmAt()).toBeNull();
    }
  });
  it("arms cleanup for legacy terminal records and guards namespace maintenance", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.create();
    expect((await h.post("/maintenance/purge-terminal")).status).toBe(409);
    expect((await h.view()).status).toBe("waiting");
    await h.post("/cancel");

    const legacy = z
      .object({ cleanupAt: z.number().optional() })
      .passthrough()
      .parse(h.storage.get("series"));

    delete legacy.cleanupAt;
    await h.state.storage.deleteAlarm();
    await h.restore();
    expect(h.alarmAt()).toBe(Date.now() + 30_000);
    expect((await h.post("/maintenance/purge-terminal")).ok).toBe(true);
    await h.restore();
    expect(h.storage.size).toBe(0);
    expect(h.alarmAt()).toBeNull();
    expect((await h.post("/view")).status).toBe(404);
    expect(await (await h.post("/maintenance/storage-status")).json()).toEqual({
      hasSeries: false,
      storedKeys: 0,
      alarm: null,
    });
  });
  it("retries cleanup after database failure without losing the persisted series", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.create();
    await h.post("/cancel");
    vi.advanceTimersByTime(30_000);

    const prepare = vi.spyOn(h.db, "prepare").mockImplementationOnce(() => {
      throw new Error("D1 unavailable");
    });

    await expect(h.alarm()).rejects.toThrow("D1 unavailable");
    prepare.mockRestore();
    expect(h.storage.size).toBe(1);
    expect(h.alarmAt()).toBe(Date.now() + 5000);
    vi.advanceTimersByTime(5000);
    await h.alarm();
    expect(h.storage.size).toBe(0);
    expect(h.alarmAt()).toBeNull();
  });
  it("retains the DO and retries when R2 upload or D1 archive indexing fails", async () => {
    vi.useFakeTimers();

    for (const failR2 of [true, false]) {
      const h = harness();
      await h.create();
      await h.post("/cancel");
      vi.advanceTimersByTime(30_000);

      const spy = failR2
        ? vi.spyOn(h.bucket, "put").mockRejectedValueOnce(new Error("Archive unavailable"))
        : vi.spyOn(h.db, "prepare");

      if (!failR2) {
        spy.mockImplementationOnce(() => {
          throw new Error("Archive unavailable");
        });
      }

      await expect(h.alarm()).rejects.toThrow("Archive unavailable");
      spy.mockRestore();
      expect(h.storage.size).toBe(1);
      expect(h.sql.prepare("SELECT r2_key FROM game_series").get()?.r2_key).toBeNull();
      vi.advanceTimersByTime(5000);
      await h.alarm();
      expect(h.storage.size).toBe(0);
      expect(h.archives.size).toBe(1);
      expect((await h.archived()).ok).toBe(true);
    }
  });
  it("validates configuration limits before expansion", () => {
    const defaults = seriesConfigSchema.parse({
      ...config,
      rounds: [{ gameType: "connect4", repeats: 1 }],
    });

    expect(defaults.rounds[0]).toMatchObject({ gameTotalTime: 900_000, turnTime: 90_000 });
    expect(
      seriesConfigSchema.safeParse({
        ...config,
        rounds: [{ ...config.rounds[0], turnTime: 60_000 }],
      }).success,
    ).toBe(false);
    expect(
      seriesConfigSchema.safeParse({
        ...config,
        rounds: [{ ...config.rounds[0], gameTotalTime: 600_000 }],
      }).success,
    ).toBe(false);
    expect(
      seriesConfigSchema.safeParse({
        ...config,
        rounds: [{ ...config.rounds[0], repeats: 1_000_000_000 }],
      }).success,
    ).toBe(false);
    expect(
      seriesConfigSchema.safeParse({
        ...config,
        rounds: [{ ...config.rounds[0], gameType: "codenames" }],
      }).success,
    ).toBe(false);
    expect(
      seriesConfigSchema.safeParse({
        ...config,
        rounds: [{ ...config.rounds[0], gameType: "battleship", gameTotalTime: 2_700_000 }],
      }).success,
    ).toBe(false);
  });
});

describe("MCP series enrollment", () => {
  it("creates and joins with independent controllers, carries room mappings, and releases the wait lease", async () => {
    const h = harness();
    const controllers = [crypto.randomUUID(), crypto.randomUUID()];

    for (const [index, controller] of controllers.entries()) {
      h.sql
        .prepare("INSERT INTO mcp_agent_seats VALUES (?, ?, ?, NULL, ?, 1, 1)")
        .run(`private-${index}`, "host", index ? "CalmHarbor" : "SwiftAnchor", "Codex");
      h.sql
        .prepare(
          "INSERT INTO mcp_agent_controllers(controller_id, agent_id, owner_user_id, client_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, NULL, 1, 1, ?)",
        )
        .run(controller, `private-${index}`, "host", Math.floor(Date.now() / 1000) + 600);
    }

    Object.assign(h.env, {
      FRONTEND_URL: "http://localhost:3000",
      GAME_SERIES: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: (url: string, init: { body: string }) =>
            h.post(new URL(url).pathname, JSON.parse(init.body)),
        }),
      },
    });

    const server = createLlmgamesMcpServer({
      env: h.env,
      user: {
        id: "host",
        email: "host@example.test",
        name: null,
        gamertag: "Host",
        gamertag_selected: 1,
        created_at: 1,
        updated_at: 1,
      },
      origin: "http://localhost:6787",
    });

    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "series-fixture", version: "1" });
    await server.connect(b);
    await client.connect(a);

    const call = async <T>(name: string, args: T, expectError = false) => {
      const result = await client.callTool({ name, arguments: wireObjectSchema.parse(args) });
      expect(Boolean(result.isError)).toBe(expectError);

      const block = z
        .array(z.object({ type: z.string(), text: z.string() }).passthrough())
        .parse(result.content)[0]!;

      return JSON.parse(block.text);
    };

    try {
      const created = await call("series_create", {
        controllerId: controllers[0],
        config,
        modelLabel: "model-one",
        promptLabel: "baseline",
      });

      const seriesCode = created.seriesCode;

      const joined = await call("series_join", {
        controllerId: controllers[1],
        seriesCode,
        modelLabel: "model-two",
      });

      expect(joined.participants.map((p: { modelLabel: string }) => p.modelLabel)).toEqual([
        "model-one",
        "model-two",
      ]);
      await call("series_join", { controllerId: controllers[1], seriesCode }, true);
      const started = await call("series_start", { controllerId: controllers[0], seriesCode });
      expect(started.status).toBe("playing");

      const status = await call("series_status", {
        controllerId: controllers[1],
        seriesCode,
        timeoutMs: 0,
      });

      expect(status.currentMatch.players).toHaveLength(2);
      expect(JSON.stringify(status)).not.toContain("private-");
      expect(
        h.sql
          .prepare("SELECT COUNT(*) AS count FROM mcp_room_players WHERE room_id = ?")
          .get(status.currentMatch.roomId),
      ).toMatchObject({ count: 2 });
      expect(
        h.sql
          .prepare("SELECT active_wait_token FROM mcp_agent_controllers WHERE controller_id = ?")
          .get(controllers[1]!),
      ).toMatchObject({ active_wait_token: null });
      await call("series_cancel", { controllerId: controllers[0], seriesCode });
      expect((await h.view()).status).toBe("cancelled");
      vi.useFakeTimers();
      vi.advanceTimersByTime(30_000);
      await h.alarm();
      await h.restore();
      expect(h.storage.size).toBe(0);
      expect(
        await call("series_status", { controllerId: controllers[1], seriesCode, timeoutMs: 0 }),
      ).toMatchObject({ status: "cancelled", you: joined.you });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
