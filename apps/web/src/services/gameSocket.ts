import { wireValueSchema, wireObjectSchema, type WireValue } from "@llmgames/game-catalog";
import { z } from "zod";

/**
 * WebSocket client for Durable Object game rooms
 */

const API_BASE = "/api/v1";

const WS_PROTOCOL = window.location.protocol === "https:" ? "wss:" : "ws:";

const WS_BASE = `${WS_PROTOCOL}//${window.location.host}/api/v1`;

type MessageHandler = (message: ServerMessage) => void;

type ConnectionHandler = (data: ConnectedData) => void;

const serverMessageSchema = z.object({
  type: z.enum([
    "connected",
    "state",
    "player_joined",
    "player_left",
    "player_reconnected",
    "spectator_joined",
    "spectator_left",
    "spectator_reconnected",
    "spectator_disconnected",
    "player_disconnected",
    "player_kicked",
    "player_moved_to_spectator",
    "host_changed",
    "game_started",
    "game_ended",
    "turn_changed",
    "turn_timeout",
    "timer_tick",
    "timer_sync",
    "error",
  ]),
  payload: wireValueSchema,
});

type ServerMessage = z.output<typeof serverMessageSchema>;

const connectedDataSchema = z.object({
  roomCode: z.string().optional(),
  state: wireObjectSchema,
  isHost: z.boolean(),
  isSpectator: z.boolean().optional(),
});

type ConnectedData = z.output<typeof connectedDataSchema>;

const errorSchema = z.object({ error: z.string().optional() });

interface JoinRoomOptions {
  roomCode: string;
  /** Optional legacy hint; the server normally resolves this from roomCode. */
  gameType?: string;
}

interface CreateRoomOptions {
  gameType: string;
  maxPlayers?: number;
  gameTotalTime?: number;
  turnTime?: number;
  settings?: WireValue;
}

let activeSocket: GameSocket | null = null;

export function getActiveSocket(): GameSocket | null {
  return activeSocket;
}

export class GameSocket {
  private ws: WebSocket | null = null;
  private connectionHandlers = new Set<(connected: boolean) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private roomId: string;
  private roomCode: string | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private connectHandlers: Set<ConnectionHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private messageQueue: string[] = [];
  private isConnecting = false;
  private pendingConnect: { roomCode?: string } | null = null;
  private reconnectEnabled = true;

  constructor(roomId: string) {
    this.roomId = roomId;
    activeSocket = this;
  }

  /**
   * Connect to the game room
   */
  connect(roomCode?: string): void {
    this.pendingConnect = { roomCode };
    this.tryConnect();
  }

