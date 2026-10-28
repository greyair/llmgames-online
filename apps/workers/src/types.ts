import type { WireValue } from "@llmgames/game-catalog";
import type { D1Database, DurableObjectNamespace, R2Bucket } from "@cloudflare/workers-types";

export interface Env {
  // D1 Database
  DB: D1Database;
  /** Completed, sanitized game logs. One gzip-compressed JSON object per game. */
  GAME_LOGS: R2Bucket;

  // Durable Objects for game rooms (1v1 / agent-friendly)
  GAME_SERIES: DurableObjectNamespace;
  CONNECT4_ROOM: DurableObjectNamespace;
  POKEMON_ROOM: DurableObjectNamespace;
  CHECKERS_ROOM: DurableObjectNamespace;
  REVERSI_ROOM: DurableObjectNamespace;
  CODENAMES_ROOM: DurableObjectNamespace;
  BATTLESHIP_ROOM: DurableObjectNamespace;
  POKER_ROOM: DurableObjectNamespace;
  CONTEXTO_ROOM: DurableObjectNamespace;

  EMAIL?: {
    send(message: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html?: string;
    }): Promise<void>;
  };
  EMAIL_FROM?: string;

  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  TWITCH_BROADCASTER_ID?: string;

  // Environment variables
  GOOGLE_CLIENT_ID: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  TURNSTILE_SITE_KEY: string;
  FRONTEND_URL: string;
  /** Comma-separated extra CORS origins (e.g. apex + www) */
  ALLOWED_ORIGINS?: string;

  // Secrets
  TYPESAFE_API_KEY?: string;
  /** Secret JSON map of version -> base64 32-byte AES key. Never use the session secret. */
  JEV_CREDENTIAL_KEYS?: string;
  JEV_CREDENTIAL_KEY_VERSION?: string;
  /** Zero disables paid Jev decisions. Defaults: 1000 globally, 200 per host/day. */
  JEV_DAILY_CALL_LIMIT?: string;
  JEV_USER_DAILY_CALL_LIMIT?: string;
  /** Comma-separated user ids allowed to read /api/v1/diagnostics. Unset disables it. */
  OPERATOR_USER_IDS?: string;
  ENCRYPTION_SECRET: string;
  GOOGLE_CLIENT_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
}

// User from database
export interface User {
  id: string;
  email: string;
  name: string | null;
  /** Permanent public multiplayer name assigned to the account. */
  gamertag: string | null;
  /** 1 after the player has made their one-time onboarding selection. */
  gamertag_selected?: number;
  broadcast_allowed?: number;
  created_at: number;
  updated_at: number;
  /** Always human (Google / MCP OAuth). */
  user_type?: "human";
}

// Authenticated browser session or MCP bearer context
interface Session {
  id?: string;
  authenticatedAt?: number;
  userId: string;
  email: string;
  name: string | null;
  expiresAt: number;
}

// WebSocket message types (agents + humans send intents only; no in-server LLM)
export type ClientMessage =
  | { type: "join"; payload: { userId: string; name: string } }
  | { type: "action"; requestId?: string; payload: { actionType: string; data: WireValue } }
  | { type: "leave" }
  | { type: "start_game"; requestId?: string }
  | { type: "rewatch_saved" }
  | { type: "timer_sync" };

export interface RewatchFrame {
  index: number;
  at: number;
  label: string;
  state: unknown;
}

export interface RewatchPayload {
  version: 1;
  visibility: "full_reveal";
  gameType: string;
  truncated: boolean;
  frames: RewatchFrame[];
}

export type ServerMessage =
  | {
      type: "action_result";
      payload: {
        requestId: string;
        ok: boolean;
        message?: string;
        state?: unknown;
        acceptedRevision?: number;
        /** The request was already applied and its outcome replayed. */
        replayed?: boolean;
      };
    }
  | {
      type: "connected";
      payload: {
        roomCode?: string;
        state: unknown;
        isHost: boolean;
        isSpectator?: boolean;
      };
    }
  | { type: "state"; payload: unknown }
  | {
      type: "player_joined";
      payload: {
        userId: string;
        name: string;
        roomCode?: string;
        codename?: string;
        ownerGamertag?: string;
        environmentLabel?: string;
        channel?: "browser" | "mcp";
        isAgent?: boolean;
      };
    }
  | { type: "player_left"; payload: { userId: string; name?: string } }
  | {
      type: "player_reconnected";
      payload: {
        userId: string;
        name: string;
        codename?: string;
        ownerGamertag?: string;
        environmentLabel?: string;
        channel?: "browser" | "mcp";
      };
    }
  | {
      type: "spectator_joined";
      payload: { userId: string; name: string; roomCode?: string };
    }
  | {
      type: "spectator_left";
      payload: { userId: string; name?: string };
    }
  | {
      type: "spectator_reconnected";
      payload: {
        userId: string;
        name: string;
        codename?: string;
        ownerGamertag?: string;
        environmentLabel?: string;
        channel?: "browser" | "mcp";
        isSpectator?: boolean;
      };
    }
  | { type: "spectator_disconnected"; payload: { userId: string; name: string } }
  | { type: "player_disconnected"; payload: { userId: string; name: string } }
  | { type: "player_kicked"; payload: { playerId: string; name: string } }
  | {
      type: "player_moved_to_spectator";
      payload: { playerId: string; name: string };
    }
  | { type: "host_changed"; payload: { newHostId: string } }
  | { type: "game_started"; payload: { state: unknown } }
  | {
      type: "game_ended";
      payload: {
        finalState: unknown;
        reason: string;
        rewatch: RewatchPayload;
      };
    }
  | {
      type: "turn_changed";
      payload: {
        currentPlayerId: string;
        turnNumber: number;
        phase: string;
        turnTimeRemaining: number;
      };
    }
  | { type: "turn_timeout"; payload: { playerId: string; playerName?: string; reason: string } }
  | { type: "timer_tick"; payload: { gameTimeRemaining?: number; turnTimeRemaining?: number } }
  | { type: "timer_sync"; payload: { gameTimeRemaining: number; turnTimeRemaining: number } }
  | { type: "error"; payload: { message: string } };

// Hono app variables
export interface Variables {
  user: User | null;
  session: Session | null;
  /** OAuth client that owns the current MCP bearer token. */
  mcpClientId?: string | null;
}
