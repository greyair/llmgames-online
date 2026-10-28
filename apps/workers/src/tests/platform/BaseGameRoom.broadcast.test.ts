import { z } from "zod";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { roomTestEnv } from "../fixtures/room-env";
import { migratedDb } from "../fixtures/migrated-db";
import { RecordingSQLiteD1 } from "../fixtures/recording-db";
import { TestRoomSocket } from "../fixtures/socket";
import type { Env } from "../../types";
import type { Connect4GameState } from "../../durable-objects/types";
import { wireValueSchema, wireObjectSchema } from "@llmgames/game-catalog";

import { describe, it, expect, vi } from "vitest";
import { Connect4Room } from "../../durable-objects/Connect4Room";
import { broadcastProjection } from "../../lib/broadcastProjection";

class BroadcastTestRoom extends Connect4Room {
  constructor(
    readonly runtime: MemoryRoomRuntime,
    readonly bindings: Env,
    readonly database: RecordingSQLiteD1,
  ) {
    super(runtime, bindings);
  }
  get game() {
    if (!this.gameState) throw new Error("Broadcast fixture has no game state");

    return this.gameState;
  }
  configure(status: Connect4GameState["status"]) {
    this.game.status = status;
    this.game.broadcastAllowed = true;
    this.game.seats = { "private-account": 1 };
    this.game.board = [[1, 0]];
    this.game.turnState.currentPlayerId = "private-account";
  }
  capturePermission() {
    return this.captureBroadcastPermission();
  }
  restorePermission() {
    return this.restoreBroadcastPermission();
  }
  queue(sockets?: WebSocket[], snapshot = false) {
    this.queueBroadcastState(sockets, snapshot);
  }
  drained() {
    return this.broadcastQueue;
  }
  restoreSockets() {
    this.restoreSessions();
  }
  get sessionCount() {
    return this.sessions.size;
  }
  get activity() {
    return this.runtime.storage.values.get("lastMeaningfulActivityAt");
  }
}

async function room(status: Connect4GameState["status"] = "playing") {
  const migrated = migratedDb();
  const database = new RecordingSQLiteD1(migrated.sqlite);
  database.sqlite
    .prepare(
      "INSERT INTO users(id,email,broadcast_allowed) VALUES ('private-account','player@example.test',1)",
    )
    .run();
  const runtime = new MemoryRoomRuntime();
  const result = new BroadcastTestRoom(runtime, roomTestEnv({ DB: database }), database);
  await runtime.initialized;
  await result.fetch(
    new Request("https://room/create", {
      method: "POST",
      body: JSON.stringify({
        hostId: "private-account",
        hostName: "Viewer",
        roomCode: "ABC234",
        maxPlayers: 2,
      }),
    }),
  );
  result.configure(status);
  database.calls.length = 0;
  vi.spyOn(database, "prepare");

  return result;
}

