import { roomTestEnv } from "../fixtures/room-env";
import { rewatchSchema } from "../fixtures/contracts";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";

import type { WireValue } from "@llmgames/game-catalog";
import { TestRoomSocket } from "../fixtures/socket";
import { wireValueSchema, wireObjectSchema } from "@llmgames/game-catalog";
import { z } from "zod";

import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";
import { describe, expect, it, vi } from "vitest";

import { BaseGameRoom, MAX_REWATCH_FRAMES } from "../../durable-objects/BaseGameRoom";
import type { BaseGameState, Player } from "../../durable-objects/types";

class RewatchRoom extends BaseGameRoom<BaseGameState> {
  protected readonly roomLabel = "RewatchRoom";

  protected createDefaultState(
    config: { hostId: string; hostName: string },
    roomCode: string,
  ): BaseGameState {
    const createdAt = Date.now();

    return {
      id: "private-room-id",
      roomCode,
      type: "connect4",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      spectators: [{ id: "watcher", name: "Watcher" }],
      hostId: config.hostId,
      maxPlayers: 2,
      timerConfig: { gameTotalTime: 60_000, turnTime: 30_000 },
      gameTimeRemaining: 60_000,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: 30_000,
      },
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + ROOM_LIFETIME_MS,
    };
  }

  protected async handleGameAction(
    _player: Player,
    _payload: { actionType: string; data: WireValue },
  ): Promise<void> {}

  attach(ws: WebSocket, player: Player): void {
    this.sessions.set(ws, player);
  }

  captureSequence(): void {
    if (!this.gameState) throw new Error("missing test state");
    this.gameState.status = "playing";
    this.gameState.turnState.phase = "play";
    this.gameState.turnState.currentPlayerId = "host";
    this.gameState.turnState.turnNumber = 1;
    this.recordEvent("game_started");
    this.gameState.turnState.currentPlayerId = "guest";
    this.gameState.turnState.turnNumber = 2;
    this.recordEvent("action", { actionType: "drop_disc" });
    this.gameState.status = "ended";
    this.gameState.turnState.phase = "ended";
    this.gameState.turnState.currentPlayerId = null;
    this.recordEvent("game_ended", { reason: "win" });
    this.broadcastProjected("game_ended", { reason: "win" });
  }

  captureLongSequence(actionCount: number): void {
    if (!this.gameState) throw new Error("missing test state");
    this.gameState.status = "playing";
    this.gameState.turnState.phase = "play";
    this.gameState.turnState.currentPlayerId = "host";
    this.recordEvent("game_started");

    for (let index = 1; index <= actionCount; index++) {
      this.gameState.turnState.turnNumber = index;
      this.recordEvent("action", { actionType: "drop_disc" });
    }

    this.gameState.status = "ended";
    this.gameState.turnState.phase = "ended";
    this.gameState.turnState.currentPlayerId = null;
    this.recordEvent("game_ended", { reason: "frame_limit_test" });
    this.broadcastProjected("game_ended", { reason: "frame_limit_test" });
  }
}

function harness() {
  const storage = new Map<string, unknown>();
  const sockets: WebSocket[] = [];

  const state = new MemoryRoomRuntime(storage, undefined, sockets);

  return { room: new RewatchRoom(state, roomTestEnv()), storage, sockets };
}

async function create(room: RewatchRoom): Promise<void> {
  const response = await room.fetch(
    new Request("https://room.test/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hostId: "host",
        hostName: "Host",
        roomCode: "ABC234",
      }),
    }),
  );

  expect(response.status).toBe(200);
}

