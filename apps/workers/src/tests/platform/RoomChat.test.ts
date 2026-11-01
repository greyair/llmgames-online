import { describe, expect, it } from "vitest";
import { wireObjectSchema, wireValueSchema, type WireValue } from "@llmgames/game-catalog";
import { z } from "zod";

import { BaseGameRoom } from "../../durable-objects/BaseGameRoom";
import type { BaseGameState, Player } from "../../durable-objects/types";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { SqliteRoomSql } from "../fixtures/sqlite-room";
import { TestRoomSocket } from "../fixtures/socket";
import { roomTestEnv } from "../fixtures/room-env";
import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";
import { CHAT_BURST, CHAT_MAX_TEXT_LENGTH } from "../../durable-objects/chat/chatTypes";

/**
 * C1 room chat, exercised through the two real entry points.
 *
 * `chat_send` arrives on a socket exactly as the browser sends it, and
 * `/agent/chat` exactly as the MCP worker calls it, so these tests cover the
 * same store, policy and ordering the deployed room uses.
 */

class ChatTestRoom extends BaseGameRoom<BaseGameState> {
  protected readonly roomLabel = "ChatTestRoom";

  protected createDefaultState(
    config: { hostId: string; hostName: string },
    roomCode: string,
  ): BaseGameState {
    const now = Date.now();

    return {
      id: "chat-room-id",
      roomCode,
      type: "connect4",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      spectators: [],
      hostId: config.hostId,
      maxPlayers: 4,
      timerConfig: { gameTotalTime: 600_000, turnTime: 30_000 },
      gameTimeRemaining: 600_000,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: 30_000,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ROOM_LIFETIME_MS,
    };
  }

  protected async handleGameAction(
    _player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string> {
    return `Unknown action: ${payload.actionType}`;
  }

  /** Tests own the socket set; the runtime has no hibernated sockets. */
  protected restoreSessions(): void {}

  attach(ws: WebSocket, player: Player): void {
    this.sessions.set(ws, player);
  }

  snapshot() {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }
}

/** One frame the room sent, parsed at the boundary like a real client would. */
const frameSchema = z.object({ type: z.string(), payload: wireObjectSchema });

type Frame = z.output<typeof frameSchema>;

const entrySchema = z.object({
  seq: z.number(),
  text: z.string(),
  senderPlayerId: z.string(),
  mentions: z.array(z.string()),
  author: wireObjectSchema,
});

const pageSchema = z.object({
  messages: z.array(entrySchema),
  latestSeq: z.number(),
  hasMore: z.boolean(),
  cursor: z.number(),
});

const sentSchema = z.object({ ok: z.boolean(), replayed: z.boolean(), message: entrySchema });

const player = (id: string, name: string, extra: Partial<Player> = {}): Player => ({
  id,
  name,
  socket: null,
  isConnected: true,
  joinedAt: 0,
  isSpectator: false,
  ...extra,
});

function framesOf(socket: TestRoomSocket): Frame[] {
  return socket.messages.map((message) => frameSchema.parse(JSON.parse(String(message))));
}

function lastFrame(socket: TestRoomSocket): Frame {
  const frame = framesOf(socket).at(-1);

  if (!frame) throw new Error("The socket received no frame");

  return frame;
}

/** The chat refusal code carried by an `error`-shaped frame. */
function chatErrorCode(frame: Frame): WireValue {
  return wireObjectSchema.parse(frame.payload).code;
}

interface RoomFixture {
  room: ChatTestRoom;
  runtime: MemoryRoomRuntime;
  socket: TestRoomSocket;
  chatSend(socket: TestRoomSocket, body: WireValue): Promise<Frame>;
}

/**
 * Build a room over the given storage.
 *
 * `create: false` wakes an existing room on the same storage, which is what a
 * Durable Object restart looks like and what the reconnect tests need.
 */
async function createRoom(
  storage = new Map<string, unknown>(),
  sql: SqliteRoomSql | null = new SqliteRoomSql(),
  options: { create?: boolean } = {},
): Promise<RoomFixture> {
  const runtime = new MemoryRoomRuntime(storage);

  if (sql) runtime.storage.sql = sql;

  const room = new ChatTestRoom(runtime, roomTestEnv());
  await runtime.initialized;

  if (options.create !== false) {
    const created = await room.fetch(
      new Request("https://room.test/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostId: "host", hostName: "Host", roomCode: "ABC234", maxPlayers: 4 }),
      }),
    );

    expect(created.ok).toBe(true);
  }

