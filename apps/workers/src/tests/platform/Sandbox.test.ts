import { describe, expect, it } from "vitest";
import { wireObjectSchema, wireValueSchema, type WireValue } from "@llmgames/game-catalog";
import { z } from "zod";

import { DoudizhuRoom } from "../../durable-objects/DoudizhuRoom";
import { GomokuRoom } from "../../durable-objects/GomokuRoom";
import type { RoomRuntime } from "../../durable-objects/runtime";
import type { Env } from "../../types";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { SqliteRoomSql } from "../fixtures/sqlite-room";
import { roomTestEnv } from "../fixtures/room-env";
import { sandboxEnabled } from "../../lib/sandbox";

/**
 * C3 Live Sandbox.
 *
 * The point of these tests is that the sandbox is *the real platform*: the same
 * rule modules, the same projections, the same action path. What it adds is
 * seat selection, and that addition must not exist outside a sandbox deployment.
 */

const SANDBOX_ENV: Partial<Env> = { ENVIRONMENT: "development", SANDBOX_ENABLED: "true" };

const actionResultSchema = z.object({ ok: z.boolean() });

const viewSchema = z.object({
  state: z.object({
    type: z.string(),
    status: z.string(),
    players: z.array(wireObjectSchema),
    spectators: z.array(wireObjectSchema).optional(),
    turnState: z.object({ phase: z.string(), turnNumber: z.number() }),
    you: z.object({
      playerId: z.string().optional(),
      isSpectator: z.boolean().optional(),
      isHost: z.boolean().optional(),
      isYourTurn: z.boolean().optional(),
      legalActions: z.array(z.string()).optional(),
    }),
    hand: z.array(z.string()).optional(),
    handCounts: z.array(z.number()).optional(),
    hands: z.unknown().optional(),
  }),
});

type SandboxView = z.output<typeof viewSchema>;

async function sandboxRoom<T extends GomokuRoom | DoudizhuRoom>(
  Room: new (state: RoomRuntime, env: Env) => T,
  options: {
    seats: number;
    environment?: Partial<Env>;
    sandbox?: boolean;
    code?: string;
    gameType?: string;
  },
) {
  const runtime = new MemoryRoomRuntime(new Map());

  runtime.storage.sql = new SqliteRoomSql();

  const env = roomTestEnv({ ...SANDBOX_ENV, ...options.environment });
  const room = new Room(runtime, env);
  await runtime.initialized;

  const seats = Array.from({ length: options.seats }, (_, index) => ({
    id: `sandbox-seat-${index + 1}`,
    name: `Sandbox ${index + 1}`,
  }));

  const created = await room.fetch(
    new Request("https://room.test/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hostId: seats[0]!.id,
        hostName: seats[0]!.name,
        roomCode: options.code ?? "ABC234",
        maxPlayers: options.seats,
        sandbox: options.sandbox !== false,
      }),
    }),
  );

  const seeded = created.ok
    ? await room.fetch(
        new Request("https://room.test/sandbox/seed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ seats, spectators: [{ id: "sandbox-spectator", name: "Watcher" }] }),
        }),
      )
    : null;

  return { room, created, seeded, seats, runtime };
}

async function viewOf(room: GomokuRoom | DoudizhuRoom, playerId: string) {
  const response = await room.fetch(
    new Request(`https://room.test/sandbox/view?playerId=${encodeURIComponent(playerId)}`),
  );

  return {
    status: response.status,
    body: response.ok ? viewSchema.parse(wireObjectSchema.parse(await response.json())) : null,
  };
}

async function act(
  room: GomokuRoom | DoudizhuRoom,
  playerId: string,
  actionType: string,
  data: Record<string, WireValue> = {},
) {
  const response = await room.fetch(
    new Request("https://room.test/agent/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId, actionType, data }),
    }),
  );

  const body = actionResultSchema.parse(wireValueSchema.parse(await response.json()));

  return { status: response.status, body };
}

describe("sandbox deployment gate", () => {
  it("is off in production even when the flag is set", () => {
    expect(sandboxEnabled({ ENVIRONMENT: "production", SANDBOX_ENABLED: "true" })).toBe(false);
    expect(sandboxEnabled({ ENVIRONMENT: "production" })).toBe(false);
  });

  it("is off without the explicit flag", () => {
    expect(sandboxEnabled({ ENVIRONMENT: "development" })).toBe(false);
    expect(sandboxEnabled({ SANDBOX_ENABLED: "yes" })).toBe(false);
  });

  it("is on only for an opted-in non-production deployment", () => {
    expect(sandboxEnabled({ ENVIRONMENT: "development", SANDBOX_ENABLED: "true" })).toBe(true);
  });
});

