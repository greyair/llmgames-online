import { wireObjectSchema, wireValueSchema, type WireValue } from "@llmgames/game-catalog";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { ReversiRoom } from "../../durable-objects/ReversiRoom";
import type { BaseGameState, Player } from "../../durable-objects/types";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { SqliteRoomSql } from "../fixtures/sqlite-room";
import { roomTestEnv } from "../fixtures/room-env";

/**
 * The joint wait: `wait_for_turn` watching the board *and* room chat.
 *
 * Chat must stay a side channel. These tests pin the three properties that
 * matter: a mention wakes a waiting agent with the line that did it, an
 * ordinary line never wakes anyone (it arrives batched in the next result
 * instead), and neither touches the clock or the pending decision.
 */

class WaitRoom extends ReversiRoom {
  snapshot(): BaseGameState {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }

  seat(id: string, name: string, isSpectator = false) {
    const state = this.snapshot();
    const member = { id, name, channel: "browser" as const };

    if (isSpectator) state.spectators = [...(state.spectators ?? []), member];
    else state.players = [...state.players, member];
  }
}

const chatEntry = z.object({
  seq: z.number(),
  text: z.string(),
  senderPlayerId: z.string(),
  mentions: z.array(z.string()),
});

const waitSchema = z.object({
  timedOut: z.boolean(),
  reason: z.enum(["your_turn", "ended", "timeout", "waiting", "chat"]),
  revision: z.number(),
  state: wireObjectSchema.nullable().optional(),
  chat: z
    .object({
      messages: z.array(chatEntry),
      latestSeq: z.number(),
      hasMore: z.boolean(),
      cursor: z.number(),
    })
    .optional(),
});

type Wait = z.output<typeof waitSchema>;

async function startRoom(code: string) {
  const runtime = new MemoryRoomRuntime(new Map());

  runtime.storage.sql = new SqliteRoomSql();

  const room = new WaitRoom(runtime, roomTestEnv({}));
  await runtime.initialized;

  const created = await room.fetch(
    new Request("https://room.test/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hostId: "host",
        hostName: "Alex",
        roomCode: code,
        maxPlayers: 2,
      }),
    }),
  );

  expect(created.ok).toBe(true);

  room.seat("guest", "Guest");

  const started = await act(room, "host", "start_game");

  expect(started).toBe(true);

  const current = room.snapshot().turnState.currentPlayerId;
  const waiting = current === "host" ? "guest" : "host";

  return { room, runtime, waiting, mover: current! };
}

async function act(room: WaitRoom, playerId: string, actionType: string, data: WireValue = {}) {
  const response = await room.fetch(
    new Request("https://room.test/agent/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId, actionType, data }),
    }),
  );

  return z.object({ ok: z.boolean() }).parse(wireValueSchema.parse(await response.json())).ok;
}

function waitFor(
  room: WaitRoom,
  playerId: string,
  body: { timeoutMs?: number; chatSinceSeq?: number } = {},
): Promise<Wait> {
  return room
    .fetch(
      new Request("https://room.test/agent/wait-turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, ...body }),
      }),
    )
    .then(async (response) => waitSchema.parse(wireValueSchema.parse(await response.json())));
}

function say(room: WaitRoom, playerId: string, text: string, mentions: string[] = []) {
  return room
    .fetch(
      new Request("https://room.test/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, text, mentions }),
      }),
    )
    .then(async (response) => wireValueSchema.parse(await response.json()));
}

const timerOf = (room: WaitRoom) =>
  room
    .fetch(new Request("https://room.test/timer"))
    .then(async (response) => wireValueSchema.parse(await response.json()));

