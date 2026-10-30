import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { gameLogDocumentSchema, wireObjectSchema, type WireObject } from "@llmgames/game-catalog";
import { z } from "zod";

import { describe, expect, it, vi } from "vitest";

import { createLlmgamesMcpServer } from "../../mcp/createServer";
import { Connect4Room } from "../../durable-objects/Connect4Room";
import { migratedDb } from "../fixtures/migrated-db";
import { MemoryR2Bucket } from "../fixtures/memory-r2";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { testEnv, testNamespace } from "../fixtures/env";
import type { Env } from "../../types";

/**
 * M3.3 acceptance: a whole match played through the **real MCP tool path**
 * (`agent_claim` → `room_create`/`room_join` → `start_game` → `send_action` →
 * `get_state`), then archived to R2 with a D1 index row and read back through
 * the shared archive contract.
 *
 * Nothing is stubbed inside the Worker: the only local substitutes are the
 * in-process Durable Object namespace, D1 (real SQLite schema) and the R2
 * bucket, all of which implement the same interfaces the production bindings do.
 */

const toolContentSchema = z.array(z.object({ type: z.string(), text: z.string().optional() }));

const actionResponseSchema = z.object({
  ok: z.boolean().optional(),
  state: z
    .object({
      type: z.string(),
      status: z.string(),
      turnState: z.object({ currentPlayerId: z.string().nullable() }).loose(),
      you: z.object({ playerId: z.string(), legalActions: z.array(z.string()) }).loose(),
    })
    .loose(),
});

type ToolBody = WireObject;

function roomHarness() {
  const db = migratedDb();

  db.sqlite
    .prepare(
      "INSERT INTO users(id,email,gamertag,gamertag_selected) VALUES ('owner','owner@example.test','Owner',1)",
    )
    .run();

  const bucket = new MemoryR2Bucket();
  const rooms = new Map<string, Connect4Room>();
  const runtimes = new Map<string, MemoryRoomRuntime>();

  const namespace = testNamespace(async (name, request) => {
    const existing = rooms.get(name);

    if (existing) return existing.fetch(request);

    const runtime = new MemoryRoomRuntime(new Map());

    runtimes.set(name, runtime);

    const room = new Connect4Room(runtime, env);

    rooms.set(name, room);
    await runtime.initialized;

    return room.fetch(request);
  });

  const env: Env = testEnv({ DB: db, GAME_LOGS: bucket, CONNECT4_ROOM: namespace });

  return { db, bucket, rooms, runtimes, env };
}

