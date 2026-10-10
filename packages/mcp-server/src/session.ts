import { storedConnectionSchema, type StoredConnectionConfig } from "@llmgames/game-catalog";
import { isNumber, isObject, isString, isWireObject } from "@llmgames/game-catalog";

/**
 * In-process session for local stdio MCP bridge.
 * Holds base URL + MCP OAuth access token (not API keys).
 */

import { AgentClient, type ClientView, type RoomInfo } from "@llmgames/agent-client";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".llmgames");

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("API URL must not include credentials, query parameters, or a fragment");
  }

  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  ) {
    throw new Error("API URL must use HTTPS, except for local loopback development");
  }

  return url.toString().replace(/\/$/, "");
}

interface PersistConfig {
  baseUrl: string;
  accessToken?: string;
  roomId?: string;
  roomCode?: string;
  wsUrl?: string;
  joinUrl?: string;
  gameType?: string;
  expiresAt?: number;
}

function parsePersistConfig(value: StoredConnectionConfig, fallbackBaseUrl: string): PersistConfig {
  const config: PersistConfig = { baseUrl: normalizeBaseUrl(value.baseUrl || fallbackBaseUrl) };

  if (value.accessToken) config.accessToken = value.accessToken;

  if (value.roomId) config.roomId = value.roomId;

  if (value.roomCode) config.roomCode = value.roomCode;

  if (value.wsUrl) config.wsUrl = value.wsUrl;

  if (value.joinUrl) config.joinUrl = value.joinUrl;

  if (value.gameType) config.gameType = value.gameType;

  if (value.expiresAt !== undefined) config.expiresAt = value.expiresAt;

  return config;
}

function loadPersistConfig(configDir: string): PersistConfig {
  const configPath = join(configDir, "config.json");

  const envBaseUrl = process.env.LLMGAMES_API
    ? normalizeBaseUrl(process.env.LLMGAMES_API)
    : undefined;

  const baseUrl = envBaseUrl || "http://localhost:6787";

  if (!existsSync(configPath)) {
    return {
      baseUrl,
      accessToken: process.env.LLMGAMES_ACCESS_TOKEN,
    };
  }

  try {
    chmodSync(configDir, 0o700);
    chmodSync(configPath, 0o600);

    const file = parsePersistConfig(
      storedConnectionSchema.parse(JSON.parse(readFileSync(configPath, "utf8"))),
      baseUrl,
    );

    const fileBaseUrl = file.baseUrl;
    const selectedBaseUrl = envBaseUrl || fileBaseUrl;

    const persistedTokenIsSafe =
      !envBaseUrl || new URL(envBaseUrl).origin === new URL(fileBaseUrl).origin;

    const config: PersistConfig = {
      baseUrl: selectedBaseUrl,
      accessToken:
        process.env.LLMGAMES_ACCESS_TOKEN || (persistedTokenIsSafe ? file.accessToken : undefined),
    };

    if (persistedTokenIsSafe) {
      config.roomId = file.roomId;
      config.roomCode = file.roomCode;
      config.wsUrl = file.wsUrl;
      config.joinUrl = file.joinUrl;
      config.gameType = file.gameType;
      config.expiresAt = file.expiresAt;
    }

    return config;
  } catch {
    return {
      baseUrl,
      accessToken: process.env.LLMGAMES_ACCESS_TOKEN,
    };
  }
}