describe("final browser rewatch delivery", () => {
  it("sends sanitized frames once and purges the room after the browser saves them", async () => {
    const { room, storage, sockets } = harness();
    await create(room);

    const sent: string[] = [];

    const socket = Object.assign(new TestRoomSocket(), {
      readyState: WebSocket.OPEN,
      send: (message: string) => sent.push(message),
      close: () => undefined,
    });

    const watcherSent: string[] = [];

    const watcherSocket = Object.assign(new TestRoomSocket(), {
      readyState: WebSocket.OPEN,
      send: (message: string) => watcherSent.push(message),
      close: () => undefined,
    });

    sockets.push(socket);
    sockets.push(watcherSocket);
    room.attach(socket, {
      id: "host",
      name: "Host",
      socket,
      isConnected: true,
      joinedAt: Date.now(),
    });
    room.attach(watcherSocket, {
      id: "watcher",
      name: "Watcher",
      socket: watcherSocket,
      isConnected: true,
      isSpectator: true,
      joinedAt: Date.now(),
    });

    room.captureSequence();

    const message = z
      .object({
        type: z.string(),
        payload: z.object({
          finalState: z.object({ roomCode: z.string() }).passthrough(),
          reason: z.string(),
          rewatch: rewatchSchema,
        }),
      })
      .parse(JSON.parse(sent.at(-1)!));

    expect(message.type).toBe("game_ended");
    expect(message.payload.reason).toBe("win");
    expect(message.payload.finalState.roomCode).toBe("ABC234");
    expect(message.payload.rewatch).toMatchObject({
      version: 1,
      visibility: "full_reveal",
      gameType: "connect4",
      truncated: false,
    });
    expect(message.payload.rewatch.frames.map((frame) => frame.label)).toEqual([
      "game_started",
      "drop_disc",
      "game_ended",
    ]);
    const replayState = wireObjectSchema.parse(message.payload.rewatch.frames[0]?.state);
    expect(replayState.replayPerspectivePlayerId).toBe("host");
    expect(replayState.you).toMatchObject({
      isHost: false,
      isYourTurn: false,
      isSpectator: false,
      phase: "play",
      legalActions: [],
    });
    expect(replayState.you).not.toHaveProperty("playerId");

    for (const privateField of [
      "id",
      "roomCode",
      "hostId",
      "createdAt",
      "updatedAt",
      "expiresAt",
      "spectators",
    ]) {
      expect(replayState).not.toHaveProperty(privateField);
    }

    await room.webSocketMessage(socket, JSON.stringify({ type: "rewatch_saved" }));
    expect(storage.size).toBeGreaterThan(0);
    expect(watcherSent).toHaveLength(1);
    await room.webSocketMessage(watcherSocket, JSON.stringify({ type: "rewatch_saved" }));
    await vi.waitFor(() => expect(storage.size).toBe(0));
    const stateResponse = await room.fetch(new Request("https://room.test/state"));
    expect(stateResponse.status).toBe(404);
  });

  it("keeps the first frame and a bounded recent replay window", async () => {
    const { room, sockets } = harness();
    await create(room);
    const sent: string[] = [];

    const socket = Object.assign(new TestRoomSocket(), {
      readyState: WebSocket.OPEN,
      send: (message: string) => sent.push(message),
      close: () => undefined,
    });

    sockets.push(socket);
    room.attach(socket, {
      id: "host",
      name: "Host",
      socket,
      isConnected: true,
      joinedAt: Date.now(),
    });

    room.captureLongSequence(MAX_REWATCH_FRAMES + 50);

    const message = z
      .object({ payload: z.object({ rewatch: rewatchSchema }) })
      .parse(JSON.parse(sent.at(-1)!));

    const frames = message.payload.rewatch.frames;
    expect(message.payload.rewatch.truncated).toBe(true);
    expect(frames).toHaveLength(MAX_REWATCH_FRAMES);
    expect(frames[0]?.label).toBe("game_started");
    expect(frames.at(-1)?.label).toBe("game_ended");

    const internals = z
      .object({ fallbackRewatchRows: z.array(wireValueSchema) })
      .passthrough()
      .parse(room);

    expect(internals.fallbackRewatchRows).toHaveLength(MAX_REWATCH_FRAMES);

    await room.webSocketMessage(socket, JSON.stringify({ type: "rewatch_saved" }));
  });
});
