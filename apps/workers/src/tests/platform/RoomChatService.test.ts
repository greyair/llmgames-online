import { describe, expect, it } from "vitest";
import type { WireValue } from "@llmgames/game-catalog";

import { RoomChatService } from "../../durable-objects/chat/RoomChatService";
import { CHAT_BURST, CHAT_RETENTION } from "../../durable-objects/chat/chatTypes";
import { ChatRateLimiter, normalizeChatText, normalizeChatMentions } from "../../durable-objects/chat/chatValidation";
import { MemoryRoomStorage } from "../fixtures/memory-runtime";
import { SqliteRoomSql } from "../fixtures/sqlite-room";
import type { RoomChatAuthor } from "../../durable-objects/chat/chatTypes";

/**
 * The chat store on its own: ordering, retention, policy and the pure limits.
 *
 * These run without a room so the window arithmetic can be exercised with a
 * simulated clock instead of real time.
 */

const members = new Set(["host", "guest"]);

const author = (playerId: string): RoomChatAuthor => ({
  playerId,
  displayName: playerId === "host" ? "Host" : "Guest",
  seatKind: "human",
  isHost: playerId === "host",
  isSpectator: false,
});

function service() {
  const storage = new MemoryRoomStorage(new Map());

  storage.sql = new SqliteRoomSql();

  return new RoomChatService(storage, (playerId) => (members.has(playerId) ? author(playerId) : null));
}

async function say(
  chat: RoomChatService,
  senderPlayerId: string,
  text: string,
  now: number,
  extra: { mentions?: WireValue; requestId?: string } = {},
) {
  return chat.append({
    senderPlayerId,
    text,
    mentions: extra.mentions,
    requestId: extra.requestId,
    isSpectator: false,
    members,
    now,
  });
}

describe("chat text normalisation", () => {
  it("collapses whitespace and keeps the trimmed text", () => {
    expect(normalizeChatText("  hi\n\nthere  ")).toEqual({ ok: true, text: "hi there" });
  });

  it("counts code points, so an emoji costs one character", () => {
    const text = "🚀".repeat(400);

    expect(normalizeChatText(text)).toEqual({ ok: true, text });
  });

  it("refuses an empty body and invisible-only content", () => {
    expect(normalizeChatText("\u200b \t").ok).toBe(false);
  });
});

describe("chat mentions", () => {
  it("deduplicates repeated ids", () => {
    expect(normalizeChatMentions(["guest", "guest"], members)).toEqual({
      ok: true,
      mentions: ["guest"],
    });
  });

  it("refuses an id that is not in the room", () => {
    const result = normalizeChatMentions(["outsider"], members);

    expect(result.ok).toBe(false);
  });

  it("treats a missing list as no mentions", () => {
    expect(normalizeChatMentions(undefined, members)).toEqual({ ok: true, mentions: [] });
  });
});

describe("chat rate limiter", () => {
  it("refills one token every refill window", () => {
    const limiter = new ChatRateLimiter();

    for (let index = 0; index < CHAT_BURST; index++) expect(limiter.take("host", 0)).toBe(true);

    expect(limiter.take("host", 0)).toBe(false);
    expect(limiter.take("host", 1_999)).toBe(false);
    expect(limiter.take("host", 2_000)).toBe(true);
  });
});

describe("chat service", () => {
  it("assigns one sequence per accepted message and prunes to retention", async () => {
    const chat = service();

    for (let index = 0; index < CHAT_RETENTION + 4; index++) {
      const result = await say(chat, "host", `line ${index}`, index * 2_000);

      expect(result.ok).toBe(true);
    }

    const page = await chat.read({ limit: 500 });

    expect(page.messages).toHaveLength(CHAT_RETENTION);
    expect(page.latestSeq).toBe(CHAT_RETENTION + 4);
    // The oldest rows are gone, but the newest keeps its own sequence.
    expect(page.messages.at(-1)?.seq).toBe(CHAT_RETENTION + 4);
    expect(page.messages[0]?.text).toBe("line 4");
  });

  it("replays a repeated requestId and refuses a reused one with new text", async () => {
    const chat = service();

    const first = await say(chat, "host", "hello", 0, { requestId: "a" });

    expect(first.ok && first.replayed).toBe(false);

    const replay = await say(chat, "host", "hello", 1_000, { requestId: "a" });

    expect(replay.ok && replay.replayed).toBe(true);
    expect(replay.ok && replay.message.seq).toBe(1);

    const reused = await say(chat, "host", "different", 4_000, { requestId: "a" });

    expect(reused.ok).toBe(false);

    const page = await chat.read({});

    expect(page.messages).toHaveLength(1);
  });

  it("returns the policy with every page and persists a change", async () => {
    const storage = new MemoryRoomStorage(new Map());

    storage.sql = new SqliteRoomSql();

    const first = new RoomChatService(storage, () => author("host"));

    await first.setPolicy({ spectatorSpeech: false });

    const second = new RoomChatService(storage, () => author("host"));
    const page = await second.read({});

    expect(page.policy.spectatorSpeech).toBe(false);
  });

  it("refuses a muted spectator", async () => {
    const chat = service();

    await chat.setPolicy({ spectatorSpeech: false });

    const result = await chat.append({
      senderPlayerId: "guest",
      text: "hello",
      isSpectator: true,
      members,
      now: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("CHAT_SPECTATORS_MUTED");
  });

  it("falls back to an unnamed author for a member who left", async () => {
    const chat = service();

    await say(chat, "host", "still here", 0);

    const page = await chat.read({ sinceSeq: 0, limit: 10 });

    expect(page.messages[0]?.author.displayName).toBe("Host");
    expect(page.cursor).toBe(1);
  });
});
