import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { sandboxRoutes } from "../../api/sandbox";
import { GomokuRoom } from "../../durable-objects/GomokuRoom";
import type { Env } from "../../types";
import { testEnv, testNamespace } from "../fixtures/env";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { SqliteRoomSql } from "../fixtures/sqlite-room";
import { roomTestEnv } from "../fixtures/room-env";

/**
 * The worker-side sandbox router.
 *
 * The DO suite (`Sandbox.test.ts`) proves the room closes its own `/sandbox/*`
 * endpoints. This file proves the *router* cannot be used to reach a room that
 * never opted into sandbox mode: `/action` used to forward to `/agent/action`,
 * which only checks membership — so on a deployment with the sandbox enabled,
 * anyone who knew a room id and a member's public playerId could move that
 * member's pieces.
 */

const SANDBOX_ENV: Partial<Env> = { ENVIRONMENT: "development", SANDBOX_ENABLED: "true" };

function app() {
  const server = new Hono<{ Bindings: Env }>();

  server.route("/api/v1/dev/sandbox", sandboxRoutes);

  return server;
}

function post(env: Env, body: Record<string, string>) {
  return app().fetch(
    new Request("http://local/api/v1/dev/sandbox/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
}

describe("sandbox action routing", () => {
  it("sends seat actions to the sandbox endpoint, not the agent one", async () => {
    const calls: string[] = [];

    const namespace = testNamespace(async (_name, request) => {
      calls.push(request.url);

      return Response.json({ ok: true });
    });

    const response = await post(
      testEnv({ ...SANDBOX_ENV, GOMOKU_ROOM: namespace }),
      { roomId: "gomoku-AB2345", playerId: "sandbox-seat-1", actionType: "place_stone" },
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\/sandbox\/action$/);
  });

  it("refuses to act on a room that was not created as a sandbox", async () => {
    const runtime = new MemoryRoomRuntime(new Map());

    runtime.storage.sql = new SqliteRoomSql();

    const room = new GomokuRoom(runtime, roomTestEnv(SANDBOX_ENV));
    await runtime.initialized;

    const created = await room.fetch(
      new Request("https://room.test/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostId: "host", hostName: "Host", roomCode: "AB2345" }),
      }),
    );

    expect(created.ok).toBe(true);

    const namespace = testNamespace(async (_name, request) => room.fetch(request));

    const response = await post(testEnv({ ...SANDBOX_ENV, GOMOKU_ROOM: namespace }), {
      roomId: "gomoku-AB2345",
      playerId: "host",
      actionType: "leave",
    });

    // The room refuses because it is not a sandbox room; `leave` would have
    // removed the host had the request reached the ordinary action path.
    expect(response.status).toBe(404);

    const view = await room.fetch(
      new Request("https://room.test/agent/view?playerId=host"),
    );

    expect(view.status).toBe(200);
  });

  it("does not exist at all on a production deployment", async () => {
    const response = await post(
      testEnv({ ENVIRONMENT: "production", SANDBOX_ENABLED: "true", GOMOKU_ROOM: testNamespace() }),
      { roomId: "gomoku-AB2345", playerId: "sandbox-seat-1", actionType: "place_stone" },
    );

    expect(response.status).toBe(404);
  });
});