describe("broadcast projection boundary", () => {
  it("denies streaming before saving start even for a previously opted-in host", async () => {
    const instance = await room("waiting");
    instance.game.players.push({ id: "guest", name: "Guest" });
    delete instance.game.broadcastAllowed;
    const writes = vi.spyOn(instance.runtime.storage, "put");

    const response = await instance.fetch(
      new Request("https://room/agent/start", {
        method: "POST",
        body: JSON.stringify({ playerId: "private-account" }),
      }),
    );

    expect(response.status).toBe(200);

    const permissionReads = instance.database.calls.filter((call) =>
      call.sql.includes("FROM users"),
    );

    const directoryWrites = instance.database.calls.filter((call) =>
      call.sql.includes("INSERT INTO broadcast_rooms"),
    );

    expect(permissionReads).toHaveLength(0);
    expect(directoryWrites).toHaveLength(1);
    expect(directoryWrites[0]!.args.at(-1)).toBe(0);
    expect(directoryWrites[0]!.args).not.toContain("private-account");

    // saveState writes gameState together with its receipts and repair marker.
    const savedGames = z
      .array(z.array(wireValueSchema))
      .parse(writes.mock.calls)
      .flatMap((call) => {
        const [first, second] = call;
        const entries = wireObjectSchema.safeParse(first);

        const state = entries.success
          ? entries.data.gameState
          : first === "gameState"
            ? second
            : undefined;

        return state === undefined ? [] : [wireObjectSchema.parse(state)];
      });

    expect(savedGames.length).toBeGreaterThan(0);

    for (const game of savedGames) expect(game).toHaveProperty("broadcastAllowed", false);
  });
  it.each([true, false])(
    "clears persisted permission %s without querying profile permission",
    async (allowed) => {
      const instance = await room();
      instance.game.broadcastAllowed = allowed;
      vi.mocked(instance.database.prepare).mockClear();
      await instance.restorePermission();
      expect(instance.bindings.DB.prepare).not.toHaveBeenCalled();
      expect(instance.game.broadcastAllowed).toBe(false);
    },
  );
  it.each([1, 0])(
    "denies streaming for a legacy room despite its old directory decision %s",
    async (allowed) => {
      const instance = await room();
      delete instance.game.broadcastAllowed;
      const game = instance.game;
      instance.database.sqlite
        .prepare(
          "INSERT INTO broadcast_rooms(id,room_id,game_type,created_at,listed_at,expires_at,summary,broadcast_allowed) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          crypto.randomUUID(),
          "connect4-ABC234",
          "connect4",
          game.createdAt,
          Date.now(),
          game.expiresAt,
          "{}",
          allowed,
        );
      const writes = vi.spyOn(instance.runtime.storage, "put");
      await instance.restorePermission();
      await instance.restorePermission();
      expect(instance.database.prepare).not.toHaveBeenCalled();
      expect(instance.game.broadcastAllowed).toBe(false);
      expect(writes).toHaveBeenCalledWith("gameState", instance.game);
    },
  );
  it("preserves the winning Codenames team in the final broadcast", () => {
    const view = broadcastProjection(
      { type: "codenames", status: "ended", winnerTeam: "blue" },
      [],
    );

    expect(view).toMatchObject({ status: "ended", winnerTeam: "blue" });
  });
  it("fails closed for the match if permission lookup fails without failing game start", async () => {
    const instance = await room();
    vi.mocked(instance.database.prepare).mockImplementationOnce(() => {
      throw new Error("Temporary D1 failure");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(instance.capturePermission()).resolves.toBeUndefined();
      expect(instance.game.broadcastAllowed).toBe(false);
      expect((await instance.fetch(new Request("https://room/broadcast"))).status).toBe(404);
    } finally {
      log.mockRestore();
    }
  });
  it("denies agent-host broadcasts despite the owner opting in", async () => {
    const instance = await room();
    instance.game.hostId = "agent-player";
    instance.database.sqlite
      .prepare(
        "INSERT INTO users(id,email,broadcast_allowed) VALUES ('owner','owner@example.test',1),('guest','guest@example.test',0)",
      )
      .run();
    instance.database.sqlite
      .prepare(
        "INSERT INTO mcp_agent_seats(id,owner_user_id,codename,environment_label) VALUES ('agent-id','owner','SwiftAnchor','Codex')",
      )
      .run();
    instance.database.sqlite
      .prepare(
        "INSERT INTO mcp_room_players(room_id,agent_id,player_id) VALUES ('connect4-ABC234','agent-id','agent-player')",
      )
      .run();
    await instance.capturePermission();
    expect(instance.game.broadcastAllowed).toBe(false);
    expect((await instance.fetch(new Request("https://room/broadcast"))).status).toBe(404);
    instance.game.hostId = "guest";
    expect((await instance.fetch(new Request("https://room/broadcast"))).status).toBe(404);
    instance.database.sqlite.exec("UPDATE users SET broadcast_allowed=0");
    expect((await instance.fetch(new Request("https://room/broadcast"))).status).toBe(404);
    // A new match captures the new preference.
    await instance.capturePermission();
    expect(instance.game.broadcastAllowed).toBe(false);
    expect((await instance.fetch(new Request("https://room/broadcast"))).status).toBe(404);
  });
  it("rejects broadcast access when the host has not opted in", async () => {
    const instance = await room();
    instance.database.sqlite.exec("UPDATE users SET broadcast_allowed=0");
    await instance.capturePermission();
    expect((await instance.fetch(new Request("https://room/broadcast"))).status).toBe(404);
  });
  it("keeps public Pokemon boosts but strips exact stats and effect internals", () => {
    const data = broadcastProjection(
      {
        type: "pokemon",
        sides: [
          {
            seat: "p1",
            pokemon: [
              {
                name: "Alakazam",
                boosts: { spa: 2, spd: 2, accuracy: -1, hiddenCounter: 3 },
                stats: { atk: 100, spa: 300 },
                effects: ["reflect"],
                volatiles: { reflect: { duration: 5 } },
              },
            ],
          },
        ],
      },
      [],
    );

    expect(data).toEqual({
      type: "pokemon",
      sides: [
        {
          seat: "p1",
          pokemon: [
            {
              name: "Alakazam",
              boosts: { spa: 2, spd: 2, accuracy: -1 },
              effects: ["reflect"],
            },
          ],
        },
      ],
    });
  });
  it("preserves public Codenames roles with remapped keys and no hidden affiliations", () => {
    const data = broadcastProjection(
      {
        type: "codenames",
        board: [{ index: 0, word: "moon", revealed: false, affiliation: null }],
        activityLog: [
          {
            at: 1,
            type: "clue",
            playerId: "account",
            word: "space",
            count: 1,
            privateNote: "secret",
          },
        ],
        assignments: {
          account: { team: "red", role: "spymaster", privateNote: "secret" },
          outsider: { team: "blue", role: "operative" },
        },
      },
      [{ id: "account", name: "Player" }],
    );

    expect(data).toMatchObject({
      assignments: { "seat-1": { team: "red", role: "spymaster" } },
      board: [{ affiliation: null }],
      activityLog: [{ type: "clue", playerId: "seat-1", word: "space", count: 1 }],
    });
    expect(JSON.stringify(data)).not.toMatch(/account|outsider|secret/);
  });
  it("is read-only and never accepts a player viewpoint, even with credentials or an upgrade header", async () => {
    const instance = await room();
    const before = JSON.stringify(instance.game);
    const activity = instance.activity;

    const response = await instance.fetch(
      new Request("https://room/broadcast?playerId=private-account", {
        headers: { Upgrade: "websocket" },
      }),
    );

    const data = await response.json();
    expect(data).toMatchObject({
      players: [{ id: "seat-1" }],
      discSeats: [{ playerId: "seat-1", disc: 1 }],
      board: [[1, 0]],
    });
    expect(JSON.stringify(data)).not.toContain("private-account");
    expect(JSON.stringify(instance.game)).toBe(before);
    expect(instance.activity).toBe(activity);
  });
  it("rejects an old listing after a room code has been reused", async () => {
    const instance = await room();
    expect(
      (
        await instance.fetch(
          new Request(`https://room/broadcast?createdAt=${instance.game.createdAt - 1}`),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await instance.fetch(
          new Request(`https://room/broadcast?createdAt=${instance.game.createdAt}`),
        )
      ).status,
    ).toBe(200);
  });
  it("includes ended rooms but excludes waiting, expired or inactive rooms", async () => {
    expect((await (await room("ended")).fetch(new Request("https://room/broadcast"))).status).toBe(
      200,
    );
    expect(
      (await (await room("waiting")).fetch(new Request("https://room/broadcast"))).status,
    ).toBe(404);
    const expired = await room();
    expired.game.expiresAt = Date.now() - 1;
    expect((await expired.fetch(new Request("https://room/broadcast"))).status).toBe(404);
    const inactive = await room();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 300001);

    try {
      expect((await inactive.fetch(new Request("https://room/broadcast"))).status).toBe(404);
    } finally {
      clock.mockRestore();
    }
  });
  it("drops all unlisted fields at every depth", () => {
    const data = broadcastProjection(
      {
        type: "poker",
        deck: ["secret"],
        agentId: "private",
        hostId: "account",
        players: [
          {
            id: "account",
            name: "SteadyCraftingLighthouse",
            isAgent: true,
            codename: "SteadyCraftingLighthouse",
            ownerGamertag: "PlayerOne",
            environmentLabel: "Codex",
            privateNote: "secret",
          },
        ],
        seats: [
          {
            playerId: "account",
            hole: [{ rank: "?", suit: "?", hidden: true, raw: "secret" }],
            agentId: "private",
          },
        ],
        turnState: { currentPlayerId: "account", secret: "private" },
        rankedOwners: { account: "private" },
        rewatch: { deck: "secret" },
      },
      [{ id: "account", name: "Player" }],
    );

    expect(JSON.stringify(data)).not.toMatch(
      /secret|private|account|rewatch|rankedOwners|roomCode/,
    );
    expect(data).toMatchObject({
      players: [
        {
          id: "seat-1",
          codename: "SteadyCraftingLighthouse",
          ownerGamertag: "PlayerOne",
          environmentLabel: "Codex",
          isAgent: true,
          spectatorIdentity: true,
        },
      ],
      seats: [{ playerId: "seat-1", hole: [{ rank: "?", hidden: true }] }],
    });
  });
});

it("preserves human display names without exposing account IDs or agent labels", () => {
  const source = {
    type: "poker",
    roomCode: "ABC234",
    players: [{ id: "account", name: "Alice", ownerGamertag: "Alice" }],
    seats: [{ playerId: "account", name: "Alice" }],
  };

  const members = [{ id: "account", name: "Alice" }];
  const first = broadcastProjection(source, members);
  expect(first).toEqual(broadcastProjection(source, members));
  expect(JSON.stringify(first)).not.toMatch(
    /ABC234|account|ownerGamertag|environmentLabel|codename/,
  );
  expect(first).toMatchObject({
    players: [{ name: "Alice", isAgent: false, spectatorIdentity: true }],
    seats: [{ name: "Alice", playerId: "seat-1" }],
  });
});

async function streamingRoom() {
  const instance = await room();
  const ws = new TestRoomSocket();
  ws.serializeAttachment({ kind: "broadcast", expiresAt: Date.now() + 30000, sequence: 0 });
  vi.spyOn(ws, "send");
  vi.spyOn(ws, "close");
  instance.runtime.sockets.push(ws);
  vi.spyOn(instance.runtime.storage, "setAlarm");

  return { instance, ws };
}

it("preserves public move and sound data without leaking identities or unknown fields", () => {
  const data = broadcastProjection(
    {
      type: "reversi",
      winner: "account",
      lastMove: {
        row: 2,
        col: 3,
        seat: 1,
        flipped: [{ row: 3, col: 3, secret: true }],
        secret: true,
      },
      lastPass: { playerId: "account", turn: 4, secret: true },
      shotLog: [
        {
          sequence: 2,
          byPlayerId: "account",
          row: 1,
          col: 2,
          hit: true,
          weapon: "cannon",
          secret: true,
        },
      ],
      lastAnnouncement: "OriginalPlayer fires",
    },
    [{ id: "account", name: "OriginalPlayer" }],
  );

  expect(data).toMatchObject({
    winner: "seat-1",
    lastMove: { flipped: [{ row: 3, col: 3 }] },
    lastPass: { playerId: "seat-1" },
    shotLog: [{ sequence: 2, weapon: "cannon" }],
  });
  expect(JSON.stringify(data)).not.toMatch(/account|secret/);
});

it("delivers rapid moves in order from captured snapshots, separate from player sessions", async () => {
  const { instance, ws } = await streamingRoom();
  const before = instance.activity;
  instance.game.lastMove = { row: 5, col: 0, seat: 1 };
  instance.queue([ws], true);
  instance.game.lastMove = { row: 5, col: 1, seat: 2 };
  instance.queue();
  await instance.drained();

  const messages = ws.messages.map((text) =>
    wireObjectSchema.parse(JSON.parse(z.string().parse(text))),
  );

  expect(
    messages.map((m) => {
      const state = z.object({ lastMove: z.object({ col: z.number() }) }).parse(m.state);

      return [m.type, m.sequence, state.lastMove.col];
    }),
  ).toEqual([
    ["snapshot", 1, 0],
    ["state", 2, 1],
  ]);
  instance.restoreSockets();
  expect(instance.sessionCount).toBe(0);
  expect(instance.activity).toBe(before);
  expect(JSON.stringify(messages)).not.toMatch(/private-account|rewatch/);
});

it("delivers without permission queries or lease expiration after a match is approved", async () => {
  const { instance, ws } = await streamingRoom();
  instance.bindings.DB.prepare = vi.fn(() => {
    throw new Error("No database calls during delivery");
  });
  const expiredAttachment = wireObjectSchema.parse(ws.deserializeAttachment());
  expiredAttachment.expiresAt = Date.now() - 1;
  ws.serializeAttachment(expiredAttachment);
  instance.queue();
  await instance.drained();
  expect(ws.send).toHaveBeenCalledOnce();
  expect(ws.close).not.toHaveBeenCalled();
  expect(instance.bindings.DB.prepare).not.toHaveBeenCalled();
});

it("removes revalidation and rejects actions on broadcast sockets", async () => {
  const { instance, ws } = await streamingRoom();
  vi.mocked(instance.database.prepare).mockClear();
  expect(
    (await instance.fetch(new Request("https://room/broadcast/revalidate", { method: "POST" })))
      .status,
  ).toBe(404);
  expect(ws.close).not.toHaveBeenCalled();
  const next = await streamingRoom();
  const before = JSON.stringify(next.instance.game);
  await next.instance.webSocketMessage(
    next.ws,
    JSON.stringify({ type: "action", payload: { actionType: "drop_disc", data: { col: 2 } } }),
  );
  expect(next.ws.close).toHaveBeenCalledWith(1008, expect.any(String));
  expect(JSON.stringify(next.instance.game)).toBe(before);
});

it("no longer exposes a lease renewal endpoint", async () => {
  const { instance, ws } = await streamingRoom();
  const attachment = wireObjectSchema.parse(ws.deserializeAttachment());
  attachment.connectionId = "connection";
  attachment.subject = "operator";

  const request = (subject: string) =>
    new Request("https://room/broadcast/renew", {
      method: "POST",
      headers: {
        "X-Broadcast-Connection": "connection",
        "X-Broadcast-Subject": subject,
        "X-Broadcast-Expires": String(Date.now() + 30000),
      },
    });

  expect((await instance.fetch(request("different-operator"))).status).toBe(404);
  expect((await instance.fetch(request("operator"))).status).toBe(404);
  expect(ws.send).not.toHaveBeenCalled();
  expect(ws.close).not.toHaveBeenCalled();
  expect(instance.runtime.storage.setAlarm).not.toHaveBeenCalled();
});
