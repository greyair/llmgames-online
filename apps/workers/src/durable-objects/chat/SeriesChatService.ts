import type { WireValue } from "@llmgames/game-catalog";

import type { RoomStorage } from "../runtime";
import { randomId } from "../../lib/csprng";

import {
  CHAT_DEFAULT_PAGE,
  CHAT_MAX_PAGE,
  CHAT_RECEIPT_MEMORY,
  CHAT_RETENTION,
  type RoomChatAuthor,
  type RoomChatEntry,
  type RoomChatPage,
  type RoomChatPolicy,
  type RoomChatSendResult,
} from "./chatTypes";
import {
  ChatRateLimiter,
  normalizeChatCursor,
  normalizeChatLimit,
  normalizeChatMentions,
  normalizeChatText,
} from "./chatValidation";

const ENTRIES_KEY = "seriesChatEntries";

const RECEIPTS_KEY = "seriesChatReceipts";

const POLICY_KEY = "seriesChatPolicy";

interface Receipt {
  seq: number;
  fingerprint: string;
  at: number;
}

/**
 * The one conversation for a whole series, not one conversation per match.
 *
 * Match rooms come and go with their own Durable Objects, so a room-owned chat
 * store is emptied every time a new game starts. This store lives in the
 * series DO instead and keeps complete entries — including the author snapshot —
 * because a sender's room-scoped playerId no longer resolves in a later match.
 *
 * Key/value storage is enough here: the retention window bounds the array to a
 * few hundred small rows, and the series DO serialises every mutation.
 */
export class SeriesChatService {
  private readonly limiter = new ChatRateLimiter();

  constructor(private readonly storage: RoomStorage) {}

  private async entries(): Promise<RoomChatEntry[]> {
    return (await this.storage.get<RoomChatEntry[]>(ENTRIES_KEY)) ?? [];
  }

  private async receipts(): Promise<Record<string, Receipt>> {
    return (await this.storage.get<Record<string, Receipt>>(RECEIPTS_KEY)) ?? {};
  }

  private async policy(): Promise<RoomChatPolicy> {
    const stored = await this.storage.get<RoomChatPolicy>(POLICY_KEY);

    return { spectatorSpeech: stored?.spectatorSpeech !== false };
  }

  async getPolicy(): Promise<RoomChatPolicy> {
    return this.policy();
  }

  async setPolicy(next: RoomChatPolicy): Promise<RoomChatPolicy> {
    await this.storage.put(POLICY_KEY, { spectatorSpeech: next.spectatorSpeech });

    return { spectatorSpeech: next.spectatorSpeech };
  }

  async append(input: {
    senderPlayerId: string;
    text: string;
    mentions?: WireValue;
    requestId?: string;
    isSpectator: boolean;
    members: ReadonlySet<string>;
    author: RoomChatAuthor;
    now?: number;
  }): Promise<RoomChatSendResult> {
    const now = input.now ?? Date.now();
    const policy = await this.policy();

    if (input.isSpectator && !policy.spectatorSpeech)
      return {
        ok: false,
        code: "CHAT_SPECTATORS_MUTED",
        message: "Spectators cannot speak in this series",
      };

    const text = normalizeChatText(input.text);

    if (!text.ok) return text;

    const mentions = normalizeChatMentions(input.mentions, input.members);

    if (!mentions.ok) return mentions;

    const fingerprint = `${text.text}|${mentions.mentions.join(",")}`;

    const requestKey = input.requestId
      ? `${input.senderPlayerId}:${input.requestId}`
      : undefined;

    if (requestKey) {
      const receipts = await this.receipts();
      const replay = receipts[requestKey];

      if (replay) {
        if (replay.fingerprint !== fingerprint)
          return {
            ok: false,
            code: "CHAT_RATE_LIMITED",
            message: "This requestId was already used for another message",
          };

        const existing = (await this.entries()).find((entry) => entry.seq === replay.seq);

        if (existing) return { ok: true, message: existing, replayed: true };
      }
    }

    if (!this.limiter.take(input.senderPlayerId, now))
      return {
        ok: false,
        code: "CHAT_RATE_LIMITED",
        message: "You are sending messages too quickly",
      };

    const previous = await this.entries();
    const seq = (previous.at(-1)?.seq ?? 0) + 1;

    const entry: RoomChatEntry = {
      id: randomId(),
      seq,
      senderPlayerId: input.senderPlayerId,
      text: text.text,
      mentions: mentions.mentions,
      createdAt: now,
      author: input.author,
    };

    try {
      await this.storage.put(ENTRIES_KEY, [...previous, entry].slice(-CHAT_RETENTION));

      if (requestKey) {
        const receipts = await this.receipts();

        receipts[requestKey] = { seq, fingerprint, at: now };

        const bounded = Object.entries(receipts)
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, CHAT_RECEIPT_MEMORY);

        await this.storage.put(RECEIPTS_KEY, Object.fromEntries(bounded));
      }
    } catch (error) {
      console.error("Series chat write failed", error);

      return {
        ok: false,
        code: "CHAT_STORAGE_FAILED",
        message: "The server could not save this message",
      };
    }

    return { ok: true, message: entry, replayed: false };
  }

  async read(input: { sinceSeq?: WireValue; limit?: WireValue } = {}): Promise<RoomChatPage> {
    const since = normalizeChatCursor(input.sinceSeq);
    const limit = normalizeChatLimit(input.limit, CHAT_DEFAULT_PAGE, CHAT_MAX_PAGE);
    const rows = await this.entries();
    const latestSeq = rows.at(-1)?.seq ?? 0;
    const after = rows.filter((entry) => entry.seq > since);
    const messages = after.slice(0, limit);

    return {
      messages,
      latestSeq,
      hasMore: after.length > limit,
      cursor: messages.at(-1)?.seq ?? since,
      policy: await this.policy(),
    };
  }

  async recent(limit = CHAT_DEFAULT_PAGE): Promise<RoomChatPage> {
    const rows = await this.entries();
    const tail = rows.slice(-Math.min(limit, CHAT_MAX_PAGE));

    return {
      messages: tail,
      latestSeq: rows.at(-1)?.seq ?? 0,
      hasMore: rows.length > tail.length,
      cursor: tail.at(-1)?.seq ?? 0,
      policy: await this.policy(),
    };
  }

  async latestSeqValue(): Promise<number> {
    return (await this.entries()).at(-1)?.seq ?? 0;
  }
}