describe("sandbox room creation", () => {
  it("creates and seeds a sandbox room where the sandbox is allowed", async () => {
    const { created, seeded } = await sandboxRoom(GomokuRoom, { seats: 2 });

    expect(created.ok).toBe(true);
    expect(seeded?.ok).toBe(true);
  });

  it("refuses to create a sandbox room in production", async () => {
    const { created } = await sandboxRoom(GomokuRoom, {
      seats: 2,
      environment: { ENVIRONMENT: "production" },
    });

    expect(created.status).toBe(404);
  });

  it("keeps the sandbox endpoints closed on a room created without the flag", async () => {
    const { room, created } = await sandboxRoom(GomokuRoom, { seats: 2, sandbox: false });

    expect(created.ok).toBe(true);

    const view = await viewOf(room, "sandbox-seat-1");

    expect(view.status).toBe(404);
  });

  it("closes the sandbox endpoints when the deployment stops allowing them", async () => {
    const runtime = new MemoryRoomRuntime(new Map());

    runtime.storage.sql = new SqliteRoomSql();

    const allowed = new GomokuRoom(runtime, roomTestEnv(SANDBOX_ENV));
    await runtime.initialized;
    await allowed.fetch(
      new Request("https://room.test/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hostId: "sandbox-seat-1",
          hostName: "Sandbox 1",
          roomCode: "ABC234",
          sandbox: true,
        }),
      }),
    );

    // The same stored room, woken on a deployment that no longer opts in.
    const locked = new GomokuRoom(runtime, roomTestEnv({ ENVIRONMENT: "production" }));
    await runtime.initialized;

    expect((await viewOf(locked, "sandbox-seat-1")).status).toBe(404);
  });
});

describe("seat switching", () => {
  it("returns each seat's own projection", async () => {
    const { room, seats } = await sandboxRoom(GomokuRoom, { seats: 2 });

    await act(room, seats[0]!.id, "start_game");

    const first = await viewOf(room, seats[0]!.id);
    const second = await viewOf(room, seats[1]!.id);
    const watcher = await viewOf(room, "sandbox-spectator");

    expect(first.body?.state.you.playerId).toBe(seats[0]!.id);
    expect(second.body?.state.you.playerId).toBe(seats[1]!.id);

    // Exactly one seat may place a stone; the other only sees the room actions.
    const movers = [first, second].filter((view) =>
      view.body?.state.you.legalActions?.includes("place_stone"),
    );

    expect(movers).toHaveLength(1);
    expect(watcher.body?.state.you.isSpectator).toBe(true);
    expect(watcher.body?.state.you.legalActions).toEqual(["leave"]);
  });

  it("hides the other seats' cards in a three-seat card game", async () => {
    const { room, seats } = await sandboxRoom(DoudizhuRoom, { seats: 3, code: "DEF234" });

    await act(room, seats[0]!.id, "start_game");

    const first = await viewOf(room, seats[0]!.id);
    const second = await viewOf(room, seats[1]!.id);
    const watcher = await viewOf(room, "sandbox-spectator");

    expect(first.body?.state.hand).toHaveLength(17);
    expect(second.body?.state.hand).toHaveLength(17);
    expect(first.body?.state.hand).not.toEqual(second.body?.state.hand);

    // No seat's full hand map is ever projected, and a watcher holds no cards.
    expect(first.body?.state.hands).toBeUndefined();
    expect(second.body?.state.hands).toBeUndefined();
    expect(watcher.body?.state.hand).toEqual([]);
    expect(watcher.body?.state.handCounts).toEqual([17, 17, 17]);
  });
});

describe("real actions through the sandbox", () => {
  it("plays a legal move and records it", async () => {
    const { room, seats } = await sandboxRoom(GomokuRoom, { seats: 2 });

    await act(room, seats[0]!.id, "start_game");

    // The starter is drawn at random, so ask the room which seat is to move.
    const views = await Promise.all(seats.map((seat) => viewOf(room, seat.id)));

    const mover =
      views.find((view) => view.body?.state.you.isYourTurn)?.body?.state.you.playerId ??
      seats[0]!.id;

    const played = await act(room, mover, "place_stone", { row: 7, col: 7 });

    expect(played.status).toBe(200);

    const events = await room.fetch(new Request("https://room.test/sandbox/events"));

    expect(events.ok).toBe(true);

    const listed = z
      .object({ events: z.array(z.object({ type: z.string() })) })
      .parse(wireObjectSchema.parse(await events.json()));

    expect(listed.events.map((event) => event.type)).toContain("action");
  });

  it("reports an illegal move as a rejection, not a silent success", async () => {
    const { room, seats } = await sandboxRoom(GomokuRoom, { seats: 2 });

    await act(room, seats[0]!.id, "start_game");

    const views = await Promise.all(seats.map((seat) => viewOf(room, seat.id)));

    const mover =
      views.find((view) => view.body?.state.you.isYourTurn)?.body?.state.you.playerId ??
      seats[0]!.id;

    expect((await act(room, mover, "place_stone", { row: 7, col: 7 })).body.ok).toBe(true);

    // The other seat now holds the turn and tries the same point.
    const other = seats.find((seat) => seat.id !== mover)!;

    const repeated = await act(room, other.id, "place_stone", { row: 7, col: 7 });

    expect(repeated.body.ok).toBe(false);
    expect(repeated.status).not.toBe(200);
  });
});

describe("sandbox projections match the browser contract", () => {
  it("carries the fields a room page reads", async () => {
    const { room, seats } = await sandboxRoom(GomokuRoom, { seats: 2 });

    const view = await viewOf(room, seats[0]!.id);

    expect(view.body?.state).toMatchObject({
      type: "gomoku",
      status: "waiting",
      turnState: { phase: "waiting", turnNumber: 0 },
    });
    expect(view.body?.state.players).toHaveLength(2);
    expect(view.body?.state.spectators).toHaveLength(1);
  });

  it("keeps the waiting room renderable before the match starts", async () => {
    const { room, seats } = await sandboxRoom(GomokuRoom, { seats: 2 });
    const view = await viewOf(room, seats[0]!.id);

    expect(view.status).toBe(200);
    expect(view.body?.state.you.isHost).toBe(true);
  });
});