async function connect(env: Env) {
  const server = createLlmgamesMcpServer({
    env,
    user: {
      id: "owner",
      email: "owner@example.test",
      name: "Owner",
      gamertag: "Owner",
      created_at: 0,
      updated_at: 0,
    },
    clientId: null,
    origin: "https://www.llmgames.online",
  });

  const client = new Client({ name: "journey", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const call = async (name: string, args: WireObject = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = toolContentSchema.parse(result.content)[0]?.text;
    const body = wireObjectSchema.parse(text ? JSON.parse(text) : {});

    return { isError: Boolean(result.isError), body };
  };

  return { client, call };
}

describe("MCP match journey", () => {
  it("plays a match over MCP and archives a readable replay", async () => {
    const harness = roomHarness();
    const { client, call } = await connect(harness.env);

    try {
      const hostClaim = await call("agent_claim");
      const guestClaim = await call("agent_claim");

      expect(hostClaim.isError).toBe(false);
      expect(guestClaim.isError).toBe(false);

      const hostController = z.string().parse(hostClaim.body.controllerId);
      const guestController = z.string().parse(guestClaim.body.controllerId);

      const created = await call("room_create", {
        controllerId: hostController,
        gameType: "connect4",
        turnTime: 30_000,
      });

      expect(created.isError).toBe(false);

      const roomId = z.string().parse(created.body.roomId);
      const roomCode = z.string().parse(created.body.roomCode);

      expect(roomId).toBe(`connect4-${roomCode}`);

      const joined = await call("room_join", { controllerId: guestController, roomCode });

      expect(joined.isError).toBe(false);

      const started = await call("start_game", { controllerId: hostController, roomId });

      expect(started.isError).toBe(false);

      // Seat order is random, so drive whichever controller is on turn.
      const controllers = new Map<string, string>();

      const stateOf = async (controllerId: string) =>
        actionResponseSchema.parse(
          (await call("get_state", { controllerId, roomId })).body,
        ).state;

      for (const controllerId of [hostController, guestController]) {
        const state = await stateOf(controllerId);

        controllers.set(state.you.playerId, controllerId);
      }

      expect(controllers.size).toBe(2);

      let state = await stateOf(hostController);
      const columns = [0, 0, 1, 1, 2, 2, 3];

      for (const col of columns) {
        const current = state.turnState.currentPlayerId;
        const controllerId = current ? controllers.get(current) : undefined;

        expect(controllerId).toBeTruthy();

        const action = await call("send_action", {
          controllerId,
          roomId,
          actionType: "drop_disc",
          data: { col },
        });

        expect(action.isError).toBe(false);
        state = await stateOf(controllerId!);
      }

      expect(state.status).toBe("ended");
      expect(state.you.legalActions).not.toContain("drop_disc");

      // Reading the finished state with both controllers closes final delivery.
      for (const controllerId of [hostController, guestController])
        await call("get_state", { controllerId, roomId });

      await vi.waitFor(() => expect(harness.bucket.objects.size).toBe(1), { timeout: 5_000 });

      const [key] = [...harness.bucket.objects.keys()];
      const stored = await harness.bucket.get(key!);

      expect(stored).not.toBeNull();

      const raw = await new Response(
        new Blob([await stored!.arrayBuffer()]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).text();

      const document = gameLogDocumentSchema.parse(JSON.parse(raw));

      expect(document.gameType).toBe("connect4");
      expect(document.version).toBe(1);
      expect(document.endReason).toBe("connect4");
      expect(document.participants.map((participant) => participant.ref).sort()).toEqual([
        "p1",
        "p2",
      ]);
      expect(document.participants.every((participant) => participant.isAgent)).toBe(true);
      const eventTypes = document.events.map((event) => event.type);

      expect(eventTypes[0]).toBe("game_started");
      expect(eventTypes.filter((type) => type === "drop_disc")).toHaveLength(columns.length);
      expect(eventTypes.filter((type) => type === "turn_changed")).toHaveLength(
        columns.length - 1,
      );
      expect(eventTypes).toContain("game_ended");
      expect(eventTypes.at(-1)).toBe("action");

      const frames = z.array(wireObjectSchema).parse(document.rewatch.frames);

      expect(frames.length).toBeGreaterThan(1);
      expect(JSON.stringify(frames.at(-1))).toContain('"status":"ended"');

      // The replay is a full reveal: some frame state carries the winning row.
      const boards = frames.flatMap((frame) => {
        const state = wireObjectSchema.safeParse(frame.state);

        if (!state.success || !Array.isArray(state.data.board)) return [];

        return [z.array(z.array(z.number())).parse(state.data.board)];
      });

      expect(boards.length).toBeGreaterThan(0);
      expect(boards.at(-1)?.[5]?.slice(0, 4)).toEqual([1, 1, 1, 1]);

      // Private identity material never reaches the archive.
      expect(raw).not.toContain(hostController);
      expect(raw).not.toContain(guestController);
      expect(raw).not.toContain("agentId");

      const index = harness.db.sqlite
        .prepare("SELECT game_type, end_reason, event_count, r2_key FROM game_logs")
        .all();

      expect(index).toEqual([
        {
          game_type: "connect4",
          end_reason: "connect4",
          event_count: document.events.length,
          r2_key: key,
        },
      ]);
    } finally {
      await client.close();
    }
  });
});
