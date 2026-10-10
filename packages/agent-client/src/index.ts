import {
  isNumber,
  isString,
  isWireObject,
  wireValueSchema,
  type WireValue,
  type WireObject,
} from "@llmgames/game-catalog";
import { z } from "zod";

/**
 * @llmgames/agent-client
 *
 * Thin local client for browser-style seats over REST + WebSocket.
 * Auth: MCP OAuth access JWT or session-equivalent Bearer (not API keys).
 *
 * Multi-agent / agent-vs-agent: use remote MCP (`agent_claim` + controllerId), not this client.
 *
 * Does NOT run game rules — server is source of truth.
 */

import WebSocket from "ws";
import { randomUUID } from "node:crypto";

export interface AgentClientOptions {
  /** API base, e.g. http://localhost:6787 */
  baseUrl: string;
  /** MCP OAuth access token (Bearer) */
  accessToken: string;
  /** REST deadline and initial WebSocket state deadline, in milliseconds. */
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
}

export interface RoomInfo {
  roomId: string;
  roomCode: string;
  gameType?: string;
  wsUrl: string;
  joinUrl?: string;
  gameStatus?: string;
  /** Absolute room expiry timestamp in milliseconds since Unix epoch. */
  expiresAt?: number;
}

export type ClientView = {
  type?: string;
  you?: {
    playerId?: string;
    isHost?: boolean;
    isYourTurn?: boolean;
    isAgent?: boolean;
    seatKind?: "agent" | "human";
    phase?: string;
    status?: string;
    legalActions?: string[];
  };
  status?: string;
  roomCode?: string;
  players?: Array<{ id: string; name: string }>;
  board?: WireValue;
  seats?: WireValue;
  scores?: WireValue;
  legalMoves?: WireValue;
  community?: WireValue;
  pot?: number;
  yourBoard?: WireValue;
  opponent?: WireValue;
  handRanking?: WireValue;
  lastHandResult?: WireValue;
  winner?: string | null;
  turnState?: {
    currentPlayerId: string | null;
    phase: string;
    turnNumber: number;
    turnTimeRemaining: number;
  };
};

type MessageHandler = (type: string, payload: WireValue) => void;

function objectValue(value: WireValue): WireObject | null {
  return isWireObject(value) ? value : null;
}

function field(value: WireObject | null, key: string): WireValue {
  return value ? value[key] : undefined;
}

function stringField(value: WireObject | null, key: string): string | undefined {
  const result = field(value, key);

  return isString(result) ? result : undefined;
}

function numberField(value: WireObject | null, key: string): number | undefined {
  const result = field(value, key);

  return isNumber(result) && Number.isFinite(result) ? result : undefined;
}

const roomInfoSchema = z.object({
  roomId: z.string().min(1),
  roomCode: z.string().min(1),
  wsUrl: z.string().min(1),
  gameType: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  joinUrl: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  gameStatus: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  expiresAt: z.number().optional(),
});

function parseRoomInfo(value: WireValue): RoomInfo {
  const result = roomInfoSchema.safeParse(value);

  if (!result.success) throw new Error("Room response is missing roomId, roomCode, or wsUrl");

  const info: RoomInfo = {
    roomId: result.data.roomId,
    roomCode: result.data.roomCode,
    wsUrl: result.data.wsUrl,
  };

  if (result.data.gameType) info.gameType = result.data.gameType;

  if (result.data.joinUrl) info.joinUrl = result.data.joinUrl;

  if (result.data.gameStatus) info.gameStatus = result.data.gameStatus;

  if (result.data.expiresAt !== undefined) info.expiresAt = result.data.expiresAt;

  return info;
}

interface CurrentUserResponse {
  user: { id: string; name: string | null; email: string };
}

interface ClientEnvelope {
  type: string;
  payload?: WireValue;
  requestId?: string;
}

function parseCurrentUser(value: WireValue): CurrentUserResponse {
  const body = objectValue(value);
  const user = objectValue(field(body, "user"));
  const id = stringField(user, "id");
  const email = stringField(user, "email");
  const rawName = field(user, "name");

  if (!id || !email || (rawName !== null && !isString(rawName))) {
    throw new Error("User response has an invalid shape");
  }

  return { user: { id, email, name: rawName } };
}

