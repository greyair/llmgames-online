import type { WireValue } from "@llmgames/game-catalog";

import type { Env } from "../../types";

import type {
  RoomChatAuthor,
  RoomChatPage,
  RoomChatPolicy,
  RoomChatSendResult,
} from "./chatTypes";

/** Internal wire shape shared by every room → series chat call. */
interface SeriesChatCallBody {
  roomProxy: true;
  senderPlayerId?: string;
  text?: string;
  mentions?: WireValue;
  requestId?: string;
  isSpectator?: boolean;
  members?: string[];
  author?: RoomChatAuthor;
  sinceSeq?: WireValue;
  limit?: WireValue;
  mode?: "cursor" | "recent";
  spectatorSpeech?: boolean;
}

type SeriesChatCallInput = Partial<Omit<SeriesChatCallBody, "roomProxy">>;

/** The chat operations a game room actually uses, whichever store backs them. */
export interface ChatStore {
  append(input: {
    senderPlayerId: string;
    text: string;
    mentions?: WireValue;
    requestId?: string;
    isSpectator: boolean;
    members: ReadonlySet<string>;
    now?: number;
  }): Promise<RoomChatSendResult>;
  read(input?: { sinceSeq?: WireValue; limit?: WireValue }): Promise<RoomChatPage>;
  recent(limit?: number): Promise<RoomChatPage>;
  latestSeqValue(): Promise<number>;
  setPolicy(policy: RoomChatPolicy): Promise<RoomChatPolicy>;
}

/**
 * Room-side view of the series conversation.
 *
 * A series match is a normal game room; only the backing chat store changes.
 * Keeping the same interface means WebSocket chat, MCP `send_room_message`,
 * `wait_for_turn` and the read cursors all work unchanged, while history stays
 * continuous across every match in the series.
 */
export class SeriesChatProxy implements ChatStore {
  constructor(
    private readonly env: Env,
    private readonly code: string,
    private readonly resolveAuthor: (playerId: string) => RoomChatAuthor | null,
  ) {}

  private async call<T>(path: string, body: SeriesChatCallInput): Promise<T> {
    const namespace = this.env.GAME_SERIES;

    const stub = namespace.get(namespace.idFromName(`series-${this.code}`));

    const payload: SeriesChatCallBody = { ...body, roomProxy: true };

    const response = await stub.fetch(`https://series.internal${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    return await response.json<T>();
  }

  async append(input: {
    senderPlayerId: string;
    text: string;
    mentions?: WireValue;
    requestId?: string;
    isSpectator: boolean;
    members: ReadonlySet<string>;
    now?: number;
  }): Promise<RoomChatSendResult> {
    const author = this.resolveAuthor(input.senderPlayerId);

    if (!author)
      return {
        ok: false,
        code: "CHAT_NOT_A_MEMBER",
        message: "Player or spectator not in room",
      };

    try {
      return await this.call<RoomChatSendResult>("/chat/append", {
        senderPlayerId: input.senderPlayerId,
        text: input.text,
        mentions: input.mentions,
        requestId: input.requestId,
        isSpectator: input.isSpectator,
        members: [...input.members],
        author,
      });
    } catch (error) {
      console.error("Series chat append failed", error);

      return {
        ok: false,
        code: "CHAT_STORAGE_FAILED",
        message: "The server could not save this message",
      };
    }
  }

  async read(input: { sinceSeq?: WireValue; limit?: WireValue } = {}): Promise<RoomChatPage> {
    try {
      return await this.call<RoomChatPage>("/chat/read", {
        sinceSeq: input.sinceSeq,
        limit: input.limit,
        mode: "cursor",
      });
    } catch (error) {
      console.error("Series chat read failed", error);

      return {
        messages: [],
        latestSeq: 0,
        hasMore: false,
        cursor: 0,
        policy: { spectatorSpeech: true },
      };
    }
  }

  async recent(limit?: number): Promise<RoomChatPage> {
    try {
      return await this.call<RoomChatPage>("/chat/read", { limit, mode: "recent" });
    } catch (error) {
      console.error("Series chat snapshot failed", error);

      return {
        messages: [],
        latestSeq: 0,
        hasMore: false,
        cursor: 0,
        policy: { spectatorSpeech: true },
      };
    }
  }

  async latestSeqValue(): Promise<number> {
    try {
      const result = await this.call<{ latestSeq: number }>("/chat/latest", {});

      return result.latestSeq;
    } catch (error) {
      console.error("Series chat cursor failed", error);

      return 0;
    }
  }

  async setPolicy(policy: RoomChatPolicy): Promise<RoomChatPolicy> {
    try {
      const result = await this.call<RoomChatPolicy>("/chat/policy", policy);

      return result;
    } catch (error) {
      console.error("Series chat policy failed", error);

      return policy;
    }
  }
}
