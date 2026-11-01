import { describe, expect, it } from "vitest";

import { chatEntrySchema, chatPageSchema, mergeChat } from "../../src/domain/chat";

/**
 * Browser chat contract (C1).
 *
 * The panel must survive a frame it does not recognise without rendering it,
 * and a reconnect must never duplicate a line the reader already has.
 */

const entry = (seq: number, text = `line ${seq}`) => ({
  seq,
  id: `id-${seq}`,
  senderPlayerId: "host",
  text,
  mentions: [],
  createdAt: 1_700_000_000_000 + seq,
  author: {
    playerId: "host",
    displayName: "Host",
    seatKind: "human" as const,
    isHost: true,
    isSpectator: false,
  },
});

const page = (
  messages: ReturnType<typeof entry>[],
  policy: { spectatorSpeech: boolean } | undefined = { spectatorSpeech: true },
) => ({
  messages,
  latestSeq: messages.at(-1)?.seq ?? 0,
  hasMore: false,
  cursor: messages.at(-1)?.seq ?? 0,
  policy,
});

describe("chat wire contract", () => {
  it("accepts a well-formed entry", () => {
    expect(chatEntrySchema.safeParse(entry(1)).success).toBe(true);
  });

  it("rejects an entry without an author identity", () => {
    expect(chatEntrySchema.safeParse({ ...entry(1), author: undefined }).success).toBe(false);
  });

  it("rejects a negative sequence", () => {
    expect(chatEntrySchema.safeParse({ ...entry(1), seq: -1 }).success).toBe(false);
  });

  it("accepts a page with a policy and one without", () => {
    expect(chatPageSchema.safeParse(page([entry(1)])).success).toBe(true);
    expect(chatPageSchema.safeParse(page([entry(1)], undefined)).success).toBe(true);
  });
});

describe("mergeChat", () => {
  it("orders by sequence regardless of arrival order", () => {
    const merged = mergeChat([entry(2)], page([entry(1), entry(3)]), "append");

    expect(merged.map((line) => line.seq)).toEqual([1, 2, 3]);
  });

  it("keeps one copy of a message that arrives twice", () => {
    const merged = mergeChat([entry(1), entry(2)], page([entry(2), entry(3)]), "append");

    expect(merged.map((line) => line.seq)).toEqual([1, 2, 3]);
  });

  it("replaces the window on a reconnect snapshot", () => {
    const merged = mergeChat([entry(1), entry(2)], page([entry(7)]), "snapshot");

    expect(merged.map((line) => line.seq)).toEqual([7]);
  });
});