function isClientView(value: WireValue): value is ClientView {
  const state = objectValue(value);

  if (!state) return false;
  const status = field(state, "status");
  const you = field(state, "you");

  return (
    (status === undefined || isString(status)) && (you === undefined || objectValue(you) !== null)
  );
}

function parseServerEnvelope(value: WireValue): { type: string; payload: WireValue } | null {
  const message = objectValue(value);
  const type = stringField(message, "type");

  return type ? { type, payload: field(message, "payload") } : null;
}

export class AgentClient {
  readonly baseUrl: string;
  readonly accessToken: string;
  private ws: WebSocket | null = null;
  private state: ClientView | null = null;
  private handlers = new Set<MessageHandler>();
  private room: RoomInfo | null = null;
  private cancelConnect: ((error: Error) => void) | null = null;
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(opts: AgentClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.accessToken = opts.accessToken;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 15_000;
  }

  get currentState(): ClientView | null {
    return this.state;
  }

  get roomInfo(): RoomInfo | null {
    return this.room;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);

    return () => this.handlers.delete(handler);
  }

  private async api(path: string, init?: RequestInit & { skipAuth?: boolean }): Promise<WireValue> {
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");

    if (!init?.skipAuth) {
      headers.set("Authorization", `Bearer ${this.accessToken}`);
    }

    const signal = init?.signal ?? AbortSignal.timeout(this.requestTimeoutMs);

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      signal,
    });

    const body = wireValueSchema.parse(
      await res.json().catch(() => {
        signal.throwIfAborted();

        return {};
      }),
    );

    if (!res.ok) {
      const errorBody = objectValue(body);
      throw new Error(stringField(errorBody, "error") || `HTTP ${res.status} ${path}`);
    }

    return body;
  }

  async me(): Promise<{ user: { id: string; name: string | null; email: string } }> {
    return parseCurrentUser(await this.api("/api/v1/auth/users/me"));
  }

  async createRoom(opts: {
    gameType: string;
    maxPlayers?: number;
    gameTotalTime?: number;
    turnTime?: number;
  }): Promise<RoomInfo> {
    const info = parseRoomInfo(
      await this.api("/api/v1/rooms/create", {
        method: "POST",
        body: JSON.stringify(opts),
      }),
    );

    this.room = info;

    return info;
  }

  async joinRoom(opts: {
    roomCode: string;
    /** Optional legacy hint; current servers resolve the game from roomCode. */
    gameType?: string;
  }): Promise<RoomInfo> {
    const info = parseRoomInfo(
      await this.api("/api/v1/rooms/join", {
        method: "POST",
        body: JSON.stringify(opts),
      }),
    );

    this.room = info;

    return info;
  }

  /**
   * Open WebSocket to the current room (after create/join).
   */
  async connect(room?: RoomInfo): Promise<ClientView> {
    const r = room || this.room;

    if (!r) throw new Error("No room; create or join first");
    this.closeConnection("Connection replaced");
    this.room = r;

    const wsBase = this.baseUrl.replace(/^http/, "ws").replace(/\/$/, "");

    const path = r.wsUrl.startsWith("/") ? r.wsUrl : `/${r.wsUrl}`;
    let url = `${wsBase}${path}`;

    if (r.roomCode && !url.includes("roomCode=")) {
      url += (url.includes("?") ? "&" : "?") + `roomCode=${encodeURIComponent(r.roomCode)}`;
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      this.ws = ws;

      let settled = false;

      const finish = (error?: Error, state?: ClientView) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (this.cancelConnect === cancel) this.cancelConnect = null;

        if (error) {
          reject(error);

          if (this.ws === ws) this.closeConnection(error.message);
        } else if (state) {
          resolve(state);
        }
      };

      const cancel = (error: Error) => finish(error);

      const timer = setTimeout(
        () => finish(new Error("Timed out waiting for connected")),
        this.connectTimeoutMs,
      );

      this.cancelConnect = cancel;

      ws.on("message", (data) => {
        if (this.ws !== ws) return;

        try {
          const msg = parseServerEnvelope(wireValueSchema.parse(JSON.parse(data.toString())));

          if (!msg) throw new Error("Invalid server message");

          if (msg.type === "connected") {
            const state = field(objectValue(msg.payload), "state");

            if (!isClientView(state)) {
              finish(new Error("Connected message contains an invalid state"));

              return;
            }

            this.handleServerMessage(msg.type, msg.payload);
            finish(undefined, state);

            return;
          }

          if (!settled && msg.type === "error") {
            finish(
              new Error(stringField(objectValue(msg.payload), "message") ?? "Connection rejected"),
            );

            return;
          }

          this.handleServerMessage(msg.type, msg.payload);
        } catch (e) {
          console.error("[AgentClient] bad message", e);
        }
      });

      ws.on("error", (err) => {
        finish(err);

        if (this.ws === ws) this.closeConnection(err.message);
      });

      ws.on("close", () => {
        finish(new Error("WebSocket closed before connected"));

        if (this.ws === ws) this.closeConnection();
      });
    });
  }

  private handleServerMessage(type: string, payload: WireValue): void {
    if (
      type === "state" ||
      type === "connected" ||
      type === "game_started" ||
      type === "game_ended" ||
      type === "action_result"
    ) {
      const message = objectValue(payload);

      if (type === "state") {
        if (isClientView(payload)) this.state = payload;
      } else if (type === "connected" || type === "game_started") {
        const state = field(message, "state");

        if (isClientView(state)) this.state = state;
      } else if (type === "game_ended") {
        const finalState = field(message, "finalState");

        if (isClientView(finalState)) this.state = finalState;

        if (this.state) {
          this.state = { ...this.state, status: "ended" };
        }
      } else if (type === "action_result" && field(message, "ok") === true) {
        const state = field(message, "state");

        if (isClientView(state)) this.state = state;
      }
    }

    if (type === "turn_changed" && this.state) {
      const turn = objectValue(payload);
      const currentPlayerId = stringField(turn, "currentPlayerId");
      const phase = stringField(turn, "phase");
      const turnNumber = numberField(turn, "turnNumber");
      const turnTimeRemaining = numberField(turn, "turnTimeRemaining");

      if (
        !currentPlayerId ||
        !phase ||
        turnNumber === undefined ||
        turnTimeRemaining === undefined
      ) {
        return;
      }

      this.state = {
        ...this.state,
        turnState: {
          currentPlayerId,
          phase,
          turnNumber,
          turnTimeRemaining,
        },
        you: {
          ...this.state.you,
          isYourTurn: this.state.you?.playerId === currentPlayerId,
          phase,
        },
      };
    }

    this.notify(type, payload);

    if (type === "game_ended" && this.ws?.readyState === WebSocket.OPEN) {
      this.send("rewatch_saved");
    }
  }

  private notify(type: string, payload?: WireValue): void {
    for (const handler of [...this.handlers]) {
      try {
        handler(type, payload);
      } catch (error) {
        console.error("[AgentClient] message handler failed", error);
      }
    }
  }

  private closeConnection(message = "WebSocket disconnected"): void {
    const ws = this.ws;
    this.ws = null;
    this.state = null;
    this.cancelConnect?.(new Error(message));
    this.cancelConnect = null;

    if (ws) {
      ws.close();
      this.notify("disconnected", { message });
    }
  }

  send(type: string, payload?: WireValue, requestId?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const message: ClientEnvelope = { type };

    if (payload !== undefined) message.payload = payload;

    if (requestId) message.requestId = requestId;

    this.ws.send(JSON.stringify(message));
  }

  sendAction(actionType: string, data?: WireValue): string {
    const requestId = randomUUID();
    this.send("action", { actionType, data: data ?? {} }, requestId);

    return requestId;
  }

  startGame(): string {
    const requestId = randomUUID();
    this.send("start_game", undefined, requestId);

    return requestId;
  }

  leave(): void {
    try {
      this.send("leave");
    } catch {
      /* ignore */
    }

    this.closeConnection();
  }

  // ── Connect 4 ─────────────────────────────────────────────
  dropDisc(col: number): void {
    this.sendAction("drop_disc", { col });
  }

  nextHand(): void {
    this.sendAction("next_hand", {});
  }

  // ── Battleship ───────────────────────────────────────────────
  /**
   * Place all 5 polyomino ships. Prefer `rotation` (0|90|180|270);
   * legacy `orientation` h|v maps to 0°|90°.
   */
  placeFleet(
    ships: Array<{
      id: string;
      row: number;
      col: number;
      rotation?: 0 | 90 | 180 | 270;
      orientation?: "h" | "v";
    }>,
  ): void {
    this.sendAction("place_fleet", { ships });
  }

  /**
   * Free single-cell shot. Gain energy at turn start and for every new hit your fleet takes, including ability hits.
   * Hit keeps your turn; miss ends it. Specials may be reused while you have enough energy.
   * Alias: fire / shoot.
   */
  cannon(row: number, col: number): void {
    this.sendAction("cannon", { row, col });
  }

  /** @deprecated Prefer cannon() */
  fire(row: number, col: number): void {
    this.sendAction("cannon", { row, col });
  }

  /** Place a defensive mine on own empty water. Costs 2 pts; reusable while funded; keeps the normal shot available. */
  mine(row: number, col: number): void {
    this.sendAction("mine", { row, col });
  }

  /** Radar 3×3 info scan (no hits/pegs). Costs 3 munition points. */
  radar(row: number, col: number): void {
    this.sendAction("radar", { row, col });
  }

  /** Bomb 2×2 attack (click = top-left). Costs 5 points. Triggering a mine fires three return shots and ends your turn. */
  bomb(row: number, col: number): void {
    this.sendAction("bomb", { row, col });
  }

  /**
   * Torpedo from a board edge: travels inward until first ship hit, then stops.
   * Costs 7 munition points. Direction optional on mid-edges; required on corners.
   */
  torpedo(
    row: number,
    col: number,
    direction?: "n" | "s" | "e" | "w" | "north" | "south" | "east" | "west",
  ): void {
    this.sendAction("torpedo", direction ? { row, col, direction } : { row, col });
  }

  // ── Multiplayer Poker ────────────────────────────────────────
  fold(): void {
    this.sendAction("fold", {});
  }

  check(): void {
    this.sendAction("check", {});
  }

  call(): void {
    this.sendAction("call", {});
  }

  bet(amount: number): void {
    this.sendAction("bet", { amount });
  }

  raise(amount: number, raiseTo?: number): void {
    this.sendAction("raise", raiseTo != null ? { raiseTo } : { amount });
  }

  allIn(): void {
    this.sendAction("all_in", {});
  }

  /**
   * Wait until isYourTurn or game ended, with timeout.
   */
  waitForTurn(timeoutMs = 60000): Promise<ClientView> {
    return new Promise((resolve, reject) => {
      if (this.state?.you?.isYourTurn) {
        resolve(this.state);

        return;
      }

      if (this.state?.status === "ended") {
        resolve(this.state);

        return;
      }

      if (!this.isConnected) {
        reject(new Error("WebSocket not connected"));

        return;
      }

      const timer = setTimeout(() => {
        unsub();
        reject(new Error("waitForTurn timeout"));
      }, timeoutMs);

      const unsub = this.onMessage((type) => {
        if (type === "disconnected") {
          clearTimeout(timer);
          unsub();
          reject(new Error("WebSocket disconnected while waiting for turn"));

          return;
        }

        if (
          type === "state" ||
          type === "turn_changed" ||
          type === "game_started" ||
          type === "game_ended" ||
          type === "action_result"
        ) {
          if (this.state?.you?.isYourTurn || this.state?.status === "ended") {
            clearTimeout(timer);
            unsub();
            resolve(this.state!);
          }
        }
      });
    });
  }

  /**
   * Wait for a specific server message type.
   */
  waitForMessage(type: string, timeoutMs = 30000): Promise<WireValue> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error("WebSocket not connected"));

        return;
      }

      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`Timeout waiting for ${type}`));
      }, timeoutMs);

      const unsub = this.onMessage((t, payload) => {
        if (t === "disconnected") {
          clearTimeout(timer);
          unsub();
          reject(new Error(`WebSocket disconnected while waiting for ${type}`));

          return;
        }

        if (t === type) {
          clearTimeout(timer);
          unsub();
          resolve(payload);
        }
      });
    });
  }
}
