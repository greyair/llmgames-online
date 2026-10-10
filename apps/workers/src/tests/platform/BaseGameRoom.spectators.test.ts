import { roomTestEnv } from "../fixtures/room-env";
import { DatabaseSync } from "node:sqlite";
import { SQLiteD1 } from "../fixtures/sqlite-d1";
import { projectedStateSchema, actionErrorSchema } from "../fixtures/contracts";
import { testEnv } from "../fixtures/env";
import type { WireObject, WireValue } from "@llmgames/game-catalog";
import { TestRoomSocket } from "../fixtures/socket";
import { wireValueSchema, wireObjectSchema } from "@llmgames/game-catalog";
import { z } from "zod";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";

import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";
import { describe, expect, it } from "vitest";

import { BaseGameRoom } from "../../durable-objects/BaseGameRoom";
import type { BaseGameState, Player } from "../../durable-objects/types";

class TestRoom extends BaseGameRoom<BaseGameState> {
  protected readonly roomLabel = "TestRoom";

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
    const createdAt = Date.now();

    return {
      id: "room-id",
      roomCode,
      type: "test",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      spectators: [],
      hostId: config.hostId,
      maxPlayers: config.maxPlayers ?? 4,
      timerConfig: {
        gameTotalTime: config.gameTotalTime ?? 60_000,
        turnTime: config.turnTime ?? 30_000,
      },
      gameTimeRemaining: config.gameTotalTime ?? 60_000,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: config.turnTime ?? 30_000,
      },
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + ROOM_LIFETIME_MS,
    };
  }

  protected async handleGameAction(
    _player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string> {
    return `Unknown action: ${payload.actionType}`;
  }

  attachTestSession(ws: WebSocket, player: Player): void {
    this.sessions.set(ws, player);
  }

  protected restoreSessions(): void {
    // Tests inject the current in-memory socket set directly.
  }
}

function createRoom(): TestRoom {
  const storage = new Map<string, unknown>();
  let alarmAt: number | null = null;

  const state = new MemoryRoomRuntime(storage, (at) => {
    alarmAt = at;
  });

  return new TestRoom(state, roomTestEnv());
}

async function post<T>(
  room: TestRoom,
  path: string,
  body: T,
): Promise<{ response: Response; json: WireObject }> {
  const response = await room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

  return {
    response,
    json: wireObjectSchema.parse(await response.json()),
  };
}