  private tryConnect(): void {
    if (!this.pendingConnect || this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    const { roomCode } = this.pendingConnect;
    this.isConnecting = true;
    this.roomCode = roomCode || null;

    let wsUrl = `${WS_BASE}/ws/games/${this.roomId}`;
    const params = new URLSearchParams();

    if (roomCode) {
      params.set("roomCode", roomCode);
    }

    wsUrl += `?${params.toString()}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.isConnecting = false;
      this.reconnectAttempts = 0;

      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift()!;
        this.ws?.send(msg);
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message = serverMessageSchema.safeParse(JSON.parse(event.data)).data;

        if (!message) throw new Error("Invalid server message");

        if (message.type === "game_ended") {
          // The final message contains the complete local rewatch. Once every
          // synchronous subscriber has copied it into browser state, tell the
          // room it is safe to purge and do not reconnect to the closed DO.
          this.reconnectEnabled = false;
        }

        switch (message.type) {
          case "connected": {
            const connectedData = connectedDataSchema.safeParse(message.payload).data;

            if (!connectedData) throw new Error("Invalid connected payload");
            this.roomCode = connectedData.roomCode || null;

            this.connectHandlers.forEach((handler) => handler(connectedData));
            this.connectionHandlers.forEach((handler) => handler(true));
            break;
          }

          default:
            this.messageHandlers.forEach((handler) => handler(message));
        }

        if (message.type === "game_ended" && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "rewatch_saved" }));
        }
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    };

    this.ws.onclose = () => {
      this.isConnecting = false;
      this.connectionHandlers.forEach((handler) => handler(false));

      if (this.reconnectEnabled && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;

        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        this.reconnectTimer = setTimeout(() => {
          if (this.reconnectEnabled) this.connect(this.roomCode || undefined);
        }, delay);
      }
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      this.isConnecting = false;
    };
  }

  /**
   * Send an action to the game room
   */
  sendAction(actionType: string, data?: WireValue): void {
    const message = JSON.stringify({
      type: "action",
      payload: { actionType, data },
    });

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  /**
   * Start the game (host only)
   */
  startGame(): void {
    this.sendAction("start_game");
  }

  /**
   * Leave the game room
   */
  leave(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "leave" }));
    }
  }

  /**
   * Disconnect from the game room
   */
  disconnect(): void {
    this.reconnectEnabled = false;
    clearTimeout(this.reconnectTimer);
    this.messageQueue = [];
    this.maxReconnectAttempts = 0;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Register a message handler
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    this.tryConnect();

    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Register a connect handler
   */
  onConnect(handler: ConnectionHandler): () => void {
    this.connectHandlers.add(handler);
    this.tryConnect();

    return () => this.connectHandlers.delete(handler);
  }

  /**
   * Check if connected
   */
  onConnectionChange(handler: (connected: boolean) => void): () => void {
    this.connectionHandlers.add(handler);

    return () => this.connectionHandlers.delete(handler);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get room code
   */
  get code(): string | null {
    return this.roomCode;
  }
}

/**
 * Create a new game room via the API
 */
const createRoomResponseSchema = z.object({
  roomId: z.string().min(1),
  roomCode: z.string().min(1),
  gameType: z.string().min(1),
  wsUrl: z.string().min(1),
  expiresAt: z.number(),
});

type CreateRoomResponse = z.output<typeof createRoomResponseSchema>;

const joinRoomResponseSchema = z
  .object({
    roomId: z.string().min(1),
    roomCode: z.string().min(1),
    gameType: z.string().min(1),
    gameStatus: z.string().min(1),
    wsUrl: z.string().min(1),
    playerCount: z.number().optional().catch(undefined),
    maxPlayers: z.number().optional().catch(undefined),
    spectatorCount: z.number().optional().catch(undefined),
    canJoinAsPlayer: z.boolean().optional().catch(undefined),
    canSpectate: z.boolean().optional().catch(undefined),
    expiresAt: z.number().optional().catch(undefined),
    joinMode: z.enum(["player", "spectator"]).optional(),
    joinUrl: z.string().min(1).optional().catch(undefined),
  })
  .transform((room) => {
    // Invalid optional metadata has always been omitted from the browser response.
    for (const key of [
      "playerCount",
      "maxPlayers",
      "spectatorCount",
      "canJoinAsPlayer",
      "canSpectate",
      "expiresAt",
      "joinMode",
      "joinUrl",
    ] as const) {
      if (room[key] === undefined) delete room[key];
    }

    return room;
  });

type JoinRoomResponse = z.output<typeof joinRoomResponseSchema>;

export async function createGameRoom(options: CreateRoomOptions): Promise<CreateRoomResponse> {
  const response = await fetch(`${API_BASE}/rooms/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(options),
  });

  const data: unknown = await response.json();

  if (!response.ok) {
    throw new Error(errorSchema.safeParse(data).data?.error || "Failed to create game room");
  }

  const room = createRoomResponseSchema.safeParse(data).data;

  if (!room) throw new Error("Create-room response has an invalid shape");

  return room;
}

/**
 * Join an existing game room via room code
 */
export async function joinGameRoom(options: JoinRoomOptions): Promise<JoinRoomResponse> {
  const response = await fetch(`${API_BASE}/rooms/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(options),
  });

  const data: unknown = await response.json();

  if (!response.ok) {
    throw new Error(errorSchema.safeParse(data).data?.error || "Failed to join game room");
  }

  const room = joinRoomResponseSchema.safeParse(data).data;

  if (!room) throw new Error("Join-room response has an invalid shape");

  return room;
}
