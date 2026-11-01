import { isFunction, isString, wireValueSchema, type WireValue } from "@llmgames/game-catalog";

import type { RoomSql, RoomStorage } from "../runtime";
import { randomId } from "../../lib/csprng";

import {
  CHAT_DEFAULT_PAGE,
  CHAT_MAX_PAGE,
  CHAT_RECEIPT_MEMORY,
  CHAT_RETENTION,
  type RoomChatAuthor,
  type RoomChatEntry,
  type RoomChatMessage,
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

/** Storage key for the room chat policy; deliberately outside `gameState`. */
const CHAT_POLICY_KEY = "chatPolicy";

/**
 * The one chat store for a room (C1).
 *
 * WebSocket `chat_send` and MCP `send_room_message` both end up here, which is
 * what makes them the same conversation instead of two parallel logs. The
 * service owns ordering, idempotency, retention and the read window; it knows
 * nothing about game rules, clocks or turns, and it never touches `gameState`.
 *
 * Storage is the room's own SQLite space (`storage.sql`). Test shims without
 * SQL fall back to in-memory arrays with identical semantics, so the platform
 * tests exercise the same code path the deployed room runs.
 */
export class RoomChatService {
  private ready: Promise<void> | null = null;
  private nextSeq = 1;
  private latestSeq = 0;
  private policy: RoomChatPolicy = { spectatorSpeech: true };
  private readonly limiter = new ChatRateLimiter();
  private fallbackMessages: RoomChatMessage[] = [];
  private fallbackReceipts = new Map<string, { seq: number; fingerprint: string; at: number }>();
  /** Keep the resolved authors of already stored messages cheap to re-render. */
  private cache = new Map<number, RoomChatMessage>();

  constructor(
    private readonly storage: RoomStorage,
    private readonly resolveAuthor: (playerId: string) => RoomChatAuthor | null,
  ) {}

  private sql(): RoomSql | null {
    return this.storage.sql ?? null;
  }

  /**
   * Create the chat tables and restore the sequence counters.
   *
   * Called once per isolate on first use. A room that was already purged keeps
   * answering with "not a member" before it ever reaches chat, so this cannot
   * resurrect storage after `deleteAll()`.
   */
  async initialize(): Promise<void> {
    if (this.ready) return this.ready;

    this.ready = (async () => {
      const stored = await this.storage.get<RoomChatPolicy>(CHAT_POLICY_KEY);

      if (stored) this.policy = { spectatorSpeech: stored.spectatorSpeech !== false };

      const sql = this.sql();

      if (!sql) return;
      sql.exec(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          seq INTEGER PRIMARY KEY,
          id TEXT NOT NULL,
          sender TEXT NOT NULL,
          text TEXT NOT NULL,
          mentions_json TEXT,
          at INTEGER NOT NULL
        )
      `);
      sql.exec(`
        CREATE TABLE IF NOT EXISTS chat_receipts (
          request_key TEXT PRIMARY KEY,
          sender TEXT NOT NULL,
          seq INTEGER NOT NULL,
          fingerprint TEXT NOT NULL,
          at INTEGER NOT NULL
        )
      `);

      const row = sql
        .exec<{ max_seq: number | null }>("SELECT MAX(seq) AS max_seq FROM chat_messages")
        .toArray()[0];

      this.latestSeq = row?.max_seq ?? 0;
      this.nextSeq = this.latestSeq + 1;
    })();

    return this.ready;
  }

  /**
   * Initialise, and forget a failed attempt.
   *
   * A rejected `initialize()` promise would otherwise stay cached and turn every
   * later message into an exception instead of a clear storage refusal.
   */
  private async readyOrFail(): Promise<boolean> {
    try {
      await this.initialize();

      return true;
    } catch (error) {
      console.error("Room chat storage unavailable", error);
      this.ready = null;

      return false;
    }
  }

  /** Current policy, safe to hand to a client. */
  getPolicy(): RoomChatPolicy {
    return { ...this.policy };
  }

  setPolicy(policy: RoomChatPolicy): Promise<RoomChatPolicy> {
    this.policy = { ...policy };

    // Persisted beside the chat tables, never inside `gameState`: muting
    // spectators must not change the game, its replay or its archive.
    return this.storage.put(CHAT_POLICY_KEY, this.policy).then(() => this.getPolicy());
  }

  /**
   * Append one message.
   *
   * Order of checks matches the platform rule that a refusal must not write
   * anything: identity first (the caller already proved it), then shape, then
   * rate, then idempotency, then storage. A repeated `requestId` replays the
   * first outcome instead of posting a second identical line.
   */
  async append(input: {
    senderPlayerId: string;
    text: string;
    mentions?: WireValue;
    requestId?: string;
    isSpectator: boolean;
    members: ReadonlySet<string>;
    now?: number;
  }): Promise<RoomChatSendResult> {
    if (!(await this.readyOrFail()))
      return {
        ok: false,
        code: "CHAT_STORAGE_FAILED",
        message: "The server could not save this message",
      };

    const now = input.now ?? Date.now();

    if (input.isSpectator && !this.policy.spectatorSpeech)
      return {
        ok: false,
        code: "CHAT_SPECTATORS_MUTED",
        message: "Spectators cannot speak in this room",
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
      const replay = this.findReceipt(requestKey);

      if (replay && replay.fingerprint === fingerprint) {
        const existing = this.messageAt(replay.seq);

        if (existing) return { ok: true, message: this.decorate(existing), replayed: true };
      }

      if (replay && replay.fingerprint !== fingerprint)
        return {
          ok: false,
          code: "CHAT_RATE_LIMITED",
          message: "This requestId was already used for another message",
        };
    }

    if (!this.limiter.take(input.senderPlayerId, now))
      return {
        ok: false,
        code: "CHAT_RATE_LIMITED",
        message: "You are sending messages too quickly",
      };

    // Allocated before the first await so two interleaved sends can never share
    // a sequence number; a refused write leaves a gap, which a cursor tolerates.
    const seq = this.nextSeq++;

    const message: RoomChatMessage = {
      id: randomId(),
      seq,
      senderPlayerId: input.senderPlayerId,
      text: text.text,
      mentions: mentions.mentions,
      createdAt: now,
    };

    try {
      this.write(message, requestKey, fingerprint);
    } catch (error) {
      console.error("Room chat write failed", error);

      return {
        ok: false,
        code: "CHAT_STORAGE_FAILED",
        message: "The server could not save this message",
      };
    }

    this.latestSeq = Math.max(this.latestSeq, seq);

    return { ok: true, message: this.decorate(message), replayed: false };
  }

  /** Bounded read after a cursor. Never returns the whole room. */
  async read(input: { sinceSeq?: WireValue; limit?: WireValue } = {}): Promise<RoomChatPage> {
    const since = normalizeChatCursor(input.sinceSeq);

    if (!(await this.readyOrFail()))
      return {
        messages: [],
        latestSeq: this.latestSeq,
        hasMore: false,
        cursor: since,
        policy: this.getPolicy(),
      };
    const limit = normalizeChatLimit(input.limit, CHAT_DEFAULT_PAGE, CHAT_MAX_PAGE);
    const rows = this.rowsAfter(since);

    return {
      messages: rows.slice(0, limit).map((row) => this.decorate(row)),
      latestSeq: this.latestSeq,
      hasMore: rows.length > limit,
      cursor: rows.length > 0 ? (rows[Math.min(rows.length, limit) - 1]?.seq ?? since) : since,
      policy: this.getPolicy(),
    };
  }

  /**
   * The window a socket receives on connect.
   *
   * The newest page, oldest first, so a reconnecting client renders the same
   * conversation it had before without asking for a cursor it no longer has.
   */
  async recent(limit = CHAT_DEFAULT_PAGE): Promise<RoomChatPage> {
    if (!(await this.readyOrFail()))
      return { messages: [], latestSeq: 0, hasMore: false, cursor: 0, policy: this.getPolicy() };

    const rows = this.rowsAfter(0);
    const tail = rows.slice(-Math.min(limit, CHAT_MAX_PAGE));

    return {
      messages: tail.map((row) => this.decorate(row)),
      latestSeq: this.latestSeq,
      hasMore: rows.length > tail.length,
      cursor: tail.at(-1)?.seq ?? 0,
      policy: this.getPolicy(),
    };
  }

  /** Drop everything chat owns. Used by tests and by room purge. */
  async clear(): Promise<void> {
    const sql = this.sql();

    if (sql) {
      sql.exec("DELETE FROM chat_messages");
      sql.exec("DELETE FROM chat_receipts");
    }

    this.fallbackMessages = [];
    this.fallbackReceipts.clear();
    this.cache.clear();
    this.limiter.reset();
    this.latestSeq = 0;
    this.nextSeq = 1;
    this.ready = null;
  }

  /** Forget one member's rate budget after they leave or are moved. */
  forgetMember(playerId: string): void {
    this.limiter.forget(playerId);
  }

  private decorate(message: RoomChatMessage): RoomChatEntry {
    const author = this.resolveAuthor(message.senderPlayerId) ?? {
      playerId: message.senderPlayerId,
      displayName: "Former player",
      seatKind: "human" as const,
      isHost: false,
      isSpectator: false,
    };

    return { ...message, author };
  }

  private messageAt(seq: number): RoomChatMessage | null {
    const cached = this.cache.get(seq);

    if (cached) return cached;

    const sql = this.sql();

    if (!sql) return this.fallbackMessages.find((row) => row.seq === seq) ?? null;

    const row = sql
      .exec<ChatRow>(
        "SELECT seq, id, sender, text, mentions_json, at FROM chat_messages WHERE seq = ?",
        seq,
      )
      .toArray()[0];

    return row ? parseRow(row) : null;
  }

  private rowsAfter(sinceSeq: number): RoomChatMessage[] {
    const sql = this.sql();

    if (!sql)
      return this.fallbackMessages.filter((row) => row.seq > sinceSeq).sort((a, b) => a.seq - b.seq);

    return sql
      .exec<ChatRow>(
        `SELECT seq, id, sender, text, mentions_json, at
         FROM chat_messages WHERE seq > ? ORDER BY seq`,
        sinceSeq,
      )
      .toArray()
      .map(parseRow);
  }

  private findReceipt(
    requestKey: string,
  ): { seq: number; fingerprint: string; at: number } | null {
    const sql = this.sql();

    if (!sql) return this.fallbackReceipts.get(requestKey) ?? null;

    const row = sql
      .exec<{ seq: number; fingerprint: string; at: number }>(
        "SELECT seq, fingerprint, at FROM chat_receipts WHERE request_key = ?",
        requestKey,
      )
      .toArray()[0];

    return row ?? null;
  }

  /**
   * One row, its receipt and the retention prune in a single transaction.
   *
   * A failure anywhere throws, so the caller reports a failed send instead of a
   * success whose message nobody can read back.
   */
  private write(message: RoomChatMessage, requestKey: string | undefined, fingerprint: string) {
    const sql = this.sql();
    const mentionsJson = message.mentions.length ? JSON.stringify(message.mentions) : null;

    if (!sql) {
      this.fallbackMessages.push(message);
      this.fallbackMessages.sort((a, b) => a.seq - b.seq);

      if (this.fallbackMessages.length > CHAT_RETENTION)
        this.fallbackMessages = this.fallbackMessages.slice(-CHAT_RETENTION);

      if (requestKey) {
        this.fallbackReceipts.set(requestKey, {
          seq: message.seq,
          fingerprint,
          at: message.createdAt,
        });

        while (this.fallbackReceipts.size > CHAT_RECEIPT_MEMORY) {
          const oldest = this.fallbackReceipts.keys().next();

          if (oldest.done) break;
          this.fallbackReceipts.delete(oldest.value);
        }
      }

      return;
    }

    const persist = () => {
      sql.exec(
        `INSERT OR IGNORE INTO chat_messages (seq, id, sender, text, mentions_json, at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        message.seq,
        message.id,
        message.senderPlayerId,
        message.text,
        mentionsJson,
        message.createdAt,
      );

      if (requestKey)
        sql.exec(
          `INSERT OR REPLACE INTO chat_receipts (request_key, sender, seq, fingerprint, at)
           VALUES (?, ?, ?, ?, ?)`,
          requestKey,
          message.senderPlayerId,
          message.seq,
          fingerprint,
          message.createdAt,
        );

      sql.exec(
        "DELETE FROM chat_messages WHERE seq <= (SELECT MAX(seq) FROM chat_messages) - ?",
        CHAT_RETENTION,
      );
      sql.exec(
        `DELETE FROM chat_receipts WHERE at <= (
           SELECT at FROM chat_receipts ORDER BY at DESC LIMIT 1 OFFSET ?
         )`,
        CHAT_RECEIPT_MEMORY,
      );
    };

    const transactionSync = this.storage.transactionSync;

    if (isFunction(transactionSync)) transactionSync.call(this.storage, persist);
    else persist();
  }
}

interface ChatRow {
  seq: number;
  id: string;
  sender: string;
  text: string;
  mentions_json: string | null;
  at: number;
  [column: string]: string | number | null | ArrayBuffer;
}

function parseRow(row: ChatRow): RoomChatMessage {
  const message: RoomChatMessage = {
    seq: row.seq,
    id: row.id,
    senderPlayerId: row.sender,
    text: row.text,
    mentions: [],
    createdAt: row.at,
  };

  if (isString(row.mentions_json) && row.mentions_json) {
    try {
      const parsed = wireValueSchema.parse(JSON.parse(row.mentions_json));

      if (Array.isArray(parsed)) message.mentions = parsed.filter((value) => isString(value));
    } catch {
      // A corrupt mentions column must not hide the message itself.
    }
  }

  return message;
}
