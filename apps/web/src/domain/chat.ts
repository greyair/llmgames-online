import { z } from "zod";

/**
 * Room chat wire contract (C1).
 *
 * The server owns the shape; this is the browser's defensive copy. A frame
 * that does not match is dropped rather than rendered, so a server change can
 * never put arbitrary markup or a missing field into the message list.
 */
export const chatAuthorSchema = z.object({
  playerId: z.string(),
  displayName: z.string(),
  seatKind: z.enum(["human", "mcp", "bot"]),
  isHost: z.boolean(),
  isSpectator: z.boolean(),
  codename: z.string().optional(),
  environmentLabel: z.string().optional(),
});

export const chatEntrySchema = z.object({
  seq: z.number().int().nonnegative(),
  id: z.string(),
  senderPlayerId: z.string(),
  text: z.string(),
  mentions: z.array(z.string()),
  createdAt: z.number(),
  author: chatAuthorSchema,
});

export const chatPageSchema = z.object({
  messages: z.array(chatEntrySchema),
  latestSeq: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  cursor: z.number().int().nonnegative(),
  policy: z.object({ spectatorSpeech: z.boolean() }).optional(),
});

export type RoomChatEntry = z.output<typeof chatEntrySchema>;

export type RoomChatPage = z.output<typeof chatPageSchema>;

/** Longest accepted message; mirrors the server's cap so the composer can warn early. */
export const CHAT_MAX_TEXT = 400;

/**
 * Merge an incoming page into the list the panel already has.
 *
 * A reconnect snapshot replaces what is there (the server's window is
 * authoritative); a cursor page appends the rows it has not seen. Ordering is
 * always by sequence, which is why the server keeps it monotonic.
 */
export function mergeChat(
  current: readonly RoomChatEntry[],
  page: RoomChatPage,
  mode: "snapshot" | "append",
): RoomChatEntry[] {
  const source = mode === "snapshot" ? page.messages : [...current, ...page.messages];
  const bySeq = new Map<number, RoomChatEntry>();

  for (const entry of source) bySeq.set(entry.seq, entry);

  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
