import { isNumber, isString, type WireValue } from "@llmgames/game-catalog";

import {
  CHAT_BURST,
  CHAT_MAX_MENTIONS,
  CHAT_MAX_TEXT_LENGTH,
  CHAT_REFILL_MS,
  type RoomChatRejection,
} from "./chatTypes";

/**
 * Pure chat input checks (C1).
 *
 * Everything here is deterministic and storage-free so the same rules run for
 * a WebSocket line and an MCP tool call, and so the limits can be unit-tested
 * without a room.
 */

/**
 * Control characters a chat line may never contain.
 *
 * A message is rendered as text, never as markup, so this is not an XSS filter;
 * it keeps terminal escapes and bidi overrides out of logs and replays. `\n`
 * and `\r` are handled by the whitespace collapse instead of being rejected,
 * because pasting a multi-line block is normal behaviour.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Zero-width and formatting characters that make one line look like another. */
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

export type ChatTextResult = { ok: true; text: string } | RoomChatRejection;

/**
 * Normalise one message body.
 *
 * Whitespace (including newlines from a paste) collapses to single spaces; the
 * length limit applies to the result, so a padded message cannot slip past it.
 */
export function normalizeChatText(raw: string): ChatTextResult {
  const collapsed = raw.replace(INVISIBLE_CHARS, "").replace(/\s+/g, " ").trim();

  if (!collapsed) return { ok: false, code: "CHAT_EMPTY", message: "Message is empty" };

  if (CONTROL_CHARS.test(collapsed))
    return {
      ok: false,
      code: "CHAT_CONTROL_CHARS",
      message: "Message contains characters that are not allowed",
    };

  // Count code points so an emoji cannot cost two of the limit.
  if ([...collapsed].length > CHAT_MAX_TEXT_LENGTH)
    return {
      ok: false,
      code: "CHAT_TOO_LONG",
      message: `Message is longer than ${CHAT_MAX_TEXT_LENGTH} characters`,
    };

  return { ok: true, text: collapsed };
}

export type ChatMentionResult = { ok: true; mentions: string[] } | RoomChatRejection;

/**
 * Keep only mention ids that are real room members.
 *
 * The client sends stable ids, so an unknown id is a client bug or an attempt to
 * address someone outside the room; either way it is refused instead of being
 * silently dropped, because a silently dropped mention would still look like a
 * private ping to the sender.
 */
export function normalizeChatMentions(
  raw: WireValue,
  members: ReadonlySet<string>,
): ChatMentionResult {
  if (raw === undefined || raw === null) return { ok: true, mentions: [] };

  if (!Array.isArray(raw)) return { ok: true, mentions: [] };

  const mentions: string[] = [];

  for (const value of raw) {
    if (!isString(value) || !value) continue;

    if (!members.has(value))
      return {
        ok: false,
        code: "CHAT_UNKNOWN_MENTION",
        message: "A mentioned player is not in this room",
      };

    if (!mentions.includes(value)) mentions.push(value);
  }

  if (mentions.length > CHAT_MAX_MENTIONS)
    return {
      ok: false,
      code: "CHAT_TOO_MANY_MENTIONS",
      message: `A message may mention at most ${CHAT_MAX_MENTIONS} players`,
    };

  return { ok: true, mentions };
}

/**
 * Per-member token bucket.
 *
 * Deliberately in memory: a restarted isolate grants a fresh burst instead of
 * persisting abuse counters next to game data. The hard bound that matters
 * (storage growth) is the retention window, not this bucket.
 */
export class ChatRateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  take(playerId: string, now: number): boolean {
    const bucket = this.buckets.get(playerId) ?? { tokens: CHAT_BURST, at: now };

    const refilled = Math.min(
      CHAT_BURST,
      bucket.tokens + Math.max(0, now - bucket.at) / CHAT_REFILL_MS,
    );

    if (refilled < 1) {
      this.buckets.set(playerId, { tokens: refilled, at: now });

      return false;
    }

    this.buckets.set(playerId, { tokens: refilled - 1, at: now });

    return true;
  }

  /** Forget a member who left, so a rejoin does not inherit a stale bucket. */
  forget(playerId: string): void {
    this.buckets.delete(playerId);
  }

  reset(): void {
    this.buckets.clear();
  }
}

/** Bounded read window: default 50, never more than the retention window. */
export function normalizeChatLimit(raw: WireValue, fallback: number, max: number): number {
  if (!isNumber(raw) || !Number.isFinite(raw)) return fallback;

  return Math.min(Math.max(Math.trunc(raw), 1), max);
}

/** Cursor: a non-negative integer sequence, or 0 to start from the oldest kept row. */
export function normalizeChatCursor(raw: WireValue): number {
  if (!isNumber(raw) || !Number.isFinite(raw) || raw < 0) return 0;

  return Math.trunc(raw);
}