  const socket = new TestRoomSocket();
  room.attach(socket, player("host", "Host"));

  return {
    room,
    runtime,
    socket,
    chatSend: async (target, body) => {
      await room.webSocketMessage(target, JSON.stringify({ type: "chat_send", payload: body }));

      return lastFrame(target);
    },
  };
}

/** Add a seated human or a watcher to the room's roster, as a join would. */
function seat(room: ChatTestRoom, id: string, name: string, isSpectator = false): TestRoomSocket {
  const state = room.snapshot();
  const member = { id, name, channel: "browser" as const };

  if (isSpectator) state.spectators = [...(state.spectators ?? []), member];
  else state.players = [...state.players, member];

  const socket = new TestRoomSocket();
  room.attach(socket, player(id, name, { isSpectator }));

  return socket;
}

async function postChat(room: ChatTestRoom, body: Record<string, WireValue>) {
  const response = await room.fetch(
    new Request("https://room.test/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

  return { status: response.status, body: wireValueSchema.parse(await response.json()) };
}

async function readChat(room: ChatTestRoom, query: string) {
  const response = await room.fetch(new Request(`https://room.test/agent/chat?${query}`));

  return { status: response.status, body: wireValueSchema.parse(await response.json()) };
}

function pageOf(body: WireValue) {
  return pageSchema.parse(body);
}

describe("room chat over WebSocket", () => {
  it("delivers a human message to every member in the room", async () => {
    const fixture = await createRoom();
    const rival = seat(fixture.room, "guest", "Guest");
    const watcher = seat(fixture.room, "watcher", "Watcher", true);

    const frame = await fixture.chatSend(fixture.socket, { text: "  hello   table  " });
    const entry = entrySchema.parse(frame.payload);

    expect(frame.type).toBe("chat_message");
    expect(entry.text).toBe("hello table");
    expect(entry.seq).toBe(1);

    expect(entry.author).toMatchObject({
      playerId: "host",
      displayName: "Host",
      seatKind: "human",
      isHost: true,
      isSpectator: false,
    });

    expect(lastFrame(rival).type).toBe("chat_message");
    expect(lastFrame(watcher).type).toBe("chat_message");
  });

  it("refuses a client-supplied sender identity instead of trusting it", async () => {
    const fixture = await createRoom();
    seat(fixture.room, "guest", "Guest");

    // `senderPlayerId` is not part of the client contract; it must be ignored.
    const frame = await fixture.chatSend(fixture.socket, {
      text: "I am the guest",
      senderPlayerId: "guest",
    });

    expect(frame.type).toBe("chat_message");
    expect(entrySchema.parse(frame.payload).senderPlayerId).toBe("host");
  });

  it("rejects an empty, oversized or control-character message without storing it", async () => {
    const fixture = await createRoom();

    expect(chatErrorCode(await fixture.chatSend(fixture.socket, { text: "   " }))).toBe(
      "CHAT_EMPTY",
    );

    expect(
      chatErrorCode(
        await fixture.chatSend(fixture.socket, { text: "x".repeat(CHAT_MAX_TEXT_LENGTH + 1) }),
      ),
    ).toBe("CHAT_TOO_LONG");

    expect(
      chatErrorCode(await fixture.chatSend(fixture.socket, { text: "escape\u001b[31mred" })),
    ).toBe("CHAT_CONTROL_CHARS");

    expect(pageOf((await readChat(fixture.room, "playerId=host")).body).messages).toEqual([]);
  });

  it("limits a member to a burst, then refuses without writing", async () => {
    const fixture = await createRoom();

    for (let index = 0; index < CHAT_BURST; index++)
      expect((await fixture.chatSend(fixture.socket, { text: `line ${index}` })).type).toBe(
        "chat_message",
      );

    const refused = await fixture.chatSend(fixture.socket, { text: "too fast" });

    expect(refused.type).toBe("chat_error");
    expect(chatErrorCode(refused)).toBe("CHAT_RATE_LIMITED");

    expect(
      pageOf((await readChat(fixture.room, "playerId=host&limit=100")).body).messages,
    ).toHaveLength(CHAT_BURST);
  });

  it("keeps one message for a repeated requestId", async () => {
    const fixture = await createRoom();

    await fixture.room.webSocketMessage(
      fixture.socket,
      JSON.stringify({ type: "chat_send", requestId: "r1", payload: { text: "once" } }),
    );
    await fixture.room.webSocketMessage(
      fixture.socket,
      JSON.stringify({ type: "chat_send", requestId: "r1", payload: { text: "once" } }),
    );

    const page = pageOf((await readChat(fixture.room, "playerId=host")).body);

    expect(page.messages).toHaveLength(1);
    expect(page.latestSeq).toBe(1);
  });

  it("allocates a monotonic sequence across senders", async () => {
    const fixture = await createRoom();
    const guest = seat(fixture.room, "guest", "Guest");

    await fixture.chatSend(fixture.socket, { text: "first" });
    await fixture.chatSend(guest, { text: "second" });
    await fixture.chatSend(fixture.socket, { text: "third" });

    const page = pageOf((await readChat(fixture.room, "playerId=host")).body);

    expect(page.messages.map((message) => message.seq)).toEqual([1, 2, 3]);
  });

  it("answers a cursor request with only the newer messages", async () => {
    const fixture = await createRoom();

    for (const text of ["one", "two", "three"]) await fixture.chatSend(fixture.socket, { text });

    await fixture.room.webSocketMessage(
      fixture.socket,
      JSON.stringify({ type: "chat_fetch", payload: { sinceSeq: 2 } }),
    );

    const page = pageOf(lastFrame(fixture.socket).payload);

    expect(lastFrame(fixture.socket).type).toBe("chat_history");
    expect(page.messages.map((message) => message.text)).toEqual(["three"]);
    expect(page.hasMore).toBe(false);
    expect(page.cursor).toBe(3);
  });

  it("bounds a read and reports that more remains", async () => {
    const fixture = await createRoom();

    for (let index = 0; index < 4; index++)
      await fixture.chatSend(fixture.socket, { text: `m${index}` });

    const page = pageOf((await readChat(fixture.room, "playerId=host&limit=2")).body);

    expect(page.messages).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toBe(2);
  });

  it("resolves a mention to a member id and refuses an outsider", async () => {
    const fixture = await createRoom();
    const guest = seat(fixture.room, "guest", "Guest");

    const frame = await fixture.chatSend(fixture.socket, { text: "your move", mentions: ["guest"] });

    expect(entrySchema.parse(frame.payload).mentions).toEqual(["guest"]);

    // The mention is public: the mentioned seat reads it like anyone else.
    expect(entrySchema.parse(lastFrame(guest).payload).mentions).toEqual(["guest"]);

    const refused = await fixture.chatSend(fixture.socket, {
      text: "stranger",
      mentions: ["not-in-room"],
    });

    expect(chatErrorCode(refused)).toBe("CHAT_UNKNOWN_MENTION");
  });

  it("mutes spectators only when the host says so", async () => {
    const fixture = await createRoom();
    const watcher = seat(fixture.room, "watcher", "Watcher", true);

    expect((await fixture.chatSend(watcher, { text: "watching" })).type).toBe("chat_message");

    await fixture.room.webSocketMessage(
      fixture.socket,
      JSON.stringify({
        type: "action",
        payload: { actionType: "set_spectator_chat", data: { allowed: false } },
      }),
    );

    const muted = await fixture.chatSend(watcher, { text: "still here" });

    expect(muted.type).toBe("chat_error");
    expect(chatErrorCode(muted)).toBe("CHAT_SPECTATORS_MUTED");
  });

  it("refuses a non-member on both entry points", async () => {
    const fixture = await createRoom();

    expect((await postChat(fixture.room, { playerId: "outsider", text: "hi" })).status).toBe(403);
    expect((await readChat(fixture.room, "playerId=outsider")).status).toBe(403);
  });

  it("keeps markup as literal text", async () => {
    const fixture = await createRoom();
    const payload = `<img src=x onerror="alert(1)">`;

    const frame = await fixture.chatSend(fixture.socket, { text: payload });
    const page = pageOf((await readChat(fixture.room, "playerId=host")).body);

    expect(entrySchema.parse(frame.payload).text).toBe(payload);
    expect(page.messages[0]?.text).toBe(payload);
  });

  it("does not touch the turn, the clock or the room timestamp", async () => {
    const fixture = await createRoom();
    const before = fixture.room.snapshot();
    const turnBefore = { ...before.turnState };
    const updatedBefore = before.updatedAt;

    await fixture.chatSend(fixture.socket, { text: "just talking" });

    const after = fixture.room.snapshot();

    expect(after.turnState).toEqual(turnBefore);
    expect(after.updatedAt).toBe(updatedBefore);
    expect(after.status).toBe("waiting");
  });
});

describe("room chat across MCP and WebSocket", () => {
  it("broadcasts an MCP message to browser sockets", async () => {
    const fixture = await createRoom();
    seat(fixture.room, "guest", "Guest", false);

    const sent = await postChat(fixture.room, {
      playerId: "guest",
      text: "agent speaking",
      mentions: ["host"],
    });

    expect(sent.status).toBe(200);
    expect(sentSchema.parse(sent.body).ok).toBe(true);

    const frame = lastFrame(fixture.socket);
    const entry = entrySchema.parse(frame.payload);

    expect(frame.type).toBe("chat_message");
    expect(entry.text).toBe("agent speaking");
    expect(entry.mentions).toEqual(["host"]);
  });

  it("lets MCP read a message a human just sent", async () => {
    const fixture = await createRoom();
    seat(fixture.room, "guest", "Guest");

    await fixture.chatSend(fixture.socket, { text: "human here" });

    const page = pageOf((await readChat(fixture.room, "playerId=guest")).body);

    expect(page.messages[0]?.text).toBe("human here");
  });

  it("replays an MCP requestId without posting twice", async () => {
    const fixture = await createRoom();
    seat(fixture.room, "guest", "Guest");

    const first = await postChat(fixture.room, {
      playerId: "guest",
      text: "once",
      requestId: "m1",
    });

    const second = await postChat(fixture.room, {
      playerId: "guest",
      text: "once",
      requestId: "m1",
    });

    expect(sentSchema.parse(first.body).replayed).toBe(false);
    expect(sentSchema.parse(second.body).replayed).toBe(true);
    expect(pageOf((await readChat(fixture.room, "playerId=host")).body).messages).toHaveLength(1);
  });

  it("keeps the conversation across a Durable Object restart", async () => {
    const storage = new Map<string, unknown>();
    const sql = new SqliteRoomSql();

    const first = await createRoom(storage, sql);

    seat(first.room, "guest", "Guest");
    await first.chatSend(first.socket, { text: "before restart" });

    // A wake on the same storage: the sequence must continue, not restart at 1.
    const second = await createRoom(storage, sql, { create: false });
    const restored = pageOf((await readChat(second.room, "playerId=host")).body);

    expect(restored.messages[0]?.text).toBe("before restart");
    expect(restored.latestSeq).toBe(1);

    await second.chatSend(second.socket, { text: "after restart" });

    const next = pageOf((await readChat(second.room, "playerId=host&sinceSeq=1")).body);

    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]?.seq).toBe(2);
  });

  it("reports a storage failure instead of a false success", async () => {
    const fixture = await createRoom();

    fixture.runtime.storage.sql = {
      exec() {
        throw new Error("sqlite unavailable");
      },
    };

    expect((await postChat(fixture.room, { playerId: "host", text: "into the void" })).status).toBe(
      500,
    );

    const frame = await fixture.chatSend(fixture.socket, { text: "into the void" });

    expect(frame.type).toBe("chat_error");
    expect(chatErrorCode(frame)).toBe("CHAT_STORAGE_FAILED");
  });

  it("carries no projected game state in a chat frame", async () => {
    const fixture = await createRoom();

    await fixture.chatSend(fixture.socket, { text: "nothing private" });

    expect(Object.keys(lastFrame(fixture.socket).payload).sort()).toEqual([
      "author",
      "createdAt",
      "id",
      "mentions",
      "senderPlayerId",
      "seq",
      "text",
    ]);
  });
});