describe("wait_for_turn watches chat", () => {
  it("wakes on a mention with the line, its cursor and the state", async () => {
    const { room, waiting, mover } = await startRoom("WC4455");

    const pending = waitFor(room, waiting, { timeoutMs: 5_000 });

    // Give the waiter a moment to register before the line lands.
    await new Promise((resolve) => setTimeout(resolve, 50));

    await say(room, mover, `@${waiting} 你准备好了吗`, [waiting]);

    const result = await pending;

    expect(result.reason).toBe("chat");
    expect(result.timedOut).toBe(false);
    expect(result.chat?.messages.map((m) => m.text)).toEqual([`@${waiting} 你准备好了吗`]);
    expect(result.chat?.cursor).toBe(result.chat?.messages.at(-1)?.seq);
    // The state travels with the wake so answering does not cost a second call.
    expect(result.state).toBeTruthy();
  });

  it("does not wake for an ordinary line, but returns it in the next result", async () => {
    const { room, waiting, mover } = await startRoom("WC5566");

    const pending = waitFor(room, waiting, { timeoutMs: 600 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    await say(room, mover, "没什么事");
    await say(room, mover, "只是在自言自语");
    await say(room, mover, "再等等");

    const result = await pending;

    // Three lines, one wake: the model is not called once per message.
    expect(result.reason).toBe("timeout");
    expect(result.chat?.messages).toHaveLength(3);
    expect(result.chat?.cursor).toBe(3);

    // The cursor makes the batch idempotent.
    const again = await waitFor(room, waiting, { timeoutMs: 300, chatSinceSeq: 3 });

    expect(again.chat).toBeUndefined();
  });

  it("ignores mentions meant for someone else", async () => {
    const { room, waiting, mover } = await startRoom("WC6677");

    room.seat("watcher", "Watcher", true);

    const pending = waitFor(room, waiting, { timeoutMs: 400 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    await say(room, mover, "@watcher 说给你听", ["watcher"]);

    const result = await pending;

    expect(result.reason).toBe("timeout");
    // Addressed to another member, so it waits for a return rather than a wake.
    expect(result.chat?.messages).toHaveLength(1);
  });

  it("leaves the decision clock and turn untouched", async () => {
    const { room, waiting, mover } = await startRoom("WC7788");

    const before = await timerOf(room);
    const turnBefore = room.snapshot().turnState;

    const pending = waitFor(room, waiting, { timeoutMs: 5_000 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    await say(room, mover, `@${waiting} 快点`, [waiting]);

    const result = await pending;
    const after = await timerOf(room);

    expect(result.reason).toBe("chat");

    // Chat is not a game event: the deadline stays where it was. The remaining
    // milliseconds tick down on their own, so compare the deadlines, not them.
    const deadlines = (snapshot: typeof before) => {
      const clock = z
        .object({ clock: z.object({ turnEndsAt: z.number(), gameEndsAt: z.number() }) })
        .parse(snapshot);

      return clock.clock;
    };

    expect(deadlines(after)).toEqual(deadlines(before));
    expect(room.snapshot().turnState).toEqual(turnBefore);
    expect(room.snapshot().status).toBe("playing");
  });

  it("does not disturb the move that the wake interrupted", async () => {
    const { room, waiting, mover } = await startRoom("WC8899");

    const pending = waitFor(room, waiting, { timeoutMs: 5_000 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    await say(room, mover, `@${waiting} 轮到你的时候别忘了我`, [waiting]);

    expect((await pending).reason).toBe("chat");

    // The mover still plays, the turn still passes: the mention changed nothing.
    const played = await act(room, mover, "place_disc", { row: 2, col: 3 });

    expect(played).toBe(true);
  });

  it("keeps delivering after the agent replies and waits again", async () => {
    const { room, waiting, mover } = await startRoom("WC99AA");

    const pending = waitFor(room, waiting, { timeoutMs: 5_000 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    await say(room, mover, `@${waiting} 第一句`, [waiting]);

    const first = await pending;
    const cursor = first.chat?.cursor ?? 0;

    // The agent answers the mention, then resumes waiting from its cursor.
    await say(room, waiting, "收到", []);

    const second = waitFor(room, waiting, { timeoutMs: 400, chatSinceSeq: cursor });

    await new Promise((resolve) => setTimeout(resolve, 50));

    await say(room, mover, `@${waiting} 第二句`, [waiting]);

    const next = await second;

    expect(next.reason).toBe("chat");
    expect(next.chat?.messages.map((m) => m.text)).toEqual([`@${waiting} 第二句`]);
    expect(next.chat!.messages[0]!.seq).toBeGreaterThan(cursor);
  });
});