function savePersistConfig(configDir: string, cfg: Partial<PersistConfig>): void {
  const configPath = join(configDir, "config.json");
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  chmodSync(configDir, 0o700);
  let existing: Partial<PersistConfig> = {};

  if (existsSync(configPath)) {
    try {
      existing = parsePersistConfig(
        storedConnectionSchema.parse(JSON.parse(readFileSync(configPath, "utf8"))),
        "http://localhost:6787",
      );
    } catch {
      existing = {};
    }
  }

  if (
    cfg.baseUrl &&
    existing.baseUrl &&
    new URL(cfg.baseUrl).origin !== new URL(existing.baseUrl).origin
  ) {
    existing = {};
  }

  writeFileSync(configPath, JSON.stringify({ ...existing, ...cfg }, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(configPath, 0o600);
}

function maskToken(token: string | undefined): string | null {
  if (!token) return null;

  if (token.length <= 12) return "***";

  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

export class BridgeSession {
  baseUrl: string;
  private accessToken: string | null = null;
  private tokenPersisted = false;
  private client: AgentClient | null = null;
  private room: RoomInfo | null = null;
  private gameType: string | null = null;
  private recentEvents: Array<{ type: string; at: number }> = [];
  private stateRevision = 0;
  private readonly configDir: string;

  constructor(opts: { configDir?: string } = {}) {
    this.configDir = opts.configDir ?? CONFIG_DIR;
    const cfg = loadPersistConfig(this.configDir);
    this.baseUrl = cfg.baseUrl;

    if (cfg.accessToken) {
      this.setToken(cfg.accessToken, { persist: false });
      this.tokenPersisted =
        !process.env.LLMGAMES_ACCESS_TOKEN && existsSync(join(this.configDir, "config.json"));
    }

    if (cfg.roomId && cfg.wsUrl && cfg.expiresAt && cfg.expiresAt > Date.now()) {
      this.room = {
        roomId: cfg.roomId,
        roomCode: cfg.roomCode || "",
        wsUrl: cfg.wsUrl,
        joinUrl: cfg.joinUrl,
        expiresAt: cfg.expiresAt,
      };
      this.gameType = cfg.gameType || null;
    }
  }

  get hasToken(): boolean {
    return Boolean(this.accessToken);
  }

  get tokenMasked(): string | null {
    return maskToken(this.accessToken ?? undefined);
  }

  getBearerToken(): string | null {
    return this.accessToken;
  }

  setBaseUrl(url: string, opts?: { persist?: boolean }): void {
    const nextBaseUrl = normalizeBaseUrl(url);

    if (this.accessToken && new URL(nextBaseUrl).origin !== new URL(this.baseUrl).origin) {
      throw new Error(
        "Clear the access token before changing the API origin, then authenticate again",
      );
    }

    if (new URL(nextBaseUrl).origin !== new URL(this.baseUrl).origin) {
      this.room = null;
      this.gameType = null;
    }

    this.baseUrl = nextBaseUrl;

    if (this.accessToken) {
      this.rebuildClient();
    }

    if (opts?.persist) {
      const config: Partial<PersistConfig> = { baseUrl: this.baseUrl };

      if (this.tokenPersisted) config.accessToken = this.accessToken ?? undefined;
      savePersistConfig(this.configDir, config);
    }
  }

  /** Set MCP OAuth access token (Bearer). */
  setToken(accessToken: string, opts?: { persist?: boolean }): void {
    const token = accessToken.trim();

    if (!token) {
      throw new Error("Access token is empty");
    }

    this.accessToken = token;
    this.rebuildClient();

    if (opts?.persist === true) {
      savePersistConfig(this.configDir, {
        baseUrl: this.baseUrl,
        accessToken: token,
      });
      this.tokenPersisted = true;
    } else {
      this.tokenPersisted = false;
    }
  }

  clearToken(opts?: { persist?: boolean }): void {
    this.disconnectQuiet();
    this.accessToken = null;
    this.tokenPersisted = false;
    this.client = null;

    if (opts?.persist !== false) {
      const cfg = loadPersistConfig(this.configDir);
      cfg.accessToken = undefined;
      savePersistConfig(this.configDir, { ...cfg, baseUrl: this.baseUrl });
    }
  }

  private rebuildClient(): void {
    this.disconnectQuiet();

    if (!this.accessToken) {
      this.client = null;

      return;
    }

    this.client = new AgentClient({
      baseUrl: this.baseUrl,
      accessToken: this.accessToken,
    });
    this.client.onMessage((type) => {
      this.recentEvents.push({ type, at: Date.now() });

      if (this.recentEvents.length > 50) this.recentEvents.shift();

      if (
        type === "state" ||
        type === "turn_changed" ||
        type === "game_started" ||
        type === "game_ended" ||
        type === "action_result"
      ) {
        this.stateRevision += 1;
      }
    });
  }

  requireClient(): AgentClient {
    if (!this.client || !this.accessToken) {
      throw new Error(
        "Not authenticated. Set LLMGAMES_ACCESS_TOKEN or call auth_set_token with your MCP OAuth access JWT. Prefer remote MCP OAuth for full multi-agent play.",
      );
    }

    return this.client;
  }

  requireConnected(): AgentClient {
    const c = this.requireClient();

    if (!c.isConnected) {
      throw new Error("WebSocket not connected. Call room_connect after create/join.");
    }

    return c;
  }

  status() {
    const c = this.client;

    return {
      baseUrl: this.baseUrl,
      authenticated: this.hasToken,
      accessTokenMasked: this.tokenMasked,
      connected: c?.isConnected ?? false,
      room: this.room,
      gameType: this.gameType,
      you: c?.currentState?.you ?? null,
      status: c?.currentState?.status ?? null,
      recentEvents: this.recentEvents.slice(-10),
    };
  }

  async whoami() {
    const c = this.requireClient();

    return c.me();
  }

  async createRoom(
    opts: {
      gameType: string;
      maxPlayers?: number;
      gameTotalTime?: number;
      turnTime?: number;
    },
    persistence?: { persist?: boolean },
  ) {
    const c = this.requireClient();
    const room = await c.createRoom(opts);
    this.room = room;
    this.gameType = room.gameType || opts.gameType;

    if (persistence?.persist)
      savePersistConfig(this.configDir, {
        baseUrl: this.baseUrl,
        roomId: room.roomId,
        roomCode: room.roomCode,
        wsUrl: room.wsUrl,
        joinUrl: room.joinUrl,
        gameType: this.gameType,
        expiresAt: room.expiresAt,
      });

    return room;
  }

  async joinRoom(
    opts: { roomCode: string; gameType?: string },
    persistence?: { persist?: boolean },
  ) {
    const c = this.requireClient();

    const room = await c.joinRoom({
      roomCode: opts.roomCode.toUpperCase(),
      gameType: opts.gameType,
    });

    this.room = room;
    this.gameType = room.gameType || opts.gameType || null;

    if (persistence?.persist)
      savePersistConfig(this.configDir, {
        baseUrl: this.baseUrl,
        roomId: room.roomId,
        roomCode: room.roomCode,
        wsUrl: room.wsUrl,
        joinUrl: room.joinUrl,
        gameType: this.gameType || undefined,
        expiresAt: room.expiresAt,
      });

    return room;
  }

  async connect(room?: RoomInfo): Promise<ClientView> {
    const c = this.requireClient();
    const selected = room || this.room || c.roomInfo;

    if (!selected) throw new Error("No room; create or join first");
    const r = { ...selected };

    if (r.roomId === this.room?.roomId) {
      r.roomCode ||= this.room.roomCode;
      r.expiresAt ??= this.room.expiresAt;
      r.gameType ??= this.room.gameType;
      r.joinUrl ??= this.room.joinUrl;
    }

    if (!r.roomCode)
      throw new Error(
        "roomCode is required for the selected room; pass roomId and roomCode or call room_join first",
      );

    if (r.expiresAt !== undefined && r.expiresAt <= Date.now())
      throw new Error("Room has expired; create or join a current room");
    const expectedPrefix = `/api/v1/ws/games/${encodeURIComponent(r.roomId)}`;

    if (r.wsUrl.split("?")[0] !== expectedPrefix) {
      throw new Error("WebSocket URL must match the selected room on the configured API");
    }

    this.room = r;
    this.gameType = r.gameType ?? null;

    return c.connect(r);
  }

  leave(): void {
    this.client?.leave();
    this.room = null;
    this.gameType = null;

    if (existsSync(join(this.configDir, "config.json")))
      savePersistConfig(this.configDir, {
        roomId: undefined,
        roomCode: undefined,
        wsUrl: undefined,
        joinUrl: undefined,
        gameType: undefined,
        expiresAt: undefined,
      });
  }

  private disconnectQuiet(): void {
    try {
      this.client?.leave();
    } catch {
      /* ignore */
    }
  }

  getState(): ClientView | null {
    return this.client?.currentState ?? null;
  }

  getStateRevision(): number {
    return this.stateRevision;
  }

  async runAction(
    act: (client: AgentClient) => string,
    waitMs = 10_000,
  ): Promise<ClientView | null> {
    const c = this.requireConnected();

    return new Promise<ClientView | null>((resolve, reject) => {
      let requestId: string;

      const timer = setTimeout(() => {
        unsub();
        reject(
          new Error(
            "Action acknowledgement timed out; acceptance is unknown. Inspect get_state before deciding whether to retry.",
          ),
        );
      }, waitMs);

      const unsub = c.onMessage((type, payload) => {
        if (type === "disconnected") {
          clearTimeout(timer);
          unsub();
          reject(
            new Error(
              "WebSocket disconnected before action acknowledgement; acceptance is unknown. Reconnect and inspect get_state before retrying.",
            ),
          );

          return;
        }

        if (type !== "action_result" || !isWireObject(payload)) return;

        if (payload.requestId !== requestId) return;
        clearTimeout(timer);
        unsub();

        if (payload.ok !== true) {
          const message = payload.message;
          reject(new Error(isString(message) ? message : "Action rejected"));

          return;
        }

        const state = payload.state;

        if (state === null || !isObject(state) || Array.isArray(state)) {
          reject(new Error("Action acknowledgement is missing projected state"));

          return;
        }

        resolve(state);
      });

      try {
        requestId = act(c);
      } catch (e) {
        clearTimeout(timer);
        unsub();
        reject(e);
      }
    });
  }
}

export function jsonResult<T>(data: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data),
      },
    ],
  };
}

export function errorResult(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);

  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: message }),
      },
    ],
  };
}
