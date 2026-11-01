/**
 * Room chat wire and storage types (C1).
 *
 * Chat belongs to the room, not to the game: it never enters `gameState`, so a
 * message cannot change the turn, the clock, the action sequence or a replay
 * frame. The service that owns it lives beside this file and depends on
 * storage only, which keeps it runnable under both a real Durable Object and
 * the in-memory test shims.
 */

/** One public message in a room chat. */
export interface RoomChatMessage {
  /** Stable id, unique inside this room. Never a client-chosen value. */
  id: string;
  /**
   * Monotonic per-room sequence. Clients use it as a cursor, so two messages
   * can never share one and a gap never means "reordered".
   */
  seq: number;
  senderPlayerId: string;
  text: string;
  /** Stable room-member ids; never free text and never resolved by fuzzy match. */
  mentions: string[];
  createdAt: number;
}

/** How a member is presented next to a message. Resolved from trusted roster data. */
export interface RoomChatAuthor {
  playerId: string;
  displayName: string;
  /** `human`, `mcp` or `bot`; a client cannot pick this. */
  seatKind: "human" | "mcp" | "bot";
  isHost: boolean;
  isSpectator: boolean;
  codename?: string;
  /** MCP host hint such as Codex or Claude; public in `roomMembers` already. */
  environmentLabel?: string;
}

/** A message plus the roster-derived identity of its sender. */
export interface RoomChatEntry extends RoomChatMessage {
  author: RoomChatAuthor;
}

/** Room-level chat policy. Stored outside `gameState`; it is not a game rule. */
export interface RoomChatPolicy {
  /** Spectators may speak. Hosts can flip this with `set_spectator_chat`. */
  spectatorSpeech: boolean;
}

/** Bounded read result returned to the browser and to MCP. */
export interface RoomChatPage {
  messages: RoomChatEntry[];
  /** Highest seq that exists in this room right now, or 0 when empty. */
  latestSeq: number;
  /** More messages than `limit` were available after the cursor. */
  hasMore: boolean;
  /** Pass back as `sinceSeq` to continue reading. */
  cursor: number;
  policy: RoomChatPolicy;
}

/** Why a chat request was refused. */
export type RoomChatErrorCode =
  | "CHAT_EMPTY"
  | "CHAT_TOO_LONG"
  | "CHAT_CONTROL_CHARS"
  | "CHAT_RATE_LIMITED"
  | "CHAT_UNKNOWN_MENTION"
  | "CHAT_TOO_MANY_MENTIONS"
  | "CHAT_NOT_A_MEMBER"
  | "CHAT_SPECTATORS_MUTED"
  | "CHAT_STORAGE_FAILED";

export interface RoomChatRejection {
  ok: false;
  code: RoomChatErrorCode;
  message: string;
}

export interface RoomChatAccepted {
  ok: true;
  message: RoomChatEntry;
  /** True when a repeated requestId replayed its first outcome. */
  replayed: boolean;
}

export type RoomChatSendResult = RoomChatAccepted | RoomChatRejection;

/** Text limits shared by the WebSocket and MCP paths. */
export const CHAT_MAX_TEXT_LENGTH = 400;

/** Mentions per message; enough for a table, small enough to bound storage. */
export const CHAT_MAX_MENTIONS = 8;

/** Messages returned when a caller does not ask for a different window. */
export const CHAT_DEFAULT_PAGE = 50;

/** Hard cap on one read, so a client cannot ask for the whole room. */
export const CHAT_MAX_PAGE = 200;

/** Rows kept per room. Older messages are pruned on write. */
export const CHAT_RETENTION = 200;

/** Token bucket: five quick lines, then one more every two seconds. */
export const CHAT_BURST = 5;

export const CHAT_REFILL_MS = 2_000;

/** Receipts kept so a retried requestId replays instead of posting twice. */
export const CHAT_RECEIPT_MEMORY = 128;
