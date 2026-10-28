import { roomTestEnv } from "../fixtures/room-env";
import { socketMessageSchema } from "../fixtures/contracts";

import type { WireObject } from "@llmgames/game-catalog";
import { TestRoomSocket } from "../fixtures/socket";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";

import { describe, expect, it } from "vitest";
import { Connect4Room } from "../../durable-objects/Connect4Room";
import type { Player } from "../../durable-objects/types";

class AcknowledgementRoom extends Connect4Room {
  protected restoreSessions(): void {}
  protected startingPlayerIndex(): number {
    return 0;
  }

  attach(socket: WebSocket, playerId: string): void {
    const player: Player = {
      id: playerId,
      name: playerId,
      socket,
      isConnected: true,
      joinedAt: Date.now(),
    };

    this.sessions.set(socket, player);
  }
}

async function fixture() {
  const storage = new Map<string, unknown>();
  let alarm: number | null = null;

  const state = new MemoryRoomRuntime(storage, (at) => {
    alarm = at;
  });

  const room = new AcknowledgementRoom(state, roomTestEnv());

  const post = <T>(route: string, body: T) =>
    room.fetch(
      new Request(`https://room.test${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  expect(
    (await post("/create", { hostId: "host", hostName: "Host", roomCode: "ABC234" })).status,
  ).toBe(200);
  expect(
    (await post("/agent/join", { playerId: "guest", assignedCodename: "SwiftAnchor" })).status,
  ).toBe(200);
  const messages: Array<ReturnType<typeof socketMessageSchema.parse>> = [];
  const guestMessages: Array<ReturnType<typeof socketMessageSchema.parse>> = [];

  const socket = Object.assign(new TestRoomSocket(), {
    readyState: WebSocket.OPEN,
    send: (message: string) => messages.push(socketMessageSchema.parse(JSON.parse(message))),
    close: () => undefined,
  });

  const guestSocket = Object.assign(new TestRoomSocket(), {
    readyState: WebSocket.OPEN,
    send: (message: string) => guestMessages.push(socketMessageSchema.parse(JSON.parse(message))),
    close: () => undefined,
  });

  room.attach(socket, "host");
  room.attach(guestSocket, "guest");

  const send = <T>(
    type: "action" | "start_game",
    requestId?: string,
    actionType?: string,
    data: T | WireObject = {},
  ) =>
    room.webSocketMessage(
      socket,
      JSON.stringify({
        type,
        ...(requestId ? { requestId } : undefined),
        ...(type === "action" ? { payload: { actionType, data } } : undefined),
      }),
    );

  const result = () => messages.filter((message) => message.type === "action_result").at(-1);

  return { room, socket, guestSocket, messages, guestMessages, send, result };
}

describe("WebSocket action acknowledgements", () => {
  it("correlates accepted starts and moves and sends the caller's projected state", async () => {
    const h = await fixture();
    await h.send("start_game", "start-123");
    expect(h.result()).toMatchObject({
      type: "action_result",
      payload: {
        requestId: "start-123",
        ok: true,
        state: { status: "playing", you: { playerId: "host" } },
      },
    });
    await h.send("action", "move-123", "drop_disc", { col: 0 });
    const board = Array.from({ length: 6 }, () => Array(7).fill(0));
    board[5]![0] = 1;
    expect(h.result()).toMatchObject({
      type: "action_result",
      payload: { requestId: "move-123", ok: true, state: { board, you: { isYourTurn: false } } },
    });
    expect(h.guestMessages.some((message) => message.type === "action_result")).toBe(false);
  });

  it("returns the rejection instead of confirming an illegal move", async () => {
    const h = await fixture();
    await h.send("start_game", "start-123");
    await h.send("action", "illegal-123", "drop_disc", { col: 99 });
    expect(h.result()).toMatchObject({
      type: "action_result",
      payload: { requestId: "illegal-123", ok: false, message: expect.any(String) },
    });
    expect(h.result()?.payload).not.toHaveProperty("state");
  });

  it("replays an acknowledged request instead of applying the same move twice", async () => {
    const h = await fixture();
    await h.send("start_game", "start-123");
    await h.send("action", "move-once", "drop_disc", { col: 0 });
    const first = h.result();

    await h.send("action", "move-once", "drop_disc", { col: 0 });
    const replayed = h.result();
    const board = Array.from({ length: 6 }, () => Array(7).fill(0));
    board[5]![0] = 1;

    expect(replayed).toMatchObject({
      type: "action_result",
      payload: { requestId: "move-once", ok: true, replayed: true, state: { board } },
    });
    expect(replayed?.payload.acceptedRevision).toBe(first?.payload.acceptedRevision);
  });

  it("replays a rejection without dispatching it again", async () => {
    const h = await fixture();
    await h.send("start_game", "start-123");
    await h.send("action", "illegal-once", "drop_disc", { col: 99 });
    const first = h.result();

    await h.send("action", "illegal-once", "drop_disc", { col: 99 });
    const replayed = h.result();

    expect(replayed).toMatchObject({
      type: "action_result",
      payload: { requestId: "illegal-once", ok: false, replayed: true },
    });
    expect(replayed?.payload.message).toBe(first?.payload.message);
  });

  it("treats distinct request ids as distinct actions", async () => {
    const h = await fixture();
    await h.send("start_game", "start-123");
    await h.send("action", "host-move", "drop_disc", { col: 0 });
    await h.room.webSocketMessage(
      h.guestSocket,
      JSON.stringify({
        type: "action",
        requestId: "guest-move",
        payload: { actionType: "drop_disc", data: { col: 1 } },
      }),
    );

    const board = Array.from({ length: 6 }, () => Array(7).fill(0));
    board[5]![0] = 1;
    board[5]![1] = 2;
    const view = await h.room.fetch(new Request("https://room.test/agent/view?playerId=host"));
    const { state } = await view.json<{ state: unknown }>();

    expect(state).toMatchObject({ board });
  });

  it("applies an agent request once when the same id is retried", async () => {
    const h = await fixture();
    await h.send("start_game", "start-123");
    await h.send("action", "host-move", "drop_disc", { col: 0 });

    const post = (requestId: string) =>
      h.room.fetch(
        new Request("https://room.test/agent/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            playerId: "guest",
            actionType: "drop_disc",
            data: { col: 1 },
            requestId,
          }),
        }),
      );

    await expect(post("agent-move")).resolves.toMatchObject({ status: 200 });
    const retried = await post("agent-move");
    const payload = await retried.json<{ ok: boolean; replayed?: boolean; state: unknown }>();

    expect(payload).toMatchObject({ ok: true, replayed: true });
    const board = Array.from({ length: 6 }, () => Array(7).fill(0));
    board[5]![0] = 1;
    board[5]![1] = 2;
    expect(payload.state).toMatchObject({ board });
  });

  it("rejects a guest start and keeps legacy clients working", async () => {
    const h = await fixture();
    await h.room.webSocketMessage(
      h.guestSocket,
      JSON.stringify({ type: "start_game", requestId: "guest-start" }),
    );
    expect(h.guestMessages.at(-1)).toMatchObject({
      type: "action_result",
      payload: { requestId: "guest-start", ok: false, message: "Only the host can start" },
    });
    await h.send("start_game");
    expect(h.messages.some((message) => message.type === "game_started")).toBe(true);
    expect(h.result()).toBeUndefined();
  });

  it("returns terminal state in the acknowledgement before final-delivery cleanup", async () => {
    const h = await fixture();
    await h.send("start_game", "start-123");
    await h.send("action", "end-123", "end_game");
    expect(h.result()).toMatchObject({
      type: "action_result",
      payload: { requestId: "end-123", ok: true, state: { status: "ended" } },
    });
    const endedIndex = h.messages.findIndex((message) => message.type === "game_ended");

    const resultIndex = h.messages.findIndex(
      (message) => message.type === "action_result" && message.payload.requestId === "end-123",
    );

    expect(endedIndex).toBeGreaterThanOrEqual(0);
    expect(resultIndex).toBeGreaterThan(endedIndex);
  });

  it("rejects multibyte payloads that exceed the byte limit", async () => {
    const h = await fixture();
    await h.send("action", "oversized-123", "drop_disc", { col: 0, text: "漢".repeat(12000) });
    expect(h.result()).toMatchObject({
      type: "action_result",
      payload: { requestId: "oversized-123", ok: false, message: "Invalid or oversized action" },
    });
  });
});
