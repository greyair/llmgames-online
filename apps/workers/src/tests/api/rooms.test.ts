import { DatabaseSync } from "node:sqlite";
import { SQLiteD1 } from "../fixtures/sqlite-d1";
import { testEnv, testNamespace } from "../fixtures/env";
import { wireObjectSchema } from "@llmgames/game-catalog";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env, User, Variables } from "../../types";
import { roomsRoutes } from "../../api/rooms";

const user: User = {
  id: "user-1",
  email: "player@example.test",
  name: "Player",
  gamertag: "PlayerOne",
  gamertag_selected: 1,
  created_at: 0,
  updated_at: 0,
};

function roomNamespace(
  state = {
    roomCode: "AB2345",
    status: "waiting",
    players: [{ id: "user-1", name: "PlayerOne" }],
    spectators: [],
    maxPlayers: 2,
    expiresAt: 5000,
  },
) {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  const namespace = testNamespace(async (_name, request) => {
    const body = request.method === "GET" ? undefined : await request.text();
    calls.push({ input: request.url, init: { method: request.method, body } });

    if (request.url.endsWith("/create")) return Response.json({ expiresAt: 5000 });

    return Response.json(state);
  });

  return { namespace, calls };
}

type DirectoryRow = {
  room_code: string;
  game_type: string;
  room_id: string;
  status: string;
  expires_at: number;
  created_at: number;
};

function fakeDb(entry?: DirectoryRow) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE active_rooms(room_code TEXT PRIMARY KEY, game_type TEXT, room_id TEXT UNIQUE, status TEXT, expires_at INTEGER, created_at INTEGER)",
  );

  if (entry)
    sqlite
      .prepare("INSERT INTO active_rooms VALUES (?,?,?,?,?,?)")
      .run(
        entry.room_code,
        entry.game_type,
        entry.room_id,
        entry.status,
        Date.now() + 60000,
        entry.created_at,
      );

  return new SQLiteD1(sqlite);
}

function testApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", roomsRoutes);

  return app;
}

function envFor(namespace: Env["CONNECT4_ROOM"], db: Env["DB"]): Env {
  return testEnv({
    DB: db,
    FRONTEND_URL: "https://play.test/",
    CONNECT4_ROOM: namespace,
    REVERSI_ROOM: namespace,
    CODENAMES_ROOM: namespace,
    BATTLESHIP_ROOM: namespace,
    POKER_ROOM: namespace,
    CONTEXTO_ROOM: namespace,
  });
}

describe("room HTTP routes", () => {
  it("creates a canonical room and activates its directory entry", async () => {
    const harness = roomNamespace();

    const response = await testApp().request(
      "https://api.test/create",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameType: "holdem", turnTime: 30_000 }),
      },
      envFor(harness.namespace, fakeDb()),
    );

    expect(response.status).toBe(200);

    const body = await response.json<{
      roomId: string;
      gameType: string;
      roomCode: string;
      joinUrl: string;
    }>();

    expect(body.gameType).toBe("poker");
    expect(body.roomId).toBe(`poker-${body.roomCode}`);
    expect(body.roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(body.joinUrl).toBe(`https://play.test/poker?roomCode=${body.roomCode}`);
    expect(harness.calls[0]!.init?.method).toBe("POST");
    const createBody = wireObjectSchema.parse(JSON.parse(String(harness.calls[0]!.init?.body)));
    expect(createBody.hostId).toBe("user-1");
    expect(createBody.gameType).toBe("poker");
  });

  it("uses the Contexto slug without changing the internal game type", async () => {
    const harness = roomNamespace();

    const response = await testApp().request(
      "https://api.test/create",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameType: "contexto" }),
      },
      envFor(harness.namespace, fakeDb()),
    );

    expect(response.status).toBe(200);
    const body = await response.json<{ gameType: string; roomCode: string; joinUrl: string }>();
    expect(body.gameType).toBe("contexto");
    expect(body.joinUrl).toBe(`https://play.test/contexto?roomCode=${body.roomCode}`);
  });

  it("resolves a bare code through the directory and reports player join mode", async () => {
    const harness = roomNamespace();

    const entry = {
      room_code: "AB2345",
      game_type: "reversi",
      room_id: "reversi-AB2345",
      status: "active",
      expires_at: 5000,
      created_at: 1000,
    };

    const response = await testApp().request(
      "https://api.test/join",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode: "ab2345" }),
      },
      envFor(harness.namespace, fakeDb(entry)),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      roomId: "reversi-AB2345",
      gameType: "reversi",
      roomCode: "AB2345",
      joinMode: "player",
      canJoinAsPlayer: true,
      joinUrl: "https://play.test/reversi?roomCode=AB2345",
    });
  });

  it("rejects unsupported game types before touching a Durable Object", async () => {
    const harness = roomNamespace();

    const response = await testApp().request(
      "/create",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameType: "tic-tac-toe" }),
      },
      envFor(harness.namespace, fakeDb()),
    );

    expect(response.status).toBe(400);
    expect(harness.calls).toHaveLength(0);
  });

  it.each(["blackjack", "blackjack-duel", "bj-duel"])(
    "rejects removed game type %s before touching a Durable Object",
    async (gameType) => {
      const harness = roomNamespace();

      const response = await testApp().request(
        "/create",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ gameType }),
        },
        envFor(harness.namespace, fakeDb()),
      );

      expect(response.status).toBe(400);
      expect(harness.calls).toHaveLength(0);
    },
  );

  it("hides an existing removed room", async () => {
    const harness = roomNamespace();

    const entry = {
      room_code: "AB2345",
      game_type: "blackjack",
      room_id: "blackjack-AB2345",
      status: "active",
      expires_at: 5000,
      created_at: 1000,
    };

    const response = await testApp().request(
      "/join",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode: "AB2345" }),
      },
      envFor(harness.namespace, fakeDb(entry)),
    );

    expect(response.status).toBe(404);
    expect(harness.calls).toHaveLength(0);
  });

  it.each([29_999, 150_001])(
    "rejects out-of-range decision timer %i before touching a Durable Object",
    async (turnTime) => {
      const harness = roomNamespace();

      const response = await testApp().request(
        "/create",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ gameType: "connect4", turnTime }),
        },
        envFor(harness.namespace, fakeDb()),
      );

      expect(response.status).toBe(400);
      expect(harness.calls).toHaveLength(0);
    },
  );
});