describe("moving player seats to spectators", () => {
  it("rejects a caller-selected agent name", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "host",
      hostName: "HostAgent",
      roomCode: "ABC234",
    });

    const joined = await post(room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "AgentNamedItself",
    });

    expect(joined.response.status).toBe(400);
  });

  it("lets the host move an MCP player while preserving watch access", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "host",
      hostName: "HostAgent",
      roomCode: "ABC234",
    });
    await post(room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });

    const moved = await post(room, "/agent/action", {
      playerId: "host",
      actionType: "move_player_to_spectator",
      data: { playerId: "guest" },
    });

    expect(moved.response.status).toBe(200);

    const hostState = projectedStateSchema.parse(moved.json.state);

    expect(hostState.players.map((p) => p.id)).toEqual(["host"]);
    expect(hostState).not.toHaveProperty("spectators");
    expect(hostState.you!.legalActions).toContain("move_player_to_spectator");

    const viewResponse = await room.fetch(
      new Request("https://room.test/agent/view?playerId=guest"),
    );

    expect(viewResponse.status).toBe(200);

    const viewBody = z
      .object({
        state: z
          .object({
            you: z
              .object({ isSpectator: z.boolean(), legalActions: z.array(z.string()) })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(await viewResponse.json());

    expect(viewBody.state.you).toMatchObject({
      isSpectator: true,
      legalActions: ["leave"],
    });

    const rejoin = await post(room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });

    expect(rejoin.json.isSpectator).toBe(true);
    const rejoinedState = projectedStateSchema.parse(rejoin.json.state);
    expect(rejoinedState.players.map((p) => p.id)).toEqual(["host"]);
    expect(rejoinedState).not.toHaveProperty("spectators");
  });

  it("rejects non-host moderation and lets the host move its own seat", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "host",
      hostName: "HostAgent",
      roomCode: "XYZ789",
    });
    await post(room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });

    const byGuest = await post(room, "/agent/action", {
      playerId: "guest",
      actionType: "move_player_to_spectator",
      data: { playerId: "host" },
    });

    expect(byGuest.response.status).toBe(403);
    expect(actionErrorSchema.parse(byGuest.json).error).toMatchObject({
      code: "FORBIDDEN",
      category: "permission",
      message: "Only the host can move players to spectators",
      actionType: "move_player_to_spectator",
      recovery: "none",
    });

    const hostSelf = await post(room, "/agent/action", {
      playerId: "host",
      actionType: "move_player_to_spectator",
      data: { playerId: "host" },
    });

    expect(hostSelf.response.status).toBe(200);
    expect(hostSelf.json.state).toMatchObject({
      players: [{ id: "guest" }],
      you: {
        isHost: true,
        isSpectator: true,
        legalActions: expect.arrayContaining([
          "start_game",
          "set_host_spectating",
          "set_player_seats",
        ]),
      },
    });

    const reclaimed = await post(room, "/agent/action", {
      playerId: "host",
      actionType: "set_host_spectating",
      data: { spectating: false },
    });

    expect(reclaimed.response.status).toBe(200);
    expect(reclaimed.json.state).toMatchObject({
      players: [{ id: "host" }, { id: "guest" }],
      you: { isHost: true, isSpectator: false },
    });
  });

  it("keeps table controls when the host starts from spectators", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "host",
      hostName: "HostAgent",
      roomCode: "ABC234",
    });

    for (const playerId of ["guest-1", "guest-2"]) {
      await post(room, "/agent/join", {
        playerId,
        assignedCodename: "SwiftAnchor",
      });
    }

    await post(room, "/agent/action", {
      playerId: "host",
      actionType: "set_host_spectating",
      data: { spectating: true },
    });

    const started = await post(room, "/agent/action", {
      playerId: "host",
      actionType: "start_game",
      data: {},
    });

    expect(started.response.status).toBe(200);
    expect(started.json.state).toMatchObject({
      status: "playing",
      players: [{ id: "guest-1" }, { id: "guest-2" }],
      you: {
        isHost: true,
        isSpectator: true,
        legalActions: expect.arrayContaining(["end_game"]),
      },
    });
  });

  it("returns a structured, recoverable error for an out-of-scope action", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "host",
      hostName: "HostAgent",
      roomCode: "ABC234",
    });

    const rejected = await post(room, "/agent/action", {
      playerId: "host",
      actionType: "teleport_piece",
      data: {},
    });

    const body = actionErrorSchema.parse(rejected.json);

    expect(rejected.response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatchObject({
      code: "UNSUPPORTED_ACTION",
      category: "scope",
      actionType: "teleport_piece",
      recovery: "correct_action",
    });
    expect(body.state).not.toBeNull();
    expect(body.legalActions).toContain("start_game");
  });

  it("reports a missing kick target instead of silently succeeding", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "host",
      hostName: "HostAgent",
      roomCode: "ABC234",
    });

    const rejected = await post(room, "/agent/action", {
      playerId: "host",
      actionType: "kick_player",
      data: { playerId: "missing" },
    });

    const body = actionErrorSchema.parse(rejected.json);

    expect(rejected.response.status).toBe(404);
    expect(body.error).toMatchObject({
      code: "NOT_FOUND",
      category: "not_found",
      message: "Player not found",
    });
  });

  it("rejects kicking a seated player after the game starts", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "host",
      hostName: "HostAgent",
      roomCode: "ABC234",
    });
    await post(room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });
    await post(room, "/agent/start", { playerId: "host" });

    const rejected = await post(room, "/agent/action", {
      playerId: "host",
      actionType: "kick_player",
      data: { playerId: "guest" },
    });

    const body = actionErrorSchema.parse(rejected.json);

    expect(rejected.response.status).toBe(409);
    expect(body.error).toMatchObject({
      code: "WRONG_PHASE",
      message: "Players can only be kicked before the game starts",
    });
    expect(projectedStateSchema.parse(body.state).players.map((seat) => seat.id)).toEqual([
      "host",
      "guest",
    ]);

    await post(room, "/agent/action", {
      playerId: "host",
      actionType: "end_game",
      data: {},
    });
  });

  it("uses the same structured contract for the dedicated start endpoint", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "host",
      hostName: "HostAgent",
      roomCode: "ABC234",
    });

    const rejected = await post(room, "/agent/start", { playerId: "host" });
    const body = actionErrorSchema.parse(rejected.json);

    expect(rejected.response.status).toBe(409);
    expect(body.error).toMatchObject({
      code: "WRONG_PHASE",
      category: "state",
      actionType: "start_game",
      recovery: "wait_for_phase",
    });
    expect(body.legalActions).toContain("start_game");
  });

  it("lets an MCP spectator leave instead of retaining a stale seat", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "host",
      hostName: "HostAgent",
      roomCode: "ABC234",
    });
    await post(room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });
    await post(room, "/agent/action", {
      playerId: "host",
      actionType: "move_player_to_spectator",
      data: { playerId: "guest" },
    });

    const left = await post(room, "/agent/action", {
      playerId: "guest",
      actionType: "leave",
    });

    expect(left.response.status).toBe(200);

    const view = await room.fetch(new Request("https://room.test/agent/view?playerId=guest"));

    expect(view.status).toBe(403);
  });

  it("emits transient spectator disconnect and leave events to peers", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "host",
      hostName: "HostAgent",
      roomCode: "ABC234",
    });
    await post(room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });
    await post(room, "/agent/action", {
      playerId: "host",
      actionType: "move_player_to_spectator",
      data: { playerId: "guest" },
    });

    const peerMessages: string[] = [];

    const peerSocket = Object.assign(new TestRoomSocket(), {
      readyState: WebSocket.OPEN,
      send: (message: string) => peerMessages.push(message),
      close: () => undefined,
    });

    const spectatorSocket = Object.assign(new TestRoomSocket(), {
      readyState: WebSocket.OPEN,
      send: () => undefined,
      close: () => undefined,
    });

    room.attachTestSession(peerSocket, {
      id: "host",
      name: "HostAgent",
      socket: peerSocket,
      isConnected: true,
      joinedAt: Date.now(),
    });
    room.attachTestSession(spectatorSocket, {
      id: "guest",
      name: "SwiftAnchor",
      socket: spectatorSocket,
      isConnected: true,
      isSpectator: true,
      joinedAt: Date.now(),
    });

    await room.webSocketClose(spectatorSocket);
    expect(peerMessages.map((message) => JSON.parse(message).type)).toContain(
      "spectator_disconnected",
    );

    peerMessages.length = 0;
    room.attachTestSession(spectatorSocket, {
      id: "guest",
      name: "SwiftAnchor",
      socket: spectatorSocket,
      isConnected: true,
      isSpectator: true,
      joinedAt: Date.now(),
    });
    await room.webSocketMessage(spectatorSocket, JSON.stringify({ type: "leave" }));
    await Promise.resolve();
    expect(peerMessages.map((message) => JSON.parse(message).type)).toContain("spectator_left");
  });

  it("identifies room members and atomically assigns player seats", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "host",
      hostName: "HostAgent",
      roomCode: "ABC234",
      maxPlayers: 4,
    });
    await post(room, "/agent/join", {
      playerId: "aakash-codex",
      assignedCodename: "SwiftAnchor",
      ownerGamertag: "Aakash",
      environmentLabel: "Codex",
    });
    await post(room, "/agent/join", {
      playerId: "ravi-claude",
      assignedCodename: "CalmBuildingAnchor",
      ownerGamertag: "Ravi",
      environmentLabel: "Claude",
    });
    await post(room, "/agent/action", {
      playerId: "host",
      actionType: "move_player_to_spectator",
      data: { playerId: "aakash-codex" },
    });

    const before = await room.fetch(new Request("https://room.test/agent/view?playerId=host"));

    const beforeBody = z
      .object({
        state: z
          .object({
            roomMembers: z.array(wireObjectSchema),
            you: z.object({ legalActions: z.array(z.string()) }).passthrough(),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(await before.json());

    expect(beforeBody.state.roomMembers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          playerId: "aakash-codex",
          role: "spectator",
          seatKind: "agent",
          username: "Aakash",
          agentName: "SwiftAnchor",
          environmentLabel: "Codex",
        }),
      ]),
    );
    expect(beforeBody.state.you.legalActions).toContain("set_player_seats");

    const assigned = await post(room, "/agent/action", {
      playerId: "host",
      actionType: "set_player_seats",
      data: { playerIds: ["aakash-codex"] },
    });

    expect(assigned.response.status).toBe(200);

    const assignedState = z
      .object({
        players: z.array(z.object({ id: z.string() }).passthrough()),
        roomMembers: z.array(wireObjectSchema),
      })
      .passthrough()
      .parse(assigned.json.state);

    expect(assignedState.players.map((player) => player.id)).toEqual(["host", "aakash-codex"]);
    expect(assignedState.roomMembers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: "aakash-codex", role: "player" }),
        expect.objectContaining({ playerId: "ravi-claude", role: "spectator" }),
      ]),
    );

    const promoted = await room.fetch(
      new Request("https://room.test/agent/view?playerId=aakash-codex"),
    );

    expect(
      z
        .object({ state: z.object({ you: wireValueSchema }).passthrough() })
        .passthrough()
        .parse(await promoted.json()).state.you,
    ).toMatchObject({
      isSpectator: false,
    });

    const demoted = await room.fetch(
      new Request("https://room.test/agent/view?playerId=ravi-claude"),
    );

    expect(
      z
        .object({ state: z.object({ you: wireValueSchema }).passthrough() })
        .passthrough()
        .parse(await demoted.json()).state.you,
    ).toMatchObject({
      isSpectator: true,
      legalActions: ["leave"],
    });
  });

  it("rejects invalid or unauthorized player-seat assignments", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "host",
      hostName: "HostAgent",
      roomCode: "ABC234",
      maxPlayers: 2,
    });
    await post(room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });

    const byGuest = await post(room, "/agent/action", {
      playerId: "guest",
      actionType: "set_player_seats",
      data: { playerIds: ["guest"] },
    });

    expect(byGuest.response.status).toBe(403);
    expect(actionErrorSchema.parse(byGuest.json).error).toMatchObject({
      code: "FORBIDDEN",
      message: "Only the host can set player seats",
    });

    const unknown = await post(room, "/agent/action", {
      playerId: "host",
      actionType: "set_player_seats",
      data: { playerIds: ["missing"] },
    });

    expect(unknown.response.status).toBe(404);
    expect(actionErrorSchema.parse(unknown.json).error).toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("keeps the private activity log out of agent responses", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "host",
      hostName: "HostAgent",
      roomCode: "ABC234",
    });
    await post(room, "/agent/join", {
      playerId: "guest",
      assignedCodename: "SwiftAnchor",
    });

    const moved = await post(room, "/agent/action", {
      playerId: "host",
      actionType: "move_player_to_spectator",
      data: { playerId: "guest" },
    });

    expect(moved.response.status).toBe(200);
    expect(moved.json).not.toHaveProperty("events");

    const waited = await post(room, "/agent/wait-turn", {
      playerId: "guest",
      timeoutMs: 1_000,
    });

    expect(waited.response.status).toBe(200);
    expect(waited.json).toMatchObject({
      timedOut: true,
      reason: "timeout",
    });
    expect(waited.json).not.toHaveProperty("events");
    expect(waited.json).not.toHaveProperty("state");
    expect(waited.json).not.toHaveProperty("eventSeq");
  });

  it("rejects private or legacy identity fields on ordinary agent endpoints", async () => {
    const room = createRoom();
    await post(room, "/create", {
      hostId: "player_public_host",
      hostName: "HostAgent",
      roomCode: "ABC234",
    });

    const join = await post(room, "/agent/join", {
      userId: "agent_private_guest",
      assignedCodename: "SwiftAnchor",
    });

    expect(join.response.status).toBe(400);
    expect(join.json).toMatchObject({ error: "playerId required" });

    const action = await post(room, "/agent/action", {
      agentId: "agent_private_host",
      actionType: "end_game",
      data: {},
    });

    expect(action.response.status).toBe(400);
    expect(actionErrorSchema.parse(action.json).error.message).toBe(
      "playerId and actionType required",
    );
  });

  it("rewrites a live legacy credential identity before returning state", async () => {
    const room = createRoom();
    const legacyAgentId = "agent_private_legacy_host";
    const publicPlayerId = "player_public_migrated_host";
    await post(room, "/create", {
      hostId: legacyAgentId,
      hostName: "SwiftAnchor",
      roomCode: "ABC234",
    });
    await post(room, "/agent/join", {
      playerId: "player_public_guest",
      assignedCodename: "CalmBuildingAnchor",
    });
    await post(room, "/agent/action", {
      playerId: legacyAgentId,
      actionType: "move_player_to_spectator",
      data: { playerId: "player_public_guest" },
    });

    const migrated = await post(room, "/agent/migrate-identity", {
      legacyAgentId,
      playerId: publicPlayerId,
    });

    expect(migrated.response.status).toBe(200);
    expect(migrated.json).toEqual({
      ok: true,
      migrated: true,
      playerId: publicPlayerId,
    });

    const view = await room.fetch(
      new Request(`https://room.test/agent/view?playerId=${encodeURIComponent(publicPlayerId)}`),
    );

    const serialized = await view.text();
    expect(view.status).toBe(200);
    expect(serialized).toContain(publicPlayerId);
    expect(serialized).not.toContain(legacyAgentId);

    const internals = z
      .object({
        gameState: wireObjectSchema,
        fallbackEventRows: z.array(wireValueSchema),
        fallbackRewatchRows: z.array(wireValueSchema),
      })
      .parse(room);

    expect(JSON.stringify(internals.gameState)).not.toContain(legacyAgentId);
    expect(JSON.stringify(internals.fallbackEventRows)).not.toContain(legacyAgentId);
    expect(JSON.stringify(internals.fallbackRewatchRows)).not.toContain(legacyAgentId);

    const oldIdentity = await room.fetch(
      new Request(`https://room.test/agent/view?playerId=${encodeURIComponent(legacyAgentId)}`),
    );

    expect(oldIdentity.status).toBe(403);
  });

  it("upgrades persisted legacy agent identities before serving a room", async () => {
    const room = createRoom();
    const legacyAgentId = "00000000-0000-4000-8000-000000000011";
    await post(room, "/create", {
      hostId: legacyAgentId,
      hostName: "SwiftAnchor",
      roomCode: "ABC234",
    });
    await post(room, "/agent/join", {
      playerId: legacyAgentId,
      assignedCodename: "SwiftAnchor",
    });

    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`CREATE TABLE mcp_agent_seats(id TEXT PRIMARY KEY, owner_user_id TEXT);
      CREATE TABLE mcp_room_players(room_id TEXT, agent_id TEXT, player_id TEXT, created_at INTEGER, last_used_at INTEGER, UNIQUE(room_id, agent_id));`);
    sqlite.prepare("INSERT INTO mcp_agent_seats VALUES (?, 'owner-a')").run(legacyAgentId);
    const persisted = z.object({ gameState: wireObjectSchema }).parse(room).gameState;
    persisted.type = "connect4";
    const runtime = new MemoryRoomRuntime(new Map([["gameState", persisted]]));
    const restored = new TestRoom(runtime, testEnv({ DB: new SQLiteD1(sqlite) }));
    await runtime.initialized;

    const current = z
      .object({
        gameState: z.object({ players: z.array(z.object({ id: z.string() })) }).passthrough(),
      })
      .parse(restored).gameState;

    const publicPlayerId = current.players[0]!.id;
    expect(publicPlayerId).toMatch(/^player_[0-9a-f-]{36}$/);
    expect(current.players[0]?.id).toBe(publicPlayerId);
    expect(JSON.stringify(current)).not.toContain(legacyAgentId);
  });
});
