import {
  wireValueSchema,
  wireObjectSchema,
  type WireValue,
  type WireObject,
} from "@llmgames/game-catalog";
import { z } from "zod";
import type { RoomRuntime, RoomStorage, RoomSql } from "./runtime";
import { isBoolean, isFunction, isNumber, isObject, isString } from "@llmgames/game-catalog";

import {
  compactAgentDecisionState,
  battleshipAgentState,
  gameLifecycle,
  ROOM_INACTIVITY_MS,
  TURN_TIME_MAX_MS,
  TURN_TIME_MIN_MS,
  type RoomErrorCode,
} from "@llmgames/game-catalog";
import type {
  ClientMessage,
  ServerMessage,
  Env,
  RewatchFrame,
  RewatchPayload,
  RoomErrorPayload,
} from "../types";
import type {
  AgentRoomMember,
  BaseGameState,
  BasePlayerInfo,
  GameRoomConfig,
  Player,
  SeatChannel,
  YouContext,
} from "./types";
import { channelLabel, generateUniqueCodename, isCodenameFormat } from "../lib/codenames";
import { randomInt } from "../lib/csprng";
import {
  activateRoomCode,
  extendRoomCode,
  readRoomCode,
  releaseRoomCode,
  reserveRoomCode,
} from "../lib/activeRooms";
import { broadcastProjection } from "../lib/broadcastProjection";
import { normalizeGameType, roomIdFor } from "../lib/roomRouting";
import { buildCompletedGameArchive, persistCompletedGameArchive } from "../lib/gameLogs";
import { logEvent } from "../lib/observability";
import { ensureLegacyMcpRoomPlayer } from "../auth/mcpRoomPlayers";
import {
  claimSponsoredJevTrial,
  chooseJev,
  hasSponsoredJevTrial,
  jevDecision,
  parseJevView,
  JevError,
  JevLimitError,
  JEV_GAMES,
  reserveJevCall,
  type JevSeat,
} from "../agents/jev";
import { generateJevFleets } from "../agents/jevBattleship";
import { getJevCredential, decryptJevKey, reservePersonalJevCall } from "../agents/jevCredentials";
import {
  classifyActionError,
  idempotencyConflict,
  internalActionError,
  publicActionError,
  type ActionRejection,
  type StartGameProblem,
} from "./actionErrors";
import type { GameEffect, GamePlugin } from "../games/contract";
import { gamePluginFor } from "../games/registry";

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const ROOM_CODE_LENGTH = 6;

export const MAX_REWATCH_FRAMES = 240;

export const MAX_REWATCH_PAYLOAD_BYTES = 4 * 1024 * 1024;

export const MAX_REWATCH_FRAME_BYTES = 256 * 1024;

export const FINAL_STATE_DELIVERY_GRACE_MS = 30_000;

/**
 * A match keeps its room alive past the match clock so the timeout result,
 * final delivery and archive retry can finish before the room is reclaimed.
 */
export const MATCH_END_GRACE_MS = 5 * 60_000;

/** Accept an otherwise legal turn action for up to two seconds after UI zero. */
export const TURN_EXPIRY_GRACE_MS = 2_000;

/** How long a repeated requestId replays its original outcome instead of acting. */
export const ACTION_RESULT_TTL_MS = 5 * 60_000;

/** Bounded per-room memory of acknowledged requests (oldest entries are dropped). */
export const ACTION_RESULT_MEMORY = 64;

/** Durable copy of acknowledged requests, written with the game state. */
const ACKED_ACTION_KEY = "ackedActionRecords";

/** Marks a directory row that still has to catch up with the room's match budget. */
const DIRECTORY_PENDING_KEY = "directoryExpiryPending";

const UTF8_ENCODER = new TextEncoder();

class ExpectedGameStartError extends Error {}

/**
 * Generates a random, human-readable room code using an unambiguous alphanumeric alphabet.
 * Characters like `0`, `O`, `1`, `I` are omitted to avoid confusion.
 *
 * @returns {string} A random room code of length {@link ROOM_CODE_LENGTH}.
 */
function generateRoomCode(): string {
  let code = "";

  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[randomInt(ROOM_CODE_CHARS.length)];
  }

  return code;
}

function isObjectValue<T>(value: T): value is T & WireObject {
  return wireObjectSchema.safeParse(value).success;
}

function objectValue(value: WireObject, key: string): WireValue {
  return value[key];
}

function parseUnknownJson(value: string): WireValue {
  return wireValueSchema.parse(JSON.parse(value));
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

/** Replace an exact identity in both JSON values and object keys. */
function replaceIdentityValue(value: WireValue, previousId: string, nextId: string): WireValue {
  if (isString(value)) {
    return value === previousId ? nextId : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => replaceIdentityValue(entry, previousId, nextId));
  }

  if (value === null || !isObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key === previousId ? nextId : key,
      replaceIdentityValue(entry, previousId, nextId),
    ]),
  );
}

function replaceIdentity<T extends BaseGameState | GameEventRecord[] | RewatchFrame[]>(
  value: T,
  previousId: string,
  nextId: string,
): T;
function replaceIdentity<T>(value: T, previousId: string, nextId: string): T {
  const data = wireValueSchema.parse(JSON.parse(JSON.stringify(value)));
  const replaced = replaceIdentityValue(data, previousId, nextId);

  // SAFETY: UUID identity substitution preserves the serialized domain structure and all nonidentity discriminants.
  return replaced as T;
}

type DurableSql = RoomSql;

function hasDurableSql(value: RoomStorage): value is RoomStorage & { sql: DurableSql } {
  return value.sql !== undefined;
}

function optionalNumber(value: WireObject, key: string): number | undefined {
  const field = objectValue(value, key);

  return isNumber(field) && Number.isFinite(field) ? field : undefined;
}

/** Optional caller-supplied id that lets a retried request replay its outcome. */
function validRequestId(value: WireValue): string | undefined {
  return isString(value) && value.length > 0 && value.length <= 64 ? value : undefined;
}

/** Stable JSON so key order cannot change an idempotency fingerprint. */
function canonicalJson(value: WireValue | undefined): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;

  if (isObjectValue(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;

  return JSON.stringify(value ?? null);
}

/** Identify the exact intent behind a request id. */
function actionFingerprint(actionType: string, data: WireValue | undefined): string {
  return `${actionType}|${canonicalJson(data ?? {})}`;
}

function parseRoomCreationConfig<T>(value: T): GameRoomConfig | null {
  if (!isObjectValue(value)) return null;
  const hostId = objectValue(value, "hostId");
  const hostName = objectValue(value, "hostName");
  const roomCode = objectValue(value, "roomCode");

  if (
    !isString(hostId) ||
    !hostId ||
    hostId.length > 128 ||
    !isString(hostName) ||
    !hostName ||
    hostName.length > 200 ||
    (roomCode !== undefined && (!isString(roomCode) || !/^[A-HJ-NP-Z2-9]{6}$/.test(roomCode)))
  )
    return null;

  const maxPlayers = optionalNumber(value, "maxPlayers");
  const gameTotalTime = optionalNumber(value, "gameTotalTime");
  const requestedTurnTime = optionalNumber(value, "turnTime");

  const turnTime =
    requestedTurnTime === undefined
      ? undefined
      : Math.min(Math.max(Math.trunc(requestedTurnTime), TURN_TIME_MIN_MS), TURN_TIME_MAX_MS);

  const config: GameRoomConfig = { hostId, hostName };

  if (isString(roomCode)) config.roomCode = roomCode;

  if (maxPlayers !== undefined) config.maxPlayers = maxPlayers;

  if (gameTotalTime !== undefined) config.gameTotalTime = gameTotalTime;

  if (turnTime !== undefined) config.turnTime = turnTime;

  return config;
}

function parseClientMessage<T>(value: T): ClientMessage | null {
  if (!isObjectValue(value)) return null;
  const type = objectValue(value, "type");

  if (!isString(type)) return null;
  const requestId = objectValue(value, "requestId");

  if (requestId !== undefined && (!isString(requestId) || !requestId || requestId.length > 64))
    return null;

  if (type === "action") {
    const payload = objectValue(value, "payload");

    if (!isObjectValue(payload)) return null;
    const actionType = objectValue(payload, "actionType");

    if (!isString(actionType)) return null;

    const message: ClientMessage = {
      type: "action",
      payload: { actionType, data: objectValue(payload, "data") },
    };

    if (isString(requestId)) message.requestId = requestId;

    return message;
  }

  if (type === "join") {
    const payload = objectValue(value, "payload");

    if (!isObjectValue(payload)) return null;
    const userId = objectValue(payload, "userId");
    const name = objectValue(payload, "name");

    return isString(userId) && isString(name) ? { type: "join", payload: { userId, name } } : null;
  }

  if (
    type === "leave" ||
    type === "start_game" ||
    type === "rewatch_saved" ||
    type === "timer_sync"
  ) {
    if (type === "start_game")
      return isString(requestId) ? { type: "start_game", requestId } : { type: "start_game" };

    if (type === "leave") return { type: "leave" };

    if (type === "rewatch_saved") return { type: "rewatch_saved" };

    return { type: "timer_sync" };
  }

  return null;
}

/**
 * Base class for all 1v1 game room Durable Objects.
 *
 * **Agent-first multiplayer**
 * - Server owns all rules, RNG, and projected state.
 * - Browser humans connect via WebSocket (cookie session).
 * - External agents connect as real seats via OAuth + HTTP `/agent/*`
 *   (remote MCP) or WebSocket (agent-client / CLI). No in-server LLM / OpenRouter.
 * - Clients only send intents (`actionType` + data) and read projected `you` views.
 *
 * Subclasses implement `createDefaultState`, `handleGameAction`, and `onStartGame`.
 *
 * @template TState - The concrete game state type, must extend {@link BaseGameState}.
 */
/** Persisted audit event included in completed game logs. */
export interface GameEventRecord {
  seq: number;
  at: number;
  type: string;
  summary?: WireValue;
}

/**
 * Attachment stored on hibernatable WebSockets so seat identity survives DO sleep.
 * In-memory `sessions` is wiped on hibernation; Cloudflare keeps the socket + attachment.
 */
interface BroadcastAttachment {
  kind: "broadcast";
  connectionId?: string;
  subject?: string;
  sequence: number;
}

interface WsSessionAttachment {
  id: string;
  name: string;
  joinedAt: number;
  /** Watch-only; not a playing seat. */
  isSpectator?: boolean;
}

/** Soft cap so a viral room link cannot unbounded-grow spectator lists. */
const MAX_SPECTATORS = 32;

/** A caller-supplied request id plus the intent it must be bound to. */
interface AckRequest {
  playerId: string;
  requestId: string;
  fingerprint: string;
}

/** Outcome of one addressed action request, replayed instead of re-dispatching. */
interface AckedActionResult {
  playerId: string;
  requestId: string;
  /** Action type plus canonical payload, so a reused id cannot replay another move. */
  fingerprint: string;
  ok: boolean;
  message?: string;
  acceptedRevision: number;
  at: number;
}

export interface WaitForTurnResult {
  timedOut: boolean;
  reason: "your_turn" | "ended" | "timeout" | "waiting";
  revision: number;
  state?: unknown;
}

type TurnWaiter = {
  playerId: string;
  resolve: (result: WaitForTurnResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * MCP fields the platform builds itself.
 *
 * A game plugin may add decision data, but identity, roster, clocks, turn state
 * and the result belong to the platform: letting a plugin replace them would
 * bypass the projection boundary.
 */
const PLATFORM_AGENT_KEYS: ReadonlySet<string> = new Set([
  "type",
  "status",
  "players",
  "roomMembers",
  "gameTimeRemaining",
  "turnState",
  "winner",
  "you",
  "series",
]);

/** Whitelist of fields consumed by the generic MCP projection compactor. */
const agentProjectionSourceSchema = z
  .object({
    winnerSeat: wireValueSchema.optional(),
    yourSeat: wireValueSchema.optional(),
    sides: wireValueSchema.optional(),
    decision: wireValueSchema.optional(),
    battleLog: wireValueSchema.optional(),
    battleTurn: wireValueSchema.optional(),
    format: wireValueSchema.optional(),
    type: wireValueSchema.optional(),
    status: wireValueSchema.optional(),
    players: wireValueSchema.optional(),
    gameTimeRemaining: wireValueSchema.optional(),
    turnState: wireValueSchema.optional(),
    winner: wireValueSchema.optional(),
    board: wireValueSchema.optional(),
    seats: wireValueSchema.optional(),
    lastMove: wireValueSchema.optional(),
    scores: wireValueSchema.optional(),
    legalMoves: wireValueSchema.optional(),
    forcedPiece: wireValueSchema.optional(),
    quietTurns: wireValueSchema.optional(),
    lastPass: wireValueSchema.optional(),
    assignments: wireValueSchema.optional(),
    startingTeam: wireValueSchema.optional(),
    activeTeam: wireValueSchema.optional(),
    clue: wireValueSchema.optional(),
    guessesRemaining: wireValueSchema.optional(),
    guessesMade: wireValueSchema.optional(),
    remaining: wireValueSchema.optional(),
    winnerTeam: wireValueSchema.optional(),
    lastReveal: wireValueSchema.optional(),
    handNumber: wireValueSchema.optional(),
    activeHand: wireValueSchema.optional(),
    community: wireValueSchema.optional(),
    pot: wireValueSchema.optional(),
    currentBet: wireValueSchema.optional(),
    minRaise: wireValueSchema.optional(),
    actionPlayerId: wireValueSchema.optional(),
    toCall: wireValueSchema.optional(),
    canCheck: wireValueSchema.optional(),
    blinds: wireValueSchema.optional(),
    buttonPlayerId: wireValueSchema.optional(),
    smallBlindPlayerId: wireValueSchema.optional(),
    bigBlindPlayerId: wireValueSchema.optional(),
    actionLog: wireValueSchema.optional(),
    lastHandResult: wireValueSchema.optional(),
    boardSize: wireValueSchema.optional(),
    lastAnnouncement: wireValueSchema.optional(),
    fleet: wireValueSchema.optional(),
    munitionEconomy: wireValueSchema.optional(),
    yourBoard: wireValueSchema.optional(),
    opponent: wireValueSchema.optional(),
    progress: wireValueSchema.optional(),
    guessLimit: wireValueSchema.optional(),
    vocabularySize: wireValueSchema.optional(),
    totalGuesses: wireValueSchema.optional(),
    secret: wireValueSchema.optional(),
  })
  .catchall(wireValueSchema);

/** Known nested fields read while compacting projected game objects. */
const projectionPartSchema = z
  .object({
    id: wireValueSchema.optional(),
    roomCode: wireValueSchema.optional(),
    hostId: wireValueSchema.optional(),
    createdAt: wireValueSchema.optional(),
    updatedAt: wireValueSchema.optional(),
    expiresAt: wireValueSchema.optional(),
    spectators: wireValueSchema.optional(),
    spectatorCount: wireValueSchema.optional(),
    replayPerspectivePlayerId: wireValueSchema.optional(),
    players: wireValueSchema.optional(),
    you: wireValueSchema.optional(),
    currentPlayerId: wireValueSchema.optional(),
    turnNumber: wireValueSchema.optional(),
    phase: wireValueSchema.optional(),
    turnTimeRemaining: wireValueSchema.optional(),
    cannonReward: wireValueSchema.optional(),
    turnReward: wireValueSchema.optional(),
    damageReward: wireValueSchema.optional(),
    costs: wireValueSchema.optional(),
    yourPoints: wireValueSchema.optional(),
    ships: wireValueSchema.optional(),
    ready: wireValueSchema.optional(),
    munitionPoints: wireValueSchema.optional(),
    fleetStatus: wireValueSchema.optional(),
    incomingHits: wireValueSchema.optional(),
    incomingMisses: wireValueSchema.optional(),
    playerId: wireValueSchema.optional(),
    hits: wireValueSchema.optional(),
    misses: wireValueSchema.optional(),
    radarScans: wireValueSchema.optional(),
    shipsRemaining: wireValueSchema.optional(),
    sunkShips: wireValueSchema.optional(),
    name: wireValueSchema.optional(),
    cards: wireValueSchema.optional(),
    cardCount: wireValueSchema.optional(),
    bet: wireValueSchema.optional(),
    status: wireValueSchema.optional(),
    total: wireValueSchema.optional(),
    actionLog: wireValueSchema.optional(),
    action: wireValueSchema.optional(),
    handNumber: wireValueSchema.optional(),
    rank: wireValueSchema.optional(),
    actionType: wireValueSchema.optional(),
    reason: wireValueSchema.optional(),
    chips: wireValueSchema.optional(),
  })
  .catchall(wireValueSchema);

type ProjectionPart = z.output<typeof projectionPartSchema>;

export abstract class BaseGameRoom<TState extends BaseGameState> {
  protected state: RoomRuntime;
  protected env: Env;
  protected sessions: Map<WebSocket, Player> = new Map();
  protected broadcastQueue: Promise<void> = Promise.resolve();
  private broadcastPending = 0;
  protected gameState: TState | null = null;
  private lastGameTimerTickAt = 0;
  private lastTurnTimerTickAt = 0;
  private timerTurnStartedAt = 0;
  private timerTickRunning = false;
  /** Last room creation, new member, game start, or accepted player action. */
  private lastMeaningfulActivityAt = 0;

  /** Monotonic keys for append-only SQLite audit and rewatch rows. */
  private eventSeq = 0;
  private rewatchFrameSeq = 0;
  /** Test-shim fallback; production Durable Objects always use SQLite storage. */
  private fallbackEventRows: GameEventRecord[] = [];
  private fallbackRewatchRows: RewatchFrame[] = [];
  /** Last renderable projection, used only to avoid duplicate rewatch rows. */
  private lastRewatchSerialized = "";
  private archivePersist: Promise<boolean> | null = null;
  private endedCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRewatchAcks: Set<WebSocket> | null = null;
  private pendingAgentFinalAcks: Set<string> | null = null;
  private terminalBroadcastSent = false;
  private terminalResponseHolds = 0;
  private historyReady = false;
  private turnWaiters: TurnWaiter[] = [];
  /** Kept outside projected game state: billing owner and request bookkeeping. */
  private jev: JevSeat | null = null;
  private jevInFlight = false;

  /** Acknowledged (playerId, requestId) outcomes; see ACTION_RESULT_TTL_MS. */
  private ackedActions = new Map<string, AckedActionResult>();

  /** A previous directory extension failed and must be retried on the next save. */
  private directoryExpiryPending = false;

  /**
   * End reason a rule module reported but has not broadcast yet.
   *
   * It stays pending until the finished state is durable, so `game_ended` can
   * never describe a match whose final move and receipt failed to persist.
   */
  private pendingMatchEnd: string | null = null;

  /** Used for log prefixes, e.g. "Connect4Room" */
  protected abstract readonly roomLabel: string;

  /**
   * Initializes the Durable Object and restores persisted game state.
   * If the stored game was in progress, timers are restarted immediately.
   *
   * @param {DurableObjectState} state - The Cloudflare Durable Object state handle.
   * @param {Env} env - The worker environment bindings.
   */
  constructor(state: RoomRuntime, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(() => this.restorePersistedRoom());
  }

  /**
   * Restore the persisted room, its timers and its history after an instance
   * restart. A failure is reported before it is rethrown so a restart loop stays
   * visible in Worker logs.
   */
  private async restorePersistedRoom(): Promise<void> {
    try {
      const [stored, lastMeaningfulActivityAt, legacyLobbyLastActiveAt] = await Promise.all([
        this.state.storage.get<TState>("gameState"),
        this.state.storage.get<number>("lastMeaningfulActivityAt"),
        this.state.storage.get<number>("lobbyLastActiveAt"),
      ]);

      this.lastMeaningfulActivityAt = lastMeaningfulActivityAt ?? legacyLobbyLastActiveAt ?? 0;

      // A late reconnect to a purged room must not recreate its SQLite tables.
      if (stored) this.initializeHistoryTables();
      this.jev = (await this.state.storage.get<JevSeat>("jevSeat")) ?? null;

      if (this.jev?.status === "thinking") {
        this.jev.status = "retrying";
        this.jev.retryAt = Date.now() + 2000;
      }

      const eventRows = this.readEventRows();
      this.eventSeq = eventRows.at(-1)?.seq ?? 0;
      const rewatchRows = this.readRewatchRows();
      const lastFrame = rewatchRows.at(-1);
      this.rewatchFrameSeq = lastFrame ? lastFrame.index + 1 : 0;
      this.lastRewatchSerialized = lastFrame ? JSON.stringify(lastFrame.state) : "";

      if (stored) {
        const persistedUpdatedAt = stored.updatedAt;
        this.gameState = stored;
        this.directoryExpiryPending = (await this.state.storage.get<boolean>(DIRECTORY_PENDING_KEY)) === true;
        await this.restoreAckedActions();
        await this.migratePersistedLegacyAgentIds();
        await this.restoreBroadcastPermission();
        this.lastMeaningfulActivityAt ||= persistedUpdatedAt || stored.createdAt;

        if (stored.status === "playing") {
          // The persisted remaining values are a checkpoint. Account for all
          // wall time since that checkpoint before scheduling the next deadline.
          const checkpointAt = Math.min(persistedUpdatedAt, Date.now());
          this.lastGameTimerTickAt = checkpointAt;
          this.lastTurnTimerTickAt = checkpointAt;
          this.timerTurnStartedAt = stored.turnState.startedAt;
          const restoredAt = Date.now();
          this.syncRunningTimers(restoredAt);
          this.gameState.updatedAt = restoredAt;
          await this.state.storage.put("gameState", this.gameState);
        }

        await this.state.storage.put("lastMeaningfulActivityAt", this.lastMeaningfulActivityAt);

        if (stored.status === "ended") {
          // An ended state is an archive outbox. A previous isolate may have
          // stopped after saving the result but before the upload or purge.
          await this.state.storage.put("gameState", this.gameState);
          await this.state.storage.setAlarm(Date.now());

          return;
        }

        const expiresAt = this.applyRoomLifetimePolicy();

        if (expiresAt !== null && expiresAt <= Date.now()) {
          await this.cleanup("Room expired");

          return;
        }

        if (this.lastMeaningfulActivityAt + ROOM_INACTIVITY_MS <= Date.now()) {
          await this.expireInactiveRoom();

          return;
        }

        // A restart may land between the match save and the directory update;
        // finish that repair before arming the next alarm.
        if (this.directoryExpiryPending) await this.extendDirectoryExpiry();

        if (expiresAt !== null) {
          await this.state.storage.put("gameState", this.gameState);
          await this.scheduleNextRoomAlarm();
        }

        if (stored.status === "playing") {
          this.startTimers();
        }
      }
    } catch (error) {
      logEvent("state_restore_failed", { stage: "load" });
      throw error;
    }
  }

  /** Purge an inactive live room after five minutes, or any room at its fixed deadline. */
  async alarm(): Promise<void> {
    if (!this.gameState) return;

    // A failed R2/D1 archive keeps the ended room state and schedules a retry.
    // Retry archival before applying the ordinary active-room expiry policy.
    if (this.gameState.status === "ended") {
      if (!this.terminalBroadcastSent) {
        const reason = this.archiveEndReason(this.readEventRows(), "Game log archive retry");

        this.broadcastProjected("game_ended", { reason });
      }

      if (this.finalDeliveryComplete()) {
        await this.cleanup("Final state delivered");
      } else {
        const deliveryDeadline = this.gameState.updatedAt + FINAL_STATE_DELIVERY_GRACE_MS;

        if (Date.now() >= deliveryDeadline) {
          await this.cleanup("Final-state delivery grace elapsed");
        } else {
          await this.state.storage.setAlarm(deliveryDeadline);
        }
      }

      return;
    }

    const now = Date.now();
    const expiresAt = this.applyRoomLifetimePolicy();

    const inactivityAt = this.lastMeaningfulActivityAt + ROOM_INACTIVITY_MS;

    if (expiresAt !== null && now < expiresAt && now < inactivityAt) {
      if (this.gameState.status === "playing") {
        await this.runTimerTick();
        await this.runJevDecision();
      }

      await this.scheduleNextRoomAlarm();

      return;
    }

    if (expiresAt !== null && inactivityAt <= now && inactivityAt <= expiresAt) {
      await this.expireInactiveRoom();

      return;
    }

    this.gameState.status = "ended";
    this.gameState.turnState.phase = "ended";
    this.gameState.turnState.currentPlayerId = null;
    this.gameState.updatedAt = now;
    this.stopTimers();
    logEvent("room_lifecycle", {
      phase: "playing",
      reason: "room_expired",
      roomType: this.gameState.type,
      players: this.gameState.players.length,
    });
    this.recordEvent("game_ended", { reason: "room_expired" });
    await this.saveState();
    this.broadcastProjected("game_ended", { reason: "room_expired" });
  }

  // ─── HTTP fetch handler ────────────────────────────────────────

  /**
   * Main HTTP fetch handler for the Durable Object.
   * Routes requests to the appropriate sub-handler based on the URL path and method.
   *
   * Supported routes:
   * - WebSocket upgrade → {@link handleWebSocketUpgrade}
   * - `GET /state`      → returns serialized game state as JSON
   * - `POST /join`      → {@link handleJoinRoom}
   * - `POST /create`    → {@link handleCreateRoom}
   * - `POST /end`       → ends the current game
   * - `GET /timer`      → returns remaining game and turn times
   * - Agent HTTP (remote MCP, no WS required):
   *   - `POST /agent/join`
   *   - `POST /agent/migrate-identity` (one-time legacy upgrade)
   *   - `GET  /agent/view`
   *   - `POST /agent/action`
   *   - `POST /agent/start`
   *   - `POST /agent/wait-turn`
   *
   * @param {Request} request - The incoming HTTP request.
   * @returns {Promise<Response>} The HTTP response.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal coordinator endpoint. Public Worker routes never forward here.
    if (url.pathname === "/series/setup" && request.method === "POST") {
      return this.state.blockConcurrencyWhile(async () => {
        const body = await request.json<{
          hostId: string;
          hostName: string;
          roomCode: string;
          players: BasePlayerInfo[];
          series: { code: string; index: number; firstPlayerId: string };
        }>();

        if (this.gameState)
          return this.jsonResponse(
            {
              ok:
                this.gameState.series?.code === body.series.code &&
                this.gameState.series?.index === body.series.index,
              expiresAt: this.gameState.expiresAt,
            },
            this.gameState.series?.code === body.series.code &&
              this.gameState.series?.index === body.series.index
              ? 200
              : 409,
          );
        const config = parseRoomCreationConfig(body);

        if (
          !config ||
          body.players.length !== 2 ||
          !body.players.some((p) => p.id === body.series.firstPlayerId)
        )
          return this.jsonResponse({ error: "Invalid series match" }, 400);
        this.gameState = this.createDefaultState(config, body.roomCode);
        this.gameState.players = body.players;
        this.gameState.spectators = body.players.some((p) => p.id === body.hostId)
          ? []
          : [{ id: body.hostId, name: body.hostName, channel: "browser" }];
        this.gameState.series = { ...body.series, metrics: {} };
        await this.saveCreatedStateAndScheduleExpiry(this.gameState.createdAt);

        return this.jsonResponse({ ok: true, expiresAt: this.gameState.expiresAt });
      });
    }

    // Internal Worker check only. Inviting does not reserve a seat or renew activity.
    if (url.pathname === "/webhook-invite-check" && request.method === "POST") {
      const body = await request.json<{ ownerId?: string }>().catch(() => null);
      const game = this.gameState;

      if (
        !game ||
        game.expiresAt <= Date.now() ||
        this.lastMeaningfulActivityAt + ROOM_INACTIVITY_MS <= Date.now()
      )
        return this.jsonResponse(null, 404);

      if (
        body?.ownerId !== game.hostId ||
        game.status !== "waiting" ||
        game.players.length >= game.maxPlayers
      )
        return this.jsonResponse(null, 409);

      return this.jsonResponse({ ok: true });
    }

    // Namespace-stub maintenance only; no public Worker route forwards here.
    // Serialize with room creation and never delete a live or unarchived game.
    if (url.pathname === "/maintenance/purge-empty" && request.method === "POST") {
      return this.state.blockConcurrencyWhile(async () => {
        if (this.gameState || (await this.state.storage.get("gameState"))) {
          return this.jsonResponse({ cleared: false, reason: "game_state_present" }, 409);
        }

        await this.state.storage.deleteAlarm();
        await this.state.storage.deleteAll();
        this.historyReady = false;

        return this.jsonResponse({ cleared: true });
      });
    }

    // Internal only. No seat, session, activity renewal, action, or rewatch access.
    if (["/broadcast", "/broadcast/stream"].includes(url.pathname) && request.method === "GET") {
      const state = this.gameState;

      if (
        !state ||
        !["playing", "ended"].includes(state.status) ||
        state.expiresAt <= Date.now() ||
        (url.searchParams.has("createdAt") &&
          Number(url.searchParams.get("createdAt")) !== state.createdAt) ||
        this.lastMeaningfulActivityAt + ROOM_INACTIVITY_MS <= Date.now()
      ) {
        return this.jsonResponse(null, 404);
      }

      if (state.broadcastAllowed !== true) {
        for (const ws of this.broadcastSockets()) ws.close(4003, "Broadcast unavailable");

        return this.jsonResponse(null, 404);
      }

      if (url.pathname === "/broadcast/stream") {
        const subject = request.headers.get("X-Broadcast-Subject") ?? "";

        if (!/^[a-f0-9]{64}$/.test(subject)) return this.jsonResponse(null, 401);

        if (request.headers.get("Upgrade") !== "websocket") return this.jsonResponse(null, 426);

        if (this.broadcastSockets().length >= 8) return this.jsonResponse(null, 429);
        const pair = new WebSocketPair();

        const client = pair[0],
          server = pair[1];

        this.state.acceptWebSocket?.(server);
        server.serializeAttachment({
          kind: "broadcast",
          connectionId: crypto.randomUUID(),
          subject,
          sequence: 0,
        } satisfies BroadcastAttachment);
        this.queueBroadcastState([server], true);
        await this.scheduleNextRoomAlarm();

        return new Response(null, { status: 101, webSocket: client });
      }

      // Empty IDs cannot be authenticated members. Clients cannot choose a viewpoint.
      return this.jsonResponse(this.buildBroadcastView());
    }

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request, url);
    }

    // Agent HTTP first — paths like /agent/join must not match endsWith("/join")
    if (url.pathname.includes("/agent/")) {
      if (url.pathname.endsWith("/agent/migrate-identity") && request.method === "POST") {
        return this.handleAgentIdentityMigration(request);
      }

      if (url.pathname.endsWith("/agent/join") && request.method === "POST") {
        return this.handleAgentJoin(request);
      }

      if (url.pathname.endsWith("/agent/view") && request.method === "GET") {
        return this.handleAgentView(url);
      }

      if (url.pathname.endsWith("/agent/action") && request.method === "POST") {
        return this.handleAgentAction(request);
      }

      if (url.pathname.endsWith("/agent/start") && request.method === "POST") {
        return this.handleAgentStart(request);
      }

      if (url.pathname.endsWith("/agent/wait-turn") && request.method === "POST") {
        return this.handleAgentWaitTurn(request);
      }

      return new Response("Not Found", { status: 404 });
    }

    if (url.pathname.endsWith("/state")) {
      if (!this.gameState) return this.jsonResponse(null, 404);

      return this.jsonResponse({
        roomCode: this.gameState.roomCode,
        status: this.gameState.status,
        players: this.gameState.players.map(({ id, name }) => ({ id, name })),
        spectators: (this.gameState.spectators ?? []).map(({ id, name }) => ({ id, name })),
        maxPlayers: this.gameState.maxPlayers,
        expiresAt: this.gameState.expiresAt,
      });
    }

    if (url.pathname.endsWith("/join") && request.method === "POST") {
      return this.handleJoinRoom(request);
    }

    if (url.pathname.endsWith("/create") && request.method === "POST") {
      return this.handleCreateRoom(request);
    }

    if (url.pathname.endsWith("/end") && request.method === "POST") {
      if (this.gameState?.series) this.gameState.series.aborted = true;
      await this.endGame();

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname.endsWith("/timer")) {
      return new Response(JSON.stringify(this.clockSnapshot()), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }

  // ─── Agent HTTP (no WebSocket) ─────────────────────────────────

  private jsonResponse<T>(data: T, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  private agentActionErrorResponse(
    playerId: string | undefined,
    rejection: ActionRejection,
    extra?: { replayed?: boolean },
  ): Response {
    const state =
      playerId && this.gameState && this.isRoomMember(playerId)
        ? this.buildAgentView(playerId)
        : null;

    const parsed = z
      .object({ you: z.object({ legalActions: z.array(z.string()).optional() }).optional() })
      .safeParse(state);

    const legalActions = parsed.success ? (parsed.data.you?.legalActions ?? []) : [];

    const error = publicActionError(rejection);

    if (extra?.replayed)
      return this.jsonResponse({ ok: false, replayed: true, error, state, legalActions }, rejection.httpStatus);

    return this.jsonResponse({ ok: false, error, state, legalActions }, rejection.httpStatus);
  }

  private initializeFinalDeliveryRecipients(): void {
    if (!this.gameState || this.gameState.status !== "ended") return;
    this.restoreSessions();

    if (!this.pendingRewatchAcks) {
      this.pendingRewatchAcks = new Set(
        [...this.sessions.keys()].filter((ws) => ws.readyState === WebSocket.OPEN),
      );
    }

    if (!this.pendingAgentFinalAcks) {
      const socketPlayerIds = new Set(
        [...this.sessions.entries()].flatMap(([ws, player]) =>
          ws.readyState === WebSocket.OPEN ? [player.id] : [],
        ),
      );

      this.pendingAgentFinalAcks = new Set(
        [...this.gameState.players, ...this.ensureSpectators()].flatMap((member) =>
          member.isAgent && !member.hostedAgent && !socketPlayerIds.has(member.id)
            ? [member.id]
            : [],
        ),
      );
    }
  }

  private finalDeliveryComplete(): boolean {
    return (
      this.terminalResponseHolds === 0 &&
      (this.pendingRewatchAcks?.size ?? 0) === 0 &&
      (this.pendingAgentFinalAcks?.size ?? 0) === 0
    );
  }

  private maybeCleanupAfterFinalDelivery(reason: string): void {
    if (
      !this.terminalBroadcastSent ||
      this.gameState?.status !== "ended" ||
      !this.finalDeliveryComplete()
    ) {
      return;
    }

    if (this.endedCleanupTimer) {
      clearTimeout(this.endedCleanupTimer);
      this.endedCleanupTimer = null;
    }

    // cleanup yields before clearing gameState, so an HTTP action/wait handler
    // can finish serializing the terminal response while archival proceeds.
    void this.cleanup(reason);
  }

  private markAgentFinalDelivered(playerId: string): void {
    if (this.gameState?.status !== "ended") return;
    this.initializeFinalDeliveryRecipients();
    this.pendingAgentFinalAcks?.delete(playerId);
    this.maybeCleanupAfterFinalDelivery("Final state delivered");
  }

  private async migrateRoomIdentity(
    previous: string,
    next: string,
    notify: boolean,
  ): Promise<"migrated" | "current" | "missing" | "conflict"> {
    if (!this.gameState) return "missing";

    if (this.isRoomMember(next) && !this.isRoomMember(previous)) {
      return "current";
    }

    if (!this.isRoomMember(previous)) return "missing";

    if (this.isRoomMember(next)) return "conflict";

    this.gameState = replaceIdentity(this.gameState, previous, next);

    const migratedEvents = replaceIdentity(this.readEventRows(), previous, next);

    const migratedFrames = replaceIdentity(this.readRewatchRows(), previous, next);

    const sql = this.historySql();

    if (sql) {
      for (const event of migratedEvents) {
        sql.exec(
          "UPDATE game_events SET summary_json = ? WHERE seq = ?",
          event.summary === undefined ? null : JSON.stringify(event.summary),
          event.seq,
        );
      }

      for (const frame of migratedFrames) {
        sql.exec(
          "UPDATE rewatch_frames SET state_json = ? WHERE frame_index = ?",
          JSON.stringify(frame.state),
          frame.index,
        );
      }
    } else {
      this.fallbackEventRows = migratedEvents;
      this.fallbackRewatchRows = migratedFrames;
    }

    this.lastRewatchSerialized = this.lastRewatchSerialized
      ? this.lastRewatchSerialized.replaceAll(previous, next)
      : "";
    this.turnWaiters = this.turnWaiters.map((waiter) =>
      waiter.playerId === previous ? { ...waiter, playerId: next } : waiter,
    );
    await this.saveState();

    if (notify) {
      this.broadcastState();
      this.resolveTurnWaiters();
    }

    return "migrated";
  }

  /** Upgrade every persisted legacy MCP identity before any view is returned. */
  private async migratePersistedLegacyAgentIds(): Promise<void> {
    if (!this.gameState || !this.env.DB) return;
    const gameType = normalizeGameType(this.gameState.type);

    if (!gameType) return;
    const roomId = roomIdFor(gameType, this.gameState.roomCode);

    const legacyIds = [...this.gameState.players, ...this.ensureSpectators()].flatMap((member) =>
      (member.isAgent === true || member.channel === "mcp") &&
      !member.hostedAgent &&
      !member.id.startsWith("player_")
        ? [member.id]
        : [],
    );

    for (const legacyAgentId of legacyIds) {
      try {
        const roomPlayer = await ensureLegacyMcpRoomPlayer(this.env.DB, legacyAgentId, roomId);

        if (roomPlayer) {
          await this.migrateRoomIdentity(legacyAgentId, roomPlayer.playerId, false);
        }
      } catch (error) {
        // A transient D1 failure must not prevent a room from waking. The
        // authenticated MCP tool path retains an on-demand migration fallback.
        console.error(`${this.roomLabel}: legacy identity upgrade deferred`, error);
      }
    }
  }

  /**
   * One-time compatibility bridge for rooms created before agentId became a
   * private credential. The Worker calls this only after authenticating the
   * legacy agentId and minting its room-scoped public playerId.
   */
  private async handleAgentIdentityMigration(request: Request): Promise<Response> {
    try {
      const input = wireValueSchema.parse(await request.json());
      const raw = isObjectValue(input) ? input : null;
      const previous = raw ? objectValue(raw, "legacyAgentId") : undefined;
      const next = raw ? objectValue(raw, "playerId") : undefined;

      if (
        !isString(previous) ||
        !previous ||
        previous.length > 128 ||
        !isString(next) ||
        !next ||
        next.length > 128 ||
        previous === next
      ) {
        return this.jsonResponse({ error: "Invalid identity migration" }, 400);
      }

      if (!this.gameState) {
        return this.jsonResponse({ error: "Room not found" }, 404);
      }

      const result = await this.migrateRoomIdentity(previous, next, true);

      if (result === "current") {
        return this.jsonResponse({ ok: true, migrated: false, playerId: next });
      }

      if (result === "missing") {
        return this.jsonResponse({ error: "Legacy agent is not in this room" }, 404);
      }

      if (result === "conflict") {
        return this.jsonResponse({ error: "Public player identity already exists" }, 409);
      }

      return this.jsonResponse({ ok: true, migrated: true, playerId: next });
    } catch (error) {
      console.error(`${this.roomLabel}: identity migration failed`, error);

      return this.jsonResponse({ error: "Identity migration failed" }, 500);
    }
  }

  /**
   * Ensure an MCP agent's public identity is seated in the room.
   * Body: { playerId, assignedCodename, channel?: "mcp" }
   * `assignedCodename` comes from the server-owned MCP seat record. It is not
   * exposed as an agent-selectable MCP tool argument.
   *
   * `playerId` is a random room-scoped identifier resolved by the Worker. The
   * private agentId credential must never be sent to this Durable Object.
   */
  private async handleAgentJoin(request: Request): Promise<Response> {
    try {
      const input = wireValueSchema.parse(await request.json());
      const raw = isObjectValue(input) ? input : null;
      const requestedPlayerId = raw ? objectValue(raw, "playerId") : undefined;
      const assignedCodename = raw ? objectValue(raw, "assignedCodename") : undefined;
      const ownerGamertag = raw ? objectValue(raw, "ownerGamertag") : undefined;
      const environmentLabel = raw ? objectValue(raw, "environmentLabel") : undefined;

      const body = {
        playerId: isString(requestedPlayerId) ? requestedPlayerId : undefined,
        assignedCodename: isString(assignedCodename) ? assignedCodename : undefined,
        ownerGamertag: isString(ownerGamertag) ? ownerGamertag : undefined,
        environmentLabel: isString(environmentLabel) ? environmentLabel : undefined,
      };

      if (
        !body.playerId ||
        body.playerId.length > 128 ||
        !body.assignedCodename ||
        body.assignedCodename.length > 200 ||
        !isCodenameFormat(body.assignedCodename) ||
        (body.ownerGamertag != null && body.ownerGamertag.length > 20) ||
        (body.environmentLabel != null && body.environmentLabel.length > 40)
      ) {
        return this.jsonResponse({ error: "playerId required" }, 400);
      }

      if (!this.gameState) {
        return this.jsonResponse({ error: "Room not found" }, 404);
      }

      const channel: SeatChannel = "mcp";

      const existing = this.gameState.players.find((p) => p.id === body.playerId);

      const existingSpectator = this.ensureSpectators().find((p) => p.id === body.playerId);

      // A host may have deliberately moved this MCP seat to the watch list.
      // Rejoining must preserve that decision instead of consuming the newly
      // opened player seat again.
      if (!existing && existingSpectator) {
        const seatChanged =
          existingSpectator.isAgent !== true ||
          existingSpectator.channel !== channel ||
          !existingSpectator.codename ||
          (body.ownerGamertag != null && body.ownerGamertag !== existingSpectator.ownerGamertag) ||
          (body.environmentLabel != null &&
            body.environmentLabel !== existingSpectator.environmentLabel);

        existingSpectator.isAgent = true;
        existingSpectator.channel = channel;
        existingSpectator.codename ??= existingSpectator.name;
        existingSpectator.ownerGamertag = body.ownerGamertag || existingSpectator.ownerGamertag;
        existingSpectator.environmentLabel =
          body.environmentLabel || existingSpectator.environmentLabel;
        this.gameState.updatedAt = Date.now();
        await this.saveState();

        if (seatChanged) {
          await this.markMeaningfulActivity();
        } else {
          await this.scheduleNextRoomAlarm();
        }

        this.broadcastState();

        return this.jsonResponse({
          ok: true,
          roomCode: this.gameState.roomCode,
          status: this.gameState.status,
          codename: existingSpectator.codename,
          ownerGamertag: existingSpectator.ownerGamertag,
          environmentLabel: existingSpectator.environmentLabel,
          channel,
          channelLabel: channelLabel(channel),
          message: `Watching as ${existingSpectator.name} (${channelLabel(channel)})`,
          isNewSeat: false,
          isSpectator: true,
          state: this.buildAgentView(body.playerId),
        });
      }

      let seatName: string;
      let isNew = false;
      let seatChanged = false;

      if (!existing) {
        if (this.gameState.players.length >= this.gameState.maxPlayers) {
          return this.jsonResponse({ error: "Room is full" }, 403);
        }

        if (this.gameState.status !== "waiting") {
          return this.jsonResponse({ error: "Game already started" }, 403);
        }

        const taken = this.gameState.players.map((p) => p.name);
        const assignedCodename = body.assignedCodename.trim();
        seatName = taken.some((name) => name.toLowerCase() === assignedCodename.toLowerCase())
          ? generateUniqueCodename(taken)
          : assignedCodename;
        this.gameState.players.push({
          id: body.playerId,
          name: seatName,
          isAgent: true,
          channel,
          codename: seatName,
          ownerGamertag: body.ownerGamertag || "Player",
          environmentLabel: body.environmentLabel || "MCP Agent",
        });
        isNew = true;
        seatChanged = true;
        this.gameState.updatedAt = Date.now();
        await this.saveState();
        this.broadcast({
          type: "player_joined",
          payload: {
            userId: body.playerId,
            name: seatName,
            codename: seatName,
            ownerGamertag: body.ownerGamertag || "Player",
            environmentLabel: body.environmentLabel || "MCP Agent",
            channel,
            isAgent: true,
            roomCode: this.gameState.roomCode,
          },
        });
        this.broadcastState();
      } else {
        // Re-seat / host created via /create then agentJoin
        const needsCodename = !existing.codename;
        seatChanged =
          existing.isAgent !== true ||
          existing.channel !== channel ||
          needsCodename ||
          (body.ownerGamertag != null && body.ownerGamertag !== existing.ownerGamertag) ||
          (body.environmentLabel != null && body.environmentLabel !== existing.environmentLabel);
        existing.isAgent = true;
        existing.channel = channel;
        existing.ownerGamertag = body.ownerGamertag || existing.ownerGamertag || "Player";
        existing.environmentLabel =
          body.environmentLabel || existing.environmentLabel || "MCP Agent";

        if (needsCodename) {
          const taken = this.gameState.players
            .filter((p) => p.id !== body.playerId)
            .map((p) => p.name);

          const assignedCodename = body.assignedCodename.trim();
          seatName = taken.some((name) => name.toLowerCase() === assignedCodename.toLowerCase())
            ? generateUniqueCodename(taken)
            : assignedCodename;
          existing.name = seatName;
          existing.codename = seatName;
        } else {
          seatName = existing.codename || existing.name;
        }

        this.gameState.updatedAt = Date.now();
        await this.saveState();
        this.broadcastState();
      }

      const seat = this.gameState.players.find((p) => p.id === body.playerId)!;
      seatName = seat.codename || seat.name;

      if (seatChanged) {
        await this.markMeaningfulActivity();
      } else {
        await this.scheduleNextRoomAlarm();
      }

      return this.jsonResponse({
        ok: true,
        roomCode: this.gameState.roomCode,
        status: this.gameState.status,
        codename: seatName,
        ownerGamertag: seat.ownerGamertag,
        environmentLabel: seat.environmentLabel,
        channel,
        channelLabel: channelLabel(channel),
        message: `Seated as ${seatName} (${channelLabel(channel)})`,
        isNewSeat: isNew,
        state: this.buildAgentView(body.playerId),
      });
    } catch {
      return this.jsonResponse({ error: "Invalid request" }, 400);
    }
  }

  /** GET /agent/view?playerId= */
  private async handleAgentView(url: URL): Promise<Response> {
    const playerId = url.searchParams.get("playerId");

    if (!playerId) {
      return this.jsonResponse({ error: "playerId required" }, 400);
    }

    if (!this.gameState) {
      return this.jsonResponse({ error: "Room not found" }, 404);
    }

    if (!this.isRoomMember(playerId)) {
      return this.jsonResponse({ error: "Player or spectator not in room" }, 403);
    }

    const state = this.buildAgentView(playerId);
    const response = this.jsonResponse({ state });

    if (this.gameState.status === "ended") {
      this.markAgentFinalDelivered(playerId);
    }

    return response;
  }

  /**
   * POST /agent/action — body: { playerId, actionType, data? }
   */
  private async handleAgentAction(request: Request): Promise<Response> {
    let actionType = "unknown";
    let playerId: string | undefined;
    let holdsTerminalResponse = false;

    try {
      const input = wireValueSchema.parse(await request.json());
      const raw = isObjectValue(input) ? input : null;
      const requestedPlayerId = raw ? objectValue(raw, "playerId") : undefined;
      const requestedAction = raw ? objectValue(raw, "actionType") : undefined;

      const body = {
        playerId: isString(requestedPlayerId) ? requestedPlayerId : undefined,
        actionType: isString(requestedAction) ? requestedAction : undefined,
        data: raw ? objectValue(raw, "data") : undefined,
        requestId: validRequestId(raw ? objectValue(raw, "requestId") : undefined),
      };

      actionType = body.actionType ?? actionType;
      playerId = body.playerId;

      if (!body.playerId || !body.actionType) {
        return this.agentActionErrorResponse(
          body.playerId,
          classifyActionError("playerId and actionType required", actionType),
        );
      }

      if (
        body.actionType.length > 64 ||
        !/^[a-z][a-z0-9_]*$/.test(body.actionType) ||
        utf8ByteLength(JSON.stringify(body.data ?? {})) > 32 * 1024
      ) {
        return this.agentActionErrorResponse(
          body.playerId,
          classifyActionError("Invalid or oversized action", body.actionType),
        );
      }

      if (!this.gameState) {
        return this.agentActionErrorResponse(
          body.playerId,
          classifyActionError("Room not found", body.actionType),
        );
      }

      if (!this.isRoomMember(body.playerId)) {
        return this.agentActionErrorResponse(
          body.playerId,
          classifyActionError(
            "Player or spectator not in room; call agent/join first",
            body.actionType,
          ),
        );
      }

      const player = this.makeAgentPlayer(body.playerId);
      this.terminalResponseHolds += 1;
      holdsTerminalResponse = true;

      const fingerprint = actionFingerprint(body.actionType, body.data);
      const replay = this.replayAckedAction(body.playerId, body.requestId, fingerprint);

      if (replay && "conflict" in replay)
        return this.agentActionErrorResponse(
          body.playerId,
          idempotencyConflict(body.actionType),
        );

      if (replay)
        return replay.acked.ok
          ? this.jsonResponse({
              ok: true,
              replayed: true,
              acceptedRevision: replay.acked.acceptedRevision,
              state: this.buildAgentView(body.playerId),
            })
          : this.agentActionErrorResponse(
              body.playerId,
              classifyActionError(replay.acked.message ?? "Rejected", body.actionType),
              { replayed: true },
            );

      const ack =
        body.requestId && body.playerId
          ? { playerId: body.playerId, requestId: body.requestId, fingerprint }
          : undefined;

      const err = await this.dispatchAction(
        player,
        { actionType: body.actionType, data: body.data ?? {} },
        true,
        ack,
      );

      if (err) {
        await this.persistRejection(ack, err.message);

        return this.agentActionErrorResponse(body.playerId, err);
      }

      const state = this.buildAgentView(body.playerId);
      const ended = this.gameState.status === "ended";

      const endReason = ended ? this.archiveEndReason(this.readEventRows(), "ended") : undefined;

      const response = this.jsonResponse({
        ok: true,
        acceptedRevision: this.eventSeq,
        endReason,
        state,
      });

      if (ended) {
        this.markAgentFinalDelivered(body.playerId);
      }

      return response;
    } catch (e) {
      console.error(`${this.roomLabel}: agent action failed`, e);
      logEvent("mcp_action_failed", {
        stage: "dispatch",
        actionType,
        roomType: this.gameState?.type,
      });

      return this.agentActionErrorResponse(playerId, internalActionError(actionType));
    } finally {
      if (holdsTerminalResponse) {
        this.terminalResponseHolds = Math.max(0, this.terminalResponseHolds - 1);
        this.maybeCleanupAfterFinalDelivery("Final state delivered");
      }
    }
  }

  /** POST /agent/start — body: { playerId, requestId? } (host only) */
  private async handleAgentStart(request: Request): Promise<Response> {
    const actionType = "start_game";
    let playerId: string | undefined;
    let requestId: string | undefined;

    try {
      const input = wireValueSchema.parse(await request.json());
      const raw = isObjectValue(input) ? input : null;
      const requestedPlayerId = raw ? objectValue(raw, "playerId") : undefined;

      const body = {
        playerId: isString(requestedPlayerId) ? requestedPlayerId : undefined,
        requestId: validRequestId(raw ? objectValue(raw, "requestId") : undefined),
      };

      playerId = body.playerId;
      requestId = body.requestId;

      if (!body.playerId) {
        return this.agentActionErrorResponse(
          undefined,
          classifyActionError("playerId required", actionType),
        );
      }

      if (!this.gameState) {
        return this.agentActionErrorResponse(
          body.playerId,
          classifyActionError("Room not found", actionType),
        );
      }

      if (this.gameState.hostId !== body.playerId) {
        return this.agentActionErrorResponse(
          body.playerId,
          classifyActionError("Only the host can start", actionType),
        );
      }

      if (this.gameState.series && this.gameState.status === "playing")
        return this.jsonResponse({ ok: true });

      const fingerprint = actionFingerprint(actionType, {});
      const replay = this.replayAckedAction(body.playerId, body.requestId, fingerprint);

      if (replay && "conflict" in replay)
        return this.agentActionErrorResponse(body.playerId, idempotencyConflict(actionType));

      if (replay && "acked" in replay && !replay.acked.ok)
        return this.agentActionErrorResponse(
          body.playerId,
          classifyActionError(replay.acked.message ?? "Rejected", actionType),
          { replayed: true },
        );

      if (replay && "acked" in replay)
        return this.jsonResponse({
          ok: true,
          replayed: true,
          acceptedRevision: replay.acked.acceptedRevision,
          state: this.buildAgentView(body.playerId),
        });

      await this.startGame();

      // The match state is already durable; this write attaches its receipt.
      if (body.requestId)
        this.rememberAckedAction(
          { playerId: body.playerId, requestId: body.requestId, fingerprint },
          { ok: true, acceptedRevision: this.eventSeq },
        );

      await this.saveState();

      return this.jsonResponse({
        ok: true,
        state: this.buildAgentView(body.playerId),
      });
    } catch (e) {
      if (e instanceof ExpectedGameStartError) {
        if (playerId && requestId)
          await this.persistRejection(
            { playerId, requestId, fingerprint: actionFingerprint(actionType, {}) },
            e.message,
          );

        return this.agentActionErrorResponse(playerId, classifyActionError(e.message, actionType));
      }

      console.error(`${this.roomLabel}: start game failed`, e);

      return this.agentActionErrorResponse(playerId, internalActionError(actionType));
    }
  }

  /**
   * POST /agent/wait-turn
   * Body: { playerId, timeoutMs? }
   * Blocks in the DO (renewable short wait) until your turn, game end, or timeout.
   * Returns a minimal per-game decision state when woken; ordinary timeouts
   * omit unchanged state. Activity details remain private in the DO.
   */
  private async handleAgentWaitTurn(request: Request): Promise<Response> {
    try {
      const input = wireValueSchema.parse(await request.json());
      const raw = isObjectValue(input) ? input : null;
      const requestedPlayerId = raw ? objectValue(raw, "playerId") : undefined;
      const requestedTimeout = raw ? objectValue(raw, "timeoutMs") : undefined;

      const body = {
        playerId: isString(requestedPlayerId) ? requestedPlayerId : undefined,
        timeoutMs:
          isNumber(requestedTimeout) && Number.isFinite(requestedTimeout)
            ? requestedTimeout
            : undefined,
      };

      if (!body.playerId) {
        return this.jsonResponse({ error: "playerId required" }, 400);
      }

      if (!this.gameState) {
        return this.jsonResponse({ error: "Room not found" }, 404);
      }

      if (!this.isRoomMember(body.playerId)) {
        return this.jsonResponse({ error: "Player or spectator not in room" }, 403);
      }

      // Cap for Workers request lifetime; clients should renew on timeout
      const timeoutMs = Math.min(Math.max(body.timeoutMs ?? 25_000, 1_000), 30_000);

      const result = await this.waitForTurnInternal(body.playerId, timeoutMs);

      const response = this.jsonResponse(result);

      if (result.reason === "ended") {
        this.markAgentFinalDelivered(body.playerId);
      }

      return response;
    } catch (e) {
      const message = e instanceof Error ? e.message : "wait-turn failed";

      return this.jsonResponse({ error: message }, 500);
    }
  }

  protected makeAgentPlayer(playerId: string): Player {
    // Minimal player for HTTP dispatch; no live WebSocket required
    const seat = this.gameState?.players.find((p) => p.id === playerId);

    const spectator = !seat
      ? this.gameState?.spectators?.find((p) => p.id === playerId)
      : undefined;

    const identity = seat ?? spectator;

    return {
      id: playerId,
      name: identity?.name || "ServerAssignedAgent",
      socket: null,
      isConnected: true,
      joinedAt: Date.now(),
      isAgent: true,
      channel: identity?.channel ?? "mcp",
      codename: identity?.codename,
      ownerGamertag: identity?.ownerGamertag,
      environmentLabel: identity?.environmentLabel,
      isSpectator: Boolean(spectator),
    };
  }

  /** SQLite exists in deployed DOs; small unit shims use the fallback arrays. */
  private historySql(): RoomSql | null {
    return this.historyReady && hasDurableSql(this.state.storage) ? this.state.storage.sql : null;
  }

  private initializeHistoryTables(): void {
    if (this.historyReady || !hasDurableSql(this.state.storage)) return;
    const sql = this.state.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS game_events (
        seq INTEGER PRIMARY KEY,
        at INTEGER NOT NULL,
        type TEXT NOT NULL,
        summary_json TEXT
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS rewatch_frames (
        frame_index INTEGER PRIMARY KEY,
        at INTEGER NOT NULL,
        label TEXT NOT NULL,
        state_json TEXT NOT NULL
      )
    `);
    this.historyReady = true;
  }

  private insertEventRow(event: GameEventRecord): void {
    const sql = this.historySql();

    if (sql) {
      sql.exec(
        `INSERT OR IGNORE INTO game_events
          (seq, at, type, summary_json) VALUES (?, ?, ?, ?)`,
        event.seq,
        event.at,
        event.type,
        event.summary === undefined ? null : JSON.stringify(event.summary),
      );

      return;
    }

    if (!this.fallbackEventRows.some((row) => row.seq === event.seq)) {
      this.fallbackEventRows.push(structuredClone(event));
      this.fallbackEventRows.sort((a, b) => a.seq - b.seq);
    }
  }

  private readEventRows(): GameEventRecord[] {
    const sql = this.historySql();

    if (!sql) return structuredClone(this.fallbackEventRows);

    return sql
      .exec<{
        seq: number;
        at: number;
        type: string;
        summary_json: string | null;
      }>(
        `SELECT seq, at, type, summary_json
       FROM game_events ORDER BY seq`,
      )
      .toArray()
      .map((row) => {
        const event: GameEventRecord = { seq: row.seq, at: row.at, type: row.type };

        if (row.summary_json !== null) event.summary = parseUnknownJson(row.summary_json);

        return event;
      });
  }

  private insertRewatchRow(frame: RewatchFrame): void {
    const sql = this.historySql();

    if (sql) {
      sql.exec(
        `INSERT OR IGNORE INTO rewatch_frames
          (frame_index, at, label, state_json) VALUES (?, ?, ?, ?)`,
        frame.index,
        frame.at,
        frame.label,
        JSON.stringify(frame.state),
      );
      const recentStart = frame.index - (MAX_REWATCH_FRAMES - 2);

      if (recentStart > 1) {
        sql.exec(
          `DELETE FROM rewatch_frames
           WHERE frame_index < ?
             AND frame_index <> (
               SELECT MIN(frame_index) FROM rewatch_frames
             )`,
          recentStart,
        );
      }

      return;
    }

    if (!this.fallbackRewatchRows.some((row) => row.index === frame.index)) {
      this.fallbackRewatchRows.push(structuredClone(frame));
      this.fallbackRewatchRows.sort((a, b) => a.index - b.index);

      if (this.fallbackRewatchRows.length > MAX_REWATCH_FRAMES) {
        const first = this.fallbackRewatchRows[0]!;
        this.fallbackRewatchRows = [
          first,
          ...this.fallbackRewatchRows.slice(-(MAX_REWATCH_FRAMES - 1)),
        ];
      }
    }
  }

  private readRewatchRows(): RewatchFrame[] {
    const sql = this.historySql();

    if (!sql) {
      return this.fitRewatchPayload(structuredClone(this.fallbackRewatchRows));
    }

    type RewatchSqlRow = {
      frame_index: number;
      at: number;
      label: string;
      state_json: string;
    };

    const first = sql
      .exec<RewatchSqlRow>(
        `SELECT frame_index, at, label, state_json
       FROM rewatch_frames
       WHERE length(CAST(state_json AS BLOB)) <= ?
       ORDER BY frame_index
       LIMIT 1`,
        MAX_REWATCH_FRAME_BYTES,
      )
      .toArray();

    const recent = sql
      .exec<RewatchSqlRow>(
        `SELECT frame_index, at, label, state_json
       FROM rewatch_frames
       WHERE length(CAST(state_json AS BLOB)) <= ?
       ORDER BY frame_index DESC
       LIMIT ?`,
        MAX_REWATCH_FRAME_BYTES,
        MAX_REWATCH_FRAMES - 1,
      )
      .toArray();

    const unique = new Map<number, RewatchSqlRow>();

    for (const row of [...first, ...recent]) {
      if (utf8ByteLength(row.state_json) <= MAX_REWATCH_FRAME_BYTES) {
        unique.set(row.frame_index, row);
      }
    }

    const rows = [...unique.values()].sort((a, b) => a.frame_index - b.frame_index);

    const boundedRows =
      rows.length <= MAX_REWATCH_FRAMES
        ? rows
        : [rows[0]!, ...rows.slice(-(MAX_REWATCH_FRAMES - 1))];

    return this.fitRewatchPayload(
      boundedRows.map((row) => ({
        index: row.frame_index,
        at: row.at,
        label: row.label,
        state: parseUnknownJson(row.state_json),
      })),
    );
  }

  private fitRewatchPayload(frames: RewatchFrame[]): RewatchFrame[] {
    if (frames.length === 0) return [];
    const sorted = frames.sort((a, b) => a.index - b.index);
    const first = sorted[0]!;
    const newestFirst = sorted.slice(1).reverse();
    const selected: RewatchFrame[] = [];
    let bytes = 0;

    for (const frame of [first, ...newestFirst]) {
      const frameBytes =
        utf8ByteLength(JSON.stringify(frame.state)) + utf8ByteLength(frame.label) + 64;

      if (frameBytes > MAX_REWATCH_FRAME_BYTES) continue;

      if (bytes + frameBytes > MAX_REWATCH_PAYLOAD_BYTES) continue;
      selected.push(frame);
      bytes += frameBytes;
    }

    return selected.sort((a, b) => a.index - b.index);
  }

  protected recordEvent<T>(type: string, summary?: T): void {
    // Cleanup nulls gameState before returning so a caller cannot recreate the
    // private activity log after storage.deleteAll().
    if (!this.gameState) return;
    this.initializeHistoryTables();

    if (type === "game_ended") {
      this.initializeFinalDeliveryRecipients();
    }

    this.eventSeq += 1;

    const event: GameEventRecord = {
      seq: this.eventSeq,
      at: Date.now(),
      type,
      summary:
        summary === undefined
          ? undefined
          : wireValueSchema.parse(JSON.parse(JSON.stringify(summary))),
    };

    let rewatchFrame: RewatchFrame | null = null;

    if (
      type === "game_started" ||
      type === "action" ||
      type === "game_ended" ||
      type === "turn_timeout" ||
      type === "placement_timeout"
    ) {
      const actionType = this.asProjectionPart(summary)?.actionType;
      rewatchFrame = this.captureRewatchFrame(isString(actionType) ? actionType : type);
    }

    try {
      const persist = () => {
        this.insertEventRow(event);

        if (rewatchFrame) this.insertRewatchRow(rewatchFrame);
      };

      const transactionSync = this.state.storage.transactionSync;

      if (this.historySql() && isFunction(transactionSync)) {
        transactionSync.call(this.state.storage, persist);
      } else {
        persist();
      }
    } catch (error) {
      // An audit write must not turn an already-applied game action into a
      // misleading HTTP failure that a client may retry.
      console.error(`${this.roomLabel}: history write failed`, error);
    }

    this.resolveTurnWaiters();
  }

  /** Full-reveal replay projection. Fogged games override before sanitization. */
  protected buildRewatchView(): object | null {
    if (!this.gameState) return null;

    const rules = this.gameRules();

    if (rules?.rewatchView) return rules.rewatchView(this.gameState);

    return this.gameState;
  }

  /**
   * Remove room/auth metadata and force a shared read-only replay seat.
   * Game overrides pass a fully revealed browser-compatible view through here.
   */
  protected finalizeRewatchView<T>(view: T) {
    const source = this.asProjectionPart(view);

    if (!source || !this.gameState) return null;
    const clean = structuredClone(source);
    delete clean.id;
    delete clean.roomCode;
    delete clean.hostId;
    delete clean.createdAt;
    delete clean.updatedAt;
    delete clean.expiresAt;
    delete clean.spectators;
    delete clean.spectatorCount;

    if (Array.isArray(clean.players)) {
      clean.players = clean.players.map((entry) => {
        const player = this.asProjectionPart(entry);

        if (!player) return entry;
        const member = this.gameState?.players.find((member) => member.id === player.id);
        const agent = member?.isAgent || member?.channel === "mcp";

        const identity = { id: player.id, name: player.name };

        if (agent)
          Object.assign(identity, {
            isAgent: true,
            codename: member?.codename,
            ownerGamertag: member?.ownerGamertag,
            environmentLabel: member?.environmentLabel,
          });

        return this.definedAgentFields(identity);
      });
    }

    const perspective = this.compactAgentYou(this.buildYouContext(this.gameState.hostId));

    clean.replayPerspectivePlayerId = perspective.playerId;
    clean.you = {
      isHost: false,
      isYourTurn: false,
      isSpectator: false,
      phase: this.gameState.turnState.phase,
      status: this.gameState.status,
      legalActions: [],
    };

    return clean;
  }

  private captureRewatchFrame(label: string): RewatchFrame | null {
    if (!this.gameState) return null;
    const projected = this.finalizeRewatchView(this.buildRewatchView());

    if (!projected) return null;
    const serialized = JSON.stringify(projected);

    if (serialized === this.lastRewatchSerialized) return null;
    this.lastRewatchSerialized = serialized;
    const index = this.rewatchFrameSeq;
    this.rewatchFrameSeq += 1;

    if (utf8ByteLength(serialized) > MAX_REWATCH_FRAME_BYTES) return null;

    const frame: RewatchFrame = {
      index,
      at: Date.now(),
      label,
      state: parseUnknownJson(serialized),
    };

    return frame;
  }

  private buildRewatchPayload(): RewatchPayload {
    if (this.gameState?.status === "ended") {
      const finalFrame = this.captureRewatchFrame("game_ended");

      if (finalFrame) this.insertRewatchRow(finalFrame);
    }

    const frames = this.readRewatchRows();

    return {
      version: 1,
      visibility: "full_reveal",
      gameType: this.gameState?.type ?? "unknown",
      truncated: this.rewatchFrameSeq > frames.length,
      frames,
    };
  }

  private buildWaitResult(
    playerId: string,
    timedOut: boolean,
    reason: WaitForTurnResult["reason"],
  ): WaitForTurnResult {
    if (timedOut) {
      return { timedOut: true, reason, revision: this.eventSeq };
    }

    return {
      timedOut,
      reason,
      revision: this.eventSeq,
      state: this.gameState ? compactAgentDecisionState(this.buildAgentView(playerId)) : null,
    };
  }

  /**
   * Whether `playerId` may act now (drives wait_for_turn).
   * Override for concurrent phases (e.g. Battleship placement).
   */
  protected isYourTurn(playerId: string): boolean {
    if (!this.gameState) return false;

    if (this.gameState.status === "ended") return false;

    if (this.gameState.status !== "playing") return false;

    const rules = this.gameRules();

    if (rules?.mayActNow) return rules.mayActNow(this.gameState, playerId);

    return this.gameState.turnState.currentPlayerId === playerId;
  }

  private resolveTurnWaiters(): void {
    if (this.turnWaiters.length === 0) return;
    const stillWaiting: TurnWaiter[] = [];

    for (const w of this.turnWaiters) {
      if (!this.gameState) {
        clearTimeout(w.timer);
        w.resolve(this.buildWaitResult(w.playerId, false, "ended"));
        continue;
      }

      if (this.gameState.status === "ended") {
        clearTimeout(w.timer);
        w.resolve(this.buildWaitResult(w.playerId, false, "ended"));
        continue;
      }

      if (this.isSpectator(w.playerId)) {
        clearTimeout(w.timer);
        w.resolve(this.buildWaitResult(w.playerId, false, "waiting"));
        continue;
      }

      if (this.isAgentTurnReady(w.playerId)) {
        clearTimeout(w.timer);
        w.resolve(this.buildWaitResult(w.playerId, false, "your_turn"));
        continue;
      }

      stillWaiting.push(w);
    }

    this.turnWaiters = stillWaiting;
  }

  private waitForTurnInternal(playerId: string, timeoutMs: number): Promise<WaitForTurnResult> {
    if (!this.gameState) {
      return Promise.resolve(this.buildWaitResult(playerId, false, "ended"));
    }

    if (this.gameState.status === "ended") {
      return Promise.resolve(this.buildWaitResult(playerId, false, "ended"));
    }

    if (this.isAgentTurnReady(playerId)) {
      return Promise.resolve(this.buildWaitResult(playerId, false, "your_turn"));
    }

    return new Promise((resolve) => {
      const readyIn = Math.max(0, this.agentDecisionReadyAt() - Date.now());

      const timer = setTimeout(
        () => {
          this.turnWaiters = this.turnWaiters.filter((w) => w.resolve !== resolve);
          const canAct = this.isAgentTurnReady(playerId);
          resolve(this.buildWaitResult(playerId, !canAct, canAct ? "your_turn" : "timeout"));
        },
        readyIn > 0 ? Math.min(timeoutMs, readyIn) : timeoutMs,
      );

      this.turnWaiters.push({
        playerId,
        resolve,
        timer,
      });
    });
  }

  // ─── Room creation / joining ───────────────────────────────────

  /**
   * Handles `POST /create` — creates a new game room with the provided configuration.
   * Generates a room code if one is not supplied, then delegates to {@link createDefaultState}.
   *
   * @param {Request} request - The request body must be a JSON object with at least
   *   `hostId` and `hostName`. Optional fields include `maxPlayers`, `gameTotalTime`,
   *   `turnTime`, and `roomCode`.
   * @returns {Promise<Response>} JSON with a creation message and redirect path, or a 400 error.
   */
  private async handleCreateRoom(request: Request): Promise<Response> {
    try {
      if (this.gameState) {
        return this.jsonResponse({ error: "Room code already exists" }, 409);
      }

      const config = parseRoomCreationConfig(await request.json());

      if (!config) {
        return this.jsonResponse({ error: "Invalid room identity" }, 400);
      }

      const roomCode = config.roomCode || generateRoomCode();
      this.gameState = this.createDefaultState(config, roomCode);
      await this.saveCreatedStateAndScheduleExpiry(this.gameState.createdAt);

      return new Response(
        JSON.stringify({
          message: `${this.roomLabel} room created`,
          redirectTo: `/ws/games/`,
          expiresAt: this.gameState.expiresAt,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  /**
   * Handles `POST /join` — validates the join request body and instructs the client
   * to connect via WebSocket instead.
   *
   * @param {Request} request - The join request (body is parsed but currently unused).
   * @returns {Promise<Response>} JSON redirect hint pointing to the WebSocket endpoint,
   *   or a 400 error on invalid JSON.
   */
  private async handleJoinRoom(request: Request): Promise<Response> {
    try {
      await request.json();

      return new Response(
        JSON.stringify({
          message: "Join via WebSocket",
          redirectTo: `/ws/games/`,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  /**
   * Subclasses must implement this to produce the initial game state
   * when a room is created (via POST /create or first WS connection).
   *
   * @param config - Room configuration object containing at least `hostId` and `hostName`.
   *   Game-specific subclasses may read additional fields via the index signature.
   * @param {string} roomCode - The room code assigned to this game session.
   * @returns {TState} The freshly-initialised game state.
   */
  protected abstract createDefaultState(config: GameRoomConfig, roomCode: string): TState;

  /**
   * Called when a WS connection arrives and no game state exists yet.
   * Delegates to `createDefaultState` with sensible defaults.
   *
   * @param {string} userId   - The connecting user's ID (becomes the host).
   * @param {string} userName - The connecting user's display name.
   * @param {string} roomCode - The room code for the new session.
   * @returns {TState} A freshly-created game state for this room.
   */
  protected createDefaultStateForWS(userId: string, userName: string, roomCode: string): TState {
    return this.createDefaultState({ hostId: userId, hostName: userName, roomCode }, roomCode);
  }

  // ─── WebSocket lifecycle ───────────────────────────────────────

  /**
   * True when this user is watching only (not in the seated players list).
   * MCP agent seats never spectate via this path — they must claim a seat.
   */
  protected isSpectator(playerId: string): boolean {
    if (!this.gameState) return false;

    if (this.gameState.players.some((p) => p.id === playerId)) return false;

    return (this.gameState.spectators ?? []).some((s) => s.id === playerId);
  }

  /** True for either a playing seat or a watch-only room member. */
  private isRoomMember(playerId: string): boolean {
    if (!this.gameState) return false;

    return (
      this.gameState.players.some((p) => p.id === playerId) ||
      (this.gameState.spectators ?? []).some((p) => p.id === playerId)
    );
  }

  /** Ensure spectators array exists on loaded/legacy state. */
  protected ensureSpectators(): BasePlayerInfo[] {
    if (!this.gameState) return [];

    if (!Array.isArray(this.gameState.spectators)) {
      this.gameState.spectators = [];
    }

    return this.gameState.spectators;
  }

  /**
   * Room is joinable as a seated player only while waiting and under capacity.
   * Otherwise browser clients may connect as spectators.
   */
  protected canJoinAsPlayer(): boolean {
    if (!this.gameState) return true;

    return (
      this.gameState.status === "waiting" &&
      this.gameState.players.length < this.gameState.maxPlayers
    );
  }

  /**
   * Upgrades an HTTP request to a WebSocket connection and registers the player.
   *
   * Validates the `x-user-id` / `x-user-name` headers, enforces room code matching,
   * checks capacity and game status, then:
   * - Reconnects an existing player if their ID is already in the game.
   * - Reconnects an existing spectator if their ID is on the watch list.
   * - Adds a new player if the room is still in the `waiting` status and has seats.
   * - Adds a spectator when the room is full or the game has already started.
   * - Rejects the upgrade if the room was not created through the room API.
   *
   * Broadcasts `player_reconnected`, `player_joined`, `spectator_joined`, or `state`
   * events as appropriate, and sends a `connected` message directly to the new socket.
   *
   * @param {Request} request - The original HTTP upgrade request.
   * @param {URL}     url     - The parsed request URL (used for `roomCode` query param).
   * @returns {Response} A 101 Switching Protocols response with the client-side socket,
   *   or a 4xx error response if the upgrade is rejected.
   */
  private async handleWebSocketUpgrade(request: Request, url: URL): Promise<Response> {
    const userId = request.headers.get("x-user-id");
    const rawUserName = request.headers.get("x-user-name") || "Anonymous";
    const channelHeader = request.headers.get("x-seat-channel");

    const channel: SeatChannel = channelHeader === "mcp" ? "mcp" : "browser";

    const isAgentSeat = channel === "mcp";
    const roomCode = url.searchParams.get("roomCode");

    if (
      !userId ||
      !rawUserName ||
      userId.length > 128 ||
      rawUserName.length > 200 ||
      !roomCode ||
      !/^[A-HJ-NP-Z2-9]{6}$/.test(roomCode)
    ) {
      return new Response("Missing user info", { status: 400 });
    }

    if (roomCode && this.gameState && this.gameState.roomCode !== roomCode) {
      return new Response("Room code mismatch", { status: 403 });
    }

    if (!this.gameState) {
      // Room codes are globally reserved before a game Durable Object is
      // created. A WebSocket must never create an unregistered side-door room.
      return new Response("Room not found", { status: 404 });
    }

    // Rebuild from hibernated sockets before capacity / reconnect checks.
    this.restoreSessions();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (!client || !server) {
      return new Response("Failed to create WebSocket pair", { status: 500 });
    }

    let player: Player;
    let isReconnect = false;
    let joinedAsSpectator = false;
    const joinedAt = Date.now();

    const assignDisplayName = (preferred: string, excludeUserId?: string) => {
      if (!isAgentSeat) {
        return { name: preferred };
      }

      const taken = [
        ...(this.gameState?.players ?? []),
        ...(this.gameState?.spectators ?? []),
      ].flatMap((player) => (player.id !== excludeUserId ? [player.name] : []));

      // Defensive legacy path: MCP WebSocket seats always receive a fresh
      // server-generated codename; the presented name is deliberately ignored.
      const name = generateUniqueCodename(taken);

      return { name, codename: name };
    };

    if (this.gameState) {
      const existingPlayer = this.gameState.players.find((p) => p.id === userId);

      const spectators = this.ensureSpectators();
      const existingSpectator = spectators.find((s) => s.id === userId);

      if (existingPlayer) {
        isReconnect = true;
        // Drop prior sockets for this seat so broadcasts don't fan out twice.
        this.closeSessionsForUser(userId);

        // Keep established codename / channel on reconnect
        if (isAgentSeat && !existingPlayer.codename) {
          const assigned = assignDisplayName(rawUserName, userId);
          existingPlayer.name = assigned.name;
          existingPlayer.codename = assigned.codename;
          existingPlayer.channel = channel;
          existingPlayer.isAgent = true;
        }

        player = {
          id: userId,
          name: existingPlayer.name,
          socket: server,
          isConnected: true,
          joinedAt,
          isAgent: existingPlayer.isAgent,
          channel: existingPlayer.channel ?? channel,
          codename: existingPlayer.codename,
          ownerGamertag: existingPlayer.ownerGamertag,
          environmentLabel: existingPlayer.environmentLabel,
          isSpectator: false,
        };
      } else if (existingSpectator) {
        isReconnect = true;
        joinedAsSpectator = true;
        this.closeSessionsForUser(userId);
        player = {
          id: userId,
          name: existingSpectator.name,
          socket: server,
          isConnected: true,
          joinedAt,
          isAgent: existingSpectator.isAgent,
          channel: existingSpectator.channel ?? channel,
          codename: existingSpectator.codename,
          ownerGamertag: existingSpectator.ownerGamertag,
          environmentLabel: existingSpectator.environmentLabel,
          isSpectator: true,
        };
      } else if (this.canJoinAsPlayer()) {
        // Open seat while waiting — seat as a player
        const assigned = assignDisplayName(rawUserName);
        this.gameState.players.push({
          id: userId,
          name: assigned.name,
          channel,
          isAgent: isAgentSeat,
          codename: assigned.codename,
        });
        player = {
          id: userId,
          name: assigned.name,
          socket: server,
          isConnected: true,
          joinedAt,
          channel,
          isAgent: isAgentSeat,
          codename: assigned.codename,
          isSpectator: false,
        };
      } else {
        // Room full or game already started → spectator (browser only).
        // MCP agents still need a real seat and cannot watch-only this way.
        if (this.gameState.status === "ended") {
          return new Response("Game ended", { status: 410 });
        }

        if (isAgentSeat) {
          if (this.gameState.players.length >= this.gameState.maxPlayers) {
            return new Response("Room is full", { status: 403 });
          }

          return new Response("Game already started", { status: 403 });
        }

        if (spectators.length >= MAX_SPECTATORS) {
          return new Response("Spectator limit reached", { status: 403 });
        }

        const assigned = assignDisplayName(rawUserName);
        joinedAsSpectator = true;
        spectators.push({
          id: userId,
          name: assigned.name,
          channel,
          isAgent: false,
          codename: assigned.codename,
        });
        player = {
          id: userId,
          name: assigned.name,
          socket: server,
          isConnected: true,
          joinedAt,
          channel,
          isAgent: false,
          codename: assigned.codename,
          isSpectator: true,
        };
      }
    } else {
      return new Response("Room not found", { status: 404 });
    }

    // Hibernation API: attachment survives DO sleep; in-memory Map does not.
    this.state.acceptWebSocket?.(server);

    const attachment: WsSessionAttachment = {
      id: userId,
      name: player.name,
      joinedAt,
      isSpectator: player.isSpectator === true,
    };

    server.serializeAttachment(attachment);
    this.sessions.set(server, player);
    const reconnectingToEndedRoom = this.gameState.status === "ended";

    if (!reconnectingToEndedRoom) {
      await this.saveState();

      if (isReconnect) {
        await this.scheduleNextRoomAlarm();
      } else {
        await this.markMeaningfulActivity(joinedAt);
      }
    }

    if (isReconnect) {
      if (player.isSpectator) {
        this.broadcast({
          type: "spectator_reconnected",
          payload: {
            userId,
            name: player.name,
            codename: player.codename,
            ownerGamertag: player.ownerGamertag,
            environmentLabel: player.environmentLabel,
            channel: player.channel,
            isSpectator: true,
          },
        });
      } else {
        this.broadcast({
          type: "player_reconnected",
          payload: {
            userId,
            name: player.name,
            codename: player.codename,
            ownerGamertag: player.ownerGamertag,
            environmentLabel: player.environmentLabel,
            channel: player.channel,
          },
        });
      }

      // Host/peers need fresh player list + legalActions after a seat returns.
      this.broadcastState();
    } else if (joinedAsSpectator) {
      this.broadcast({
        type: "spectator_joined",
        payload: {
          userId: player.id,
          name: player.name,
          roomCode: this.gameState?.roomCode,
        },
      });
      this.broadcastState();
    } else {
      this.broadcast({
        type: "player_joined",
        payload: {
          userId: player.id,
          name: player.name,
          codename: player.codename,
          ownerGamertag: player.ownerGamertag,
          environmentLabel: player.environmentLabel,
          channel: player.channel,
          isAgent: player.isAgent,
          roomCode: this.gameState?.roomCode,
        },
      });
      this.broadcastState();
    }

    this.sendTo(server, {
      type: "connected",
      payload: {
        roomCode: this.gameState?.roomCode,
        state: this.buildClientView(userId),
        isHost: this.gameState?.hostId === userId,
        isSpectator: player.isSpectator === true,
      },
    });

    if (reconnectingToEndedRoom) {
      this.initializeFinalDeliveryRecipients();
      this.pendingAgentFinalAcks?.delete(player.id);
      this.pendingRewatchAcks?.add(server);
      const reason = this.archiveEndReason(this.readEventRows(), "ended");
      this.sendTo(server, {
        type: "game_ended",
        payload: {
          finalState: this.buildClientView(player.id),
          reason,
          rewatch: this.buildRewatchPayload(),
        },
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Cloudflare DO lifecycle hook — called whenever a WebSocket message arrives.
   * Parses the message as a {@link ClientMessage} and dispatches to the correct handler:
   * - `action`     → {@link dispatchAction}
   * - `leave`      → {@link handlePlayerLeave}
   * - `start_game` → {@link startGame} (host only)
   * - `timer_sync` → replies with current timer values directly to the sender
   *
   * @param {WebSocket}        ws      - The socket that sent the message.
   * @param {string | ArrayBuffer} message - The raw message payload.
   * @returns {Promise<void>}
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (this.broadcastAttachment(ws)) {
      ws.close(1008, "Read-only broadcast");

      return;
    }

    this.restoreSessions();
    const player = this.sessions.get(ws);

    if (!player) return;

    let requestId: string | undefined;
    let holdsTerminalResponse = false;

    try {
      if (!isString(message) || utf8ByteLength(message) > 64 * 1024) {
        throw new Error("Invalid message size");
      }

      const raw = wireValueSchema.parse(JSON.parse(message));
      const rawRequestId = isObjectValue(raw) ? objectValue(raw, "requestId") : undefined;

      if (isString(rawRequestId) && rawRequestId.length > 0 && rawRequestId.length <= 64)
        requestId = rawRequestId;
      const msg = parseClientMessage(raw);

      if (!msg) throw new Error("Invalid client message");

      switch (msg.type) {
        case "action":
        case "start_game": {
          if (requestId) {
            this.terminalResponseHolds += 1;
            holdsTerminalResponse = true;
          }

          const payload =
            msg.type === "action" ? msg.payload : { actionType: "start_game", data: {} };

          const fingerprint = actionFingerprint(payload.actionType, payload.data);
          const replay = this.replayAckedAction(player.id, requestId, fingerprint);

          if (replay && requestId && "conflict" in replay) {
            this.sendTo(ws, {
              type: "action_result",
              payload: {
                requestId,
                ok: false,
                code: "IDEMPOTENCY_CONFLICT",
                message:
                  "This requestId was already used for a different action. Use a new id for a new intent.",
              },
            });

            break;
          }

          if (replay && requestId && "acked" in replay) {
            const acked = replay.acked;

            this.sendTo(ws, {
              type: "action_result",
              payload: {
                requestId,
                ok: acked.ok,
                replayed: true,
                ...(acked.ok
                  ? {
                      state: this.buildClientView(player.id),
                      acceptedRevision: acked.acceptedRevision,
                    }
                  : { message: acked.message }),
              },
            });

            break;
          }

          const error = await this.dispatchAction(
            player,
            payload,
            false,
            requestId ? { playerId: player.id, requestId, fingerprint } : undefined,
          );

          if (error && requestId)
            await this.persistRejection(
              { playerId: player.id, requestId, fingerprint },
              error.message,
            );

          if (requestId) {
            this.sendTo(ws, {
              type: "action_result",
              payload: {
                requestId,
                ok: !error,
                ...(error
                  ? { message: error.message }
                  : { state: this.buildClientView(player.id), acceptedRevision: this.eventSeq }),
              },
            });
          } else if (error) {
            this.sendError(player, error.message, error.code);
          }

          break;
        }

        case "leave":
          this.handlePlayerLeave(player, ws);
          break;
        case "rewatch_saved":
          if (this.gameState?.status === "ended") {
            this.pendingRewatchAcks?.delete(ws);
            this.maybeCleanupAfterFinalDelivery("Final state saved");
          }

          break;
        case "timer_sync":
          ws.send(
            JSON.stringify({
              type: "state",
              payload: this.buildClientView(player.id),
            }),
          );
          break;
      }
    } catch (error) {
      console.error("WebSocket message error:", error);
      this.sendTo(
        ws,
        requestId
          ? {
              type: "action_result",
              payload: {
                requestId,
                ok: false,
                message: "The server could not complete this action.",
              },
            }
          : { type: "error", payload: { message: "Invalid message format", code: "INVALID_MESSAGE" } },
      );
    } finally {
      if (holdsTerminalResponse) {
        this.terminalResponseHolds = Math.max(0, this.terminalResponseHolds - 1);
        this.maybeCleanupAfterFinalDelivery("Action result delivered");
      }
    }
  }

  /**
   * Cloudflare DO lifecycle hook — called when a WebSocket connection is closed.
   * Marks the player as disconnected and broadcasts a `player_disconnected` event.
   *
   * @param {WebSocket} ws - The socket that was closed.
   * @returns {Promise<void>}
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleSocketDisconnect(ws);
  }

  /**
   * Cloudflare DO lifecycle hook — called when a WebSocket error occurs.
   * Logs the error and marks the socket disconnected. A transport failure is
   * not a voluntary leave: the seat remains available for reconnection.
   *
   * @param {WebSocket} ws      - The socket that encountered an error.
   * @param {unknown}   error   - The error object or message.
   * @returns {Promise<void>}
   */
  async webSocketError<T>(ws: WebSocket, error: T): Promise<void> {
    void error;
    console.error("WebSocket connection error");
    await this.handleSocketDisconnect(ws);
  }

  private async handleSocketDisconnect(ws: WebSocket): Promise<void> {
    this.pendingRewatchAcks?.delete(ws);

    if (this.gameState?.status === "ended") {
      this.maybeCleanupAfterFinalDelivery("Final-state connections closed");

      if (this.finalDeliveryComplete()) return;
    }

    const knownPlayer = this.sessions.get(ws);
    this.restoreSessions();
    const player = this.sessions.get(ws) ?? knownPlayer;

    if (player) {
      player.isConnected = false;
      this.sessions.delete(ws);
      this.broadcast({
        type: player.isSpectator ? "spectator_disconnected" : "player_disconnected",
        payload: { userId: player.id, name: player.name },
      });
    }
  }

  // ─── Action dispatch ───────────────────────────────────────────

  /**
   * Resolve a previously acknowledged request. A retried request must replay its
   * original outcome: re-dispatching could apply a legal-looking intent twice.
   */
  /**
   * Resolve a previously acknowledged request. `{ conflict: true }` means the id
   * was reused for a different intent, which must never replay another move.
   */
  private replayAckedAction(
    playerId: string,
    requestId: string | undefined,
    fingerprint: string,
  ): { acked: AckedActionResult } | { conflict: true } | undefined {
    if (!requestId) return undefined;

    const key = `${playerId}:${requestId}`;
    const acked = this.ackedActions.get(key);

    if (!acked) return undefined;

    if (acked.at + ACTION_RESULT_TTL_MS <= Date.now()) {
      this.ackedActions.delete(key);

      return undefined;
    }

    return acked.fingerprint === fingerprint ? { acked } : { conflict: true };
  }

  /**
   * Record an outcome and persist it with the game state. A single `put` keeps
   * the state and its acknowledgements atomic, so a restarted instance can still
   * recognise a retried request instead of applying it twice.
   */
  /**
   * Record an outcome in memory. The next `saveState()` writes it together with
   * the game state, which is what makes a retry safe across a restart.
   */
  private rememberAckedAction(ack: AckRequest | undefined, result: {
    ok: boolean;
    message?: string;
    acceptedRevision: number;
  }): void {
    if (!ack) return;

    const key = `${ack.playerId}:${ack.requestId}`;
    this.ackedActions.delete(key);
    this.ackedActions.set(key, {
      playerId: ack.playerId,
      requestId: ack.requestId,
      fingerprint: ack.fingerprint,
      ...result,
      at: Date.now(),
    });

    while (this.ackedActions.size > ACTION_RESULT_MEMORY) {
      const oldest = this.ackedActions.keys().next();

      if (oldest.done) break;
      this.ackedActions.delete(oldest.value);
    }
  }

  /**
   * Persist a rejection receipt. Rejected actions do not change state, so this
   * needs no atomic pairing with `gameState`.
   */
  /**
   * Persist a state change together with its receipt. When the single write
   * fails nothing reached storage, so the in-memory state is rolled back and the
   * caller sees an error it may safely retry.
   */
  private async saveAppliedAction(actionType: string): Promise<boolean> {
    try {
      await this.saveState();

      return true;
    } catch (error) {
      console.error(`${this.roomLabel}: action write failed`, error);
      logEvent("action_write_failed", { actionType, roomType: this.gameState?.type });

      try {
        this.gameState = (await this.state.storage.get<TState>("gameState")) ?? null;
        await this.restoreAckedActions();
      } catch (rollbackError) {
        // Storage is unreadable too; report the failure and let the platform
        // recreate this room from its last durable snapshot.
        console.error(`${this.roomLabel}: action rollback failed`, rollbackError);
        logEvent("action_rollback_failed", { actionType });
      }

      // The rule effects that produced a pending end belonged to the write that
      // just failed, and the rollback undid them, so the announcement goes too.
      // The match may still be running; inheriting the marker would broadcast a
      // `game_ended` for a result that never happened.
      this.pendingMatchEnd = null;
      this.rearmTimersAfterRollback();

      return false;
    }
  }

  /**
   * Resume the clock after a rolled-back write.
   *
   * A rule module that finishes a match stops the timers before the platform
   * writes, so a failed write leaves them stopped while the restored state says
   * `playing`. Re-anchor on the durable write instead of on `now`, which keeps
   * the durable countdown and the projected clock measuring from the same
   * instant instead of drifting apart by the outage.
   */
  private rearmTimersAfterRollback(): void {
    if (!this.gameState || this.gameState.status !== "playing") return;

    this.lastGameTimerTickAt = this.gameState.updatedAt;
    this.lastTurnTimerTickAt = this.gameState.updatedAt;
    this.timerTurnStartedAt = this.gameState.turnState.startedAt;
  }

  private async persistRejection(ack: AckRequest | undefined, message: string): Promise<void> {
    if (!ack) return;

    this.rememberAckedAction(ack, {
      ok: false,
      message,
      acceptedRevision: this.eventSeq,
    });

    try {
      await this.persistAckedActions();
    } catch (error) {
      // Reporting failure would invite a retry of a request that was already
      // answered; keep the in-memory record and move on.
      console.error(`${this.roomLabel}: idempotency record failed`, error);
      logEvent("idempotency_record_failed", { roomType: this.gameState?.type });
    }
  }

  /** Restore durable acknowledgements after an instance restart. */
  private async restoreAckedActions(): Promise<void> {
    const stored = (await this.state.storage.get<AckedActionResult[]>(ACKED_ACTION_KEY)) ?? [];
    const now = Date.now();

    this.ackedActions.clear();

    for (const record of stored.slice(-ACTION_RESULT_MEMORY)) {
      if (record.at + ACTION_RESULT_TTL_MS <= now) continue;
      this.ackedActions.set(`${record.playerId}:${record.requestId}`, record);
    }
  }

  private async persistAckedActions(): Promise<void> {
    if (!this.gameState) return;

    await this.state.storage.put({
      gameState: this.gameState,
      [ACKED_ACTION_KEY]: [...this.ackedActions.values()],
      [DIRECTORY_PENDING_KEY]: this.directoryExpiryPending,
    });
  }

  /**
   * Routes an incoming `action` message to either {@link handleSharedAction}
   * (for cross-game actions like end/kick) or {@link handleGameAction}
   * (for game-specific logic implemented by the subclass).
   * After the action is handled, the game state timestamp is updated, persisted,
   * and the full state is broadcast to all connected clients.
   *
   * @param {Player} player  - The player who sent the action.
   * @param {{ actionType: string; data: WireValue }} payload - The action type and its data.
   * @returns {Promise<void>}
   */
  /**
   * @returns Error message if the action was rejected; undefined on success.
   */
  private async dispatchAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
    sendErrors = true,
    ack?: AckRequest,
  ): Promise<ActionRejection | void> {
    if (
      payload.actionType.length > 64 ||
      !/^[a-z][a-z0-9_]*$/.test(payload.actionType) ||
      utf8ByteLength(JSON.stringify(payload.data ?? {})) > 32 * 1024
    ) {
      return classifyActionError("Invalid or oversized action", payload.actionType);
    }

    if (!this.gameState) {
      return classifyActionError("No game state", payload.actionType);
    }

    if (!this.isRoomMember(player.id)) {
      return classifyActionError("Player or spectator not in room", payload.actionType);
    }

    const actionReceivedAt = Date.now();
    this.syncRunningTimers(actionReceivedAt);

    if (await this.settleExpiredTimers(actionReceivedAt)) {
      return classifyActionError("Action arrived after timer expired", payload.actionType);
    }

    // Clients never push game state; server is sole authority
    if (payload.actionType === "update_data") {
      return classifyActionError(
        "update_data is rejected; send legal intents only",
        payload.actionType,
      );
    }

    if (payload.actionType === "leave") {
      await this.leaveMember(player.id, player.name);

      return;
    }

    // Ordinary spectators may only leave. Codenames spectators may claim an
    // open seat by choosing their own team role. A spectator-host remains the
    // room administrator and may use host controls in every private game.
    const isHostSpectator = this.gameState.hostId === player.id && this.isSpectator(player.id);

    const isCodenamesRoleJoin =
      this.gameState.type === "codenames" &&
      this.gameState.status === "waiting" &&
      payload.actionType === "assign_codenames_role";

    if (
      !isHostSpectator &&
      !isCodenamesRoleJoin &&
      (player.isSpectator || this.isSpectator(player.id))
    ) {
      const rejection = classifyActionError("Spectators cannot act", payload.actionType);

      if (sendErrors) this.sendError(player, "Spectators cannot act — watch only", rejection.code);

      return rejection;
    }

    // Handle shared actions first
    const handled = await this.handleSharedAction(player, payload);

    if (isString(handled)) {
      const rejection = classifyActionError(handled, payload.actionType);

      if (sendErrors) this.sendError(player, handled, rejection.code);

      return rejection;
    }

    if (handled) {
      // The shared handler already saved any state change; this second write is
      // what pairs the final state with its receipt.
      this.rememberAckedAction(ack, { ok: true, acceptedRevision: this.eventSeq + 1 });

      if (!(await this.saveAppliedAction(payload.actionType)))
        return internalActionError(payload.actionType);

      await this.markMeaningfulActivity();
      this.recordEvent("action", {
        actionType: payload.actionType,
        playerId: player.id,
      });
      this.resolveTurnWaiters();

      return;
    }

    // Delegate to subclass for game-specific actions
    const series = this.gameState.series;

    const previousMetric = series?.metrics[player.id]
      ? structuredClone(series.metrics[player.id])
      : undefined;

    if (
      series &&
      this.gameState.status === "playing" &&
      this.isYourTurn(player.id) &&
      payload.actionType !== "next_hand"
    ) {
      const metric = series.metrics[player.id] ?? { actions: 0, decisionMs: 0, timeouts: 0 };
      const sameTurn = metric.turnNumber === this.gameState.turnState.turnNumber;

      const since =
        this.gameState.type === "contexto"
          ? (metric.lastActionAt ?? this.gameState.turnState.startedAt)
          : Math.max(this.gameState.turnState.startedAt, sameTurn ? (metric.lastActionAt ?? 0) : 0);

      series.metrics[player.id] = {
        ...metric,
        actions: metric.actions + 1,
        decisionMs: metric.decisionMs + Math.max(0, actionReceivedAt - since),
        lastActionAt: actionReceivedAt,
        turnNumber: this.gameState.turnState.turnNumber,
      };
    }

    const error = await this.handleGameAction(player, payload);

    if (error) {
      if (series) {
        if (previousMetric) series.metrics[player.id] = previousMetric;
        else delete series.metrics[player.id];
      }

      const rejection = classifyActionError(error, payload.actionType);

      if (sendErrors) this.sendError(player, error, rejection.code);

      return rejection;
    }

    this.gameState.updatedAt = Date.now();
    // Receipt first, then the single write that holds both: a crash cannot leave
    // an applied move without the record that makes its retry a replay. The
    // action event is recorded right after this save, so its seq is the revision
    // the original caller reports.
    this.rememberAckedAction(ack, { ok: true, acceptedRevision: this.eventSeq + 1 });

    if (!(await this.saveAppliedAction(payload.actionType)))
      return internalActionError(payload.actionType);

    await this.markMeaningfulActivity();
    this.broadcastState();
    this.recordEvent("action", {
      actionType: payload.actionType,
      playerId: player.id,
    });
    this.resolveTurnWaiters();
    // The finished state and its receipt are on disk now, so the terminal
    // projection describes something a restart can still reproduce.
    this.deliverPendingMatchEnd();
  }

  /**
   * Send an error message to a single player (by Player object).
   *
   * @param {Player}          player  - The recipient.
   * @param {string}          message - English sentence for MCP clients and logs.
   * @param {RoomErrorCode}   [code]  - Localizable code; omit when the wording is
   *                                    game-specific and has no stable category.
   */
  protected sendError(player: Player, message: string, code?: RoomErrorCode): void {
    const payload: RoomErrorPayload = { message };

    if (code) payload.code = code;

    for (const [ws, p] of this.sessions) {
      if (p.id === player.id && ws.readyState === WebSocket.OPEN) {
        this.sendTo(ws, { type: "error", payload });
      }
    }
  }

  /**
   * Processes actions that are shared across all game types.
   *
   * Handled action types:
   * - `start_game`   — starts the game (host only)
   * - `kick_player`  — removes a player from the room (host only)
   * - `move_player_to_spectator` — moves a seat, including the host's, to the watch list (host only, lobby only)
   * - `set_host_spectating` — lets the host organize without occupying a player seat
   * - `set_player_seats` — atomically assigns player/spectator roles (host only, lobby only)
   * - `end_game`     — ends the game immediately (host only)
   *
   * @param {Player} player  - The player who sent the action.
   * @param {{ actionType: string; data: WireValue }} payload - The action being requested.
   * @returns {Promise<boolean | string>} `true` if handled, an error string if rejected,
   *   or `false` to fall through
   *   to the subclass's {@link handleGameAction}.
   */
  private async handleSharedAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<boolean | string> {
    if (!this.gameState) return false;

    if (
      this.gameState.series &&
      [
        "add_jev",
        "remove_jev",
        "kick_player",
        "move_player_to_spectator",
        "set_host_spectating",
        "set_player_seats",
      ].includes(payload.actionType)
    )
      return "Series participants are fixed for this match";

    switch (payload.actionType) {
      case "add_jev":
      case "remove_jev":
        if (this.gameState.hostId !== player.id) return "Only the host can manage Jev";

        if (this.gameState.status !== "waiting")
          return "Jev can only be managed in a private lobby";

        return (await this.manageJev(payload.actionType === "add_jev")) ?? true;
      case "start_game":
        if (this.gameState.hostId !== player.id) return "Only the host can start";

        try {
          await this.startGame();
        } catch (e) {
          if (e instanceof ExpectedGameStartError) return e.message;
          console.error(`${this.roomLabel}: start game failed`, e);

          return "The server could not complete this action.";
        }

        return true;

      case "kick_player":
        if (this.gameState.hostId !== player.id) return "Only the host can kick players";

        if (this.gameState.status !== "waiting") {
          return "Players can only be kicked before the game starts";
        }

        {
          const targetId = isObjectValue(payload.data)
            ? objectValue(payload.data, "playerId")
            : undefined;

          if (!isString(targetId) || !targetId) return "playerId required";
          const error = await this.kickPlayer(targetId);

          if (error) return error;
        }

        return true;

      case "move_player_to_spectator": {
        if (this.gameState.hostId !== player.id) {
          return "Only the host can move players to spectators";
        }

        const targetId = isObjectValue(payload.data)
          ? objectValue(payload.data, "playerId")
          : undefined;

        return (
          (await this.movePlayerToSpectator(isString(targetId) ? targetId : undefined)) ?? true
        );
      }

      case "set_host_spectating": {
        if (this.gameState.hostId !== player.id) {
          return "Only the host can change host participation";
        }

        const spectating = isObjectValue(payload.data)
          ? objectValue(payload.data, "spectating")
          : undefined;

        if (!isBoolean(spectating)) return "spectating must be a boolean";

        return (await this.setHostSpectating(spectating)) ?? true;
      }

      case "set_player_seats": {
        if (this.gameState.hostId !== player.id) {
          return "Only the host can set player seats";
        }

        const playerIds = isObjectValue(payload.data)
          ? objectValue(payload.data, "playerIds")
          : undefined;

        return (await this.setPlayerSeats(playerIds)) ?? true;
      }

      case "end_game":
        if (this.gameState.hostId !== player.id) return "Only the host can end the game";

        if (this.gameState.series) this.gameState.series.aborted = true;
        await this.endGame();

        return true;

      default:
        return false; // Not a shared action — delegate to subclass
    }
  }

  /**
   * Subclasses implement this to handle game-specific actions.
   * Called only when the action is NOT a shared action.
   *
   * @returns {Promise<string | void>} Error message string to reject the action, or void on success.
   */
  protected abstract handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void>;

  /**
   * Project full server state for a specific player (fog of war).
   *
   * A migrated room inherits its game's projection, so a rule module that
   * declares `projectState` is the single owner of what leaves the server: the
   * browser view, the WebSocket broadcast and the agent view all read this one
   * method. A legacy room keeps its own override; a game with nothing to hide
   * declares no hook and the state passes through unchanged.
   */
  protected projectStateFor(playerId: string, state: TState): object {
    const rules = this.gameRules();

    if (rules?.projectState) return rules.projectState(state, playerId);

    return state;
  }

  /**
   * The game rule module this room delegates to (M3).
   *
   * `null` means the room is a legacy subclass that implements the rules
   * in-place. A migrated room overrides this and keeps the class as a thin
   * adapter, so no shared branch in this base class has to know the game.
   */
  protected gameRules(): GamePlugin<TState, string> | null {
    return null;
  }

  /**
   * Apply the effects a game rule module returned, in order.
   *
   * Rule modules describe what must happen instead of performing platform work
   * themselves: this is the only place a plugin's effects reach the audit log,
   * the clocks and the final `game_ended` delivery.
   *
   * `match_ended` deliberately does **not** write storage here. The platform
   * writes the finished state with its action receipt in one call
   * (`saveAppliedAction`), and only then broadcasts the end; an early save would
   * split that atomic pair and let a crash leave an ended match without the
   * receipt that makes the retry a replay.
   */
  protected applyGameEffects(effects: readonly GameEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case "event":
          this.recordEvent(effect.event, effect.data);
          break;
        case "stop_timers":
          this.stopTimers();
          break;
        case "match_ended":
          this.stopTimers();
          this.pendingMatchEnd = effect.reason;
          break;
      }
    }
  }

  /** Broadcast a finished match once its state is durable; no-op otherwise. */
  private deliverPendingMatchEnd(): void {
    const reason = this.pendingMatchEnd;

    if (reason === null) return;

    if (this.gameState?.status !== "ended") {
      // The end belonged to a write that never landed, or a rule module asked
      // for an announcement without finishing the match. Either way there is no
      // result to announce, and keeping the marker would leak it into the next
      // successful action.
      logEvent("match_end_dropped", { reason, roomType: this.gameState?.type });
      this.pendingMatchEnd = null;

      return;
    }

    this.pendingMatchEnd = null;
    this.broadcastProjected("game_ended", { reason });
  }

  /**
   * Persist a match a rule module finished, then broadcast it once.
   *
   * @returns whether a pending end was delivered.
   */
  private async flushPendingMatchEnd(): Promise<boolean> {
    if (this.pendingMatchEnd === null) return false;

    if (this.gameState?.status === "ended") await this.saveState();

    this.deliverPendingMatchEnd();

    return true;
  }

  /**
   * Epilogue for a rule module's turn-timeout policy.
   *
   * The platform cannot know whether a timeout only passes the turn or decides
   * the match, so a plugin adapter calls this after `applyGameEffects` and the
   * state it produced is persisted once, then broadcast.
   */
  protected async settleRuleTimeout(): Promise<void> {
    if (!this.gameState) return;

    if (await this.flushPendingMatchEnd()) return;

    if (this.gameState.status !== "playing") return;

    await this.saveState();
    this.broadcastState();
  }

  /**
   * Client view: projected state + `you` metadata for agent/UI convenience.
   * Always includes a public `spectators` list so every client can render who is watching.
   */
  protected buildClientView(playerId: string): object | null {
    if (!this.gameState) return null;
    const { turnTimeRemaining, ...clock } = this.clockSnapshot();

    const projected = agentProjectionSourceSchema.parse(
      this.projectStateFor(playerId, this.gameState),
    );

    const spectators = (this.gameState.spectators ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      isAgent: s.isAgent,
      channel: s.channel,
      codename: s.codename,
      ownerGamertag: s.ownerGamertag,
      environmentLabel: s.environmentLabel,
    }));

    const view = {
      ...projected,

      ...clock,
      turnState: {
        ...this.asProjectionPart(projected.turnState),
        turnTimeRemaining,
      },
      // Ensure list is present even if a game projection omitted it
      spectators,
      spectatorCount: spectators.length,

      you: this.buildYouContext(playerId),
    };

    if (this.gameState.series)
      Object.assign(view, {
        series: { code: this.gameState.series.code, index: this.gameState.series.index },
      });

    if (JEV_GAMES.has(this.gameState.type))
      Object.assign(view, {
        jev: {
          available: Boolean(this.env?.TYPESAFE_API_KEY),
          playerId: this.jevMember()?.id,
          status: this.jev?.status ?? "ready",
        },
      });

    return view;
  }

  /**
   * Compact projected state for remote MCP tools.
   *
   * This always starts from the same fog-of-war projection as the browser, then
   * removes room lifecycle, identity-display, static catalog, and UI-only data.
   * Explicit inspection, join, and internal action endpoints use this richer
   * projection. MCP wait responses reduce it to one decision in buildWaitResult.
   */
  protected buildAgentView(playerId: string): object | null {
    if (!this.gameState) return null;
    const timers = this.clockSnapshot();

    const projected = agentProjectionSourceSchema.parse(
      this.projectStateFor(playerId, this.gameState),
    );

    const you = this.compactAgentYou(this.buildYouContext(playerId));
    const turn = this.asProjectionPart(projected.turnState);

    const common = {
      type: projected.type,
      status: projected.status,
      players: this.compactAgentPlayers(projected.players),
      roomMembers: this.buildAgentRoomMembers(),
      gameTimeRemaining: timers.gameTimeRemaining,
      turnState: turn
        ? {
            currentPlayerId: turn.currentPlayerId,
            turnNumber: turn.turnNumber,
            phase: turn.phase,
            turnTimeRemaining: timers.turnTimeRemaining,
          }
        : undefined,
      winner: projected.winner,
      you,
    };

    if (this.gameState.series)
      Object.assign(common, {
        series: { code: this.gameState.series.code, index: this.gameState.series.index },
      });

    // A migrated room returns its rule module; a room that only declares a
    // registered game id inherits that game's decision fields. Legacy rooms
    // still on the branches below are unaffected.
    const rules = this.gameRules() ?? gamePluginFor(this.gameState.type);

    if (rules?.agentFields)
      return this.definedAgentFields({
        ...common,
        ...this.pluginAgentFields(rules, projected),
      });

    switch (projected.type) {
      case "pokemon":
        return this.definedAgentFields({
          ...common,
          format: projected.format,
          yourSeat: projected.yourSeat,
          sides: projected.sides,
          decision: projected.decision,
          battleLog: projected.battleLog,
          battleTurn: projected.battleTurn,
          winnerSeat: projected.winnerSeat,
        });
      case "contexto":
        return this.definedAgentFields({
          ...common,
          progress: projected.progress,
          guessLimit: projected.guessLimit,
          vocabularySize: projected.vocabularySize,
          totalGuesses: projected.totalGuesses,
          secret: projected.secret,
        });

      case "codenames":
        return this.definedAgentFields({
          ...common,
          board: projected.board,
          assignments: projected.assignments,
          startingTeam: projected.startingTeam,
          activeTeam: projected.activeTeam,
          clue: projected.clue,
          guessesRemaining: projected.guessesRemaining,
          guessesMade: projected.guessesMade,
          remaining: projected.remaining,
          winnerTeam: projected.winnerTeam,
          lastReveal: projected.lastReveal,
        });

      case "poker": {
        const handNumber = projected.handNumber;

        const actionLog = Array.isArray(projected.actionLog)
          ? projected.actionLog.filter((entry) => {
              const action = this.asProjectionPart(entry);

              return action?.handNumber === handNumber;
            })
          : [];

        return this.definedAgentFields({
          ...common,
          seats: projected.seats,
          community: projected.community,
          pot: projected.pot,
          currentBet: projected.currentBet,
          minRaise: projected.minRaise,
          handNumber,
          actionPlayerId: projected.actionPlayerId,
          toCall: projected.toCall,
          canCheck: projected.canCheck,
          blinds: projected.blinds,
          buttonPlayerId: projected.buttonPlayerId,
          smallBlindPlayerId: projected.smallBlindPlayerId,
          bigBlindPlayerId: projected.bigBlindPlayerId,
          actionLog,
          lastHandResult: projected.lastHandResult,
        });
      }

      case "battleship":
        return { ...common, ...battleshipAgentState(projected) };

      default:
        return this.definedAgentFields(common);
    }
  }

  /**
   * Merge a rule module's decision fields into the agent view.
   *
   * The plugin only receives the recipient's own projection, and platform-owned
   * keys are dropped, so a plugin cannot reveal hidden state or rewrite identity,
   * roster, clock or turn fields.
   */
  private pluginAgentFields(
    rules: { agentFields?: (projection: WireObject) => WireObject },
    projection: WireObject,
  ): WireObject {
    const fields = rules.agentFields?.(projection);

    if (!fields) return {};

    const kept: WireObject = {};

    for (const [key, value] of Object.entries(fields)) {
      if (PLATFORM_AGENT_KEYS.has(key)) continue;

      kept[key] = value;
    }

    return kept;
  }

  private asProjectionPart<T>(value: T): ProjectionPart | null {
    const parsed = projectionPartSchema.safeParse(value);

    return parsed.success ? parsed.data : null;
  }

  private definedAgentFields<T extends object>(value: T): T {
    const result = { ...value };

    for (const key in result) if (result[key] === undefined) delete result[key];

    return result;
  }

  private compactAgentPlayers(value: WireValue) {
    if (!Array.isArray(value)) return [];

    return value.map((entry) => {
      const player = this.asProjectionPart(entry);

      return player ? this.definedAgentFields({ id: player.id, name: player.name }) : entry;
    });
  }

  /** Public room roster used by MCP hosts to resolve natural-language identities. */
  private buildAgentRoomMembers(): AgentRoomMember[] {
    if (!this.gameState) return [];

    const describe = (member: BasePlayerInfo, role: "player" | "spectator"): AgentRoomMember =>
      this.definedAgentFields({
        playerId: member.id,
        role,
        isHost: member.id === this.gameState?.hostId,
        seatKind: member.isAgent ? "agent" : "human",
        username: member.ownerGamertag ?? (member.isAgent ? undefined : member.name),
        agentName: member.isAgent ? (member.codename ?? member.name) : undefined,
        environmentLabel: member.isAgent ? member.environmentLabel : undefined,
        displayName: member.name,
      }) satisfies AgentRoomMember;

    return [
      ...this.gameState.players.map((member) => describe(member, "player")),
      ...this.ensureSpectators().map((member) => describe(member, "spectator")),
    ];
  }

  private compactAgentYou(value: YouContext): ProjectionPart {
    const ready = Date.now() >= this.agentDecisionReadyAt();

    return this.definedAgentFields({
      playerId: value.playerId,
      isHost: value.isHost,
      isYourTurn: value.isYourTurn && ready,
      isSpectator: value.isSpectator,
      phase: value.phase,
      legalActions: ready
        ? value.legalActions
        : value.legalActions.filter((action) => action === "leave" || action === "end_game"),
      team: value.team,
      role: value.role,
      canSeeKey: value.canSeeKey,
    });
  }

  /**
   * Per-player context: isHost, isYourTurn, legalActions, etc.
   * Subclasses may override to add role/team.
   */
  protected buildYouContext(playerId: string): YouContext {
    if (!this.gameState) {
      return {
        playerId,
        name: null,
        codename: null,
        ownerGamertag: null,
        environmentLabel: null,
        isHost: false,
        isYourTurn: false,
        isAgent: false,
        isSpectator: false,
        seatKind: "human",
        channel: "browser",
        channelLabel: channelLabel("browser"),
        phase: "waiting",
        status: "waiting",
        legalActions: [],
      };
    }

    const seat = this.gameState.players.find((p) => p.id === playerId);

    const spectator = !seat
      ? (this.gameState.spectators ?? []).find((s) => s.id === playerId)
      : undefined;

    const identity = seat ?? spectator;
    const watching = !seat && Boolean(spectator);

    const channel: SeatChannel = identity?.channel ?? (identity?.isAgent ? "mcp" : "browser");

    return {
      playerId,
      name: identity?.name ?? null,
      codename: identity?.codename ?? null,
      ownerGamertag: identity?.ownerGamertag ?? null,
      environmentLabel: identity?.environmentLabel ?? null,
      isHost: this.gameState.hostId === playerId,
      isYourTurn: watching ? false : this.isYourTurn(playerId),
      isAgent: Boolean(identity?.isAgent),
      isSpectator: watching,
      seatKind: watching ? "spectator" : identity?.isAgent ? "mcp" : "human",
      channel,
      channelLabel: channelLabel(channel),
      phase: this.gameState.turnState.phase,
      status: this.gameState.status,
      legalActions: this.getLegalActions(playerId),
    };
  }

  /** Override in subclasses for turn-aware legal action lists. */
  protected getLegalActions(_playerId: string): string[] {
    if (!this.gameState) return [];
    const isHost = this.gameState.hostId === _playerId;

    // Ordinary spectators never get host / turn actions. A spectator-host keeps
    // administrative controls but still receives no game-turn actions.
    if (this.isSpectator(_playerId) && !isHost) return ["leave"];
    const actions: string[] = ["leave"];

    if (isHost) {
      if (this.gameState.status === "waiting") {
        actions.push("start_game", "move_player_to_spectator", "set_player_seats", "end_game");
        actions.push("set_host_spectating");

        if (JEV_GAMES.has(this.gameState.type) && this.env?.TYPESAFE_API_KEY) {
          if (this.jevMember()) actions.push("remove_jev");
          else if (this.gameState.players.length < this.gameState.maxPlayers)
            actions.push("add_jev");
        }
      }

      if (this.gameState.status === "playing") {
        actions.push("end_game");
      }
    }

    return actions;
  }

  /** Optional game-specific cleanup when a room member changes player/spectator role. */
  protected onRoomMemberRoleChanged(_playerId: string, _role: "player" | "spectator"): void {
    // Override in role-based games when seat changes invalidate assignments.
  }

  // ─── Game lifecycle ────────────────────────────────────────────

  /**
   * Subclass hook called right before `game_started` is broadcast.
   * Override to perform custom initialization (e.g. shuffle roles, create the first round).
   */
  protected onStartGame(): void | Promise<void> {
    // Override in subclasses for custom start logic
  }

  /**
   * Minimum number of players required to start the game.
   * Override in subclasses to enforce a different threshold.
   *
   * @returns {number} Minimum player count (default: 2).
   */
  protected get minPlayersToStart(): number {
    return 2;
  }

  /**
   * The initial turn phase string used when the game starts.
   * Override per game (e.g. `"play"` for Connect 4, `"preflop"` for Poker).
   *
   * @returns {string} The initial phase label (default: `"waiting"`).
   */
  protected get initialTurnPhase(): string {
    return "waiting";
  }

  /** Optional game-specific lobby validation performed before state enters play. */
  protected validateStartGame(): StartGameProblem | null {
    return null;
  }

  /**
   * Transitions the game from `waiting` to `playing`.
   * Validates player count, initialises the turn state and timer, calls {@link onStartGame},
   * persists the new state, starts the interval timers, and broadcasts `game_started`.
   *
   * No-ops if the game is not currently in `waiting` status.
   *
   * @returns {Promise<void>}
   */
  private async startGame(): Promise<void> {
    if (!this.gameState || this.gameState.status !== "waiting") {
      throw new ExpectedGameStartError("Game is not in waiting status");
    }

    if (this.gameState.players.length < this.minPlayersToStart) {
      const msg = `Need at least ${this.minPlayersToStart} player(s) to start`;

      this.broadcast({ type: "error", payload: { message: msg, code: "NEED_MORE_PLAYERS" } });
      throw new ExpectedGameStartError(msg);
    }

    const startError = this.validateStartGame();

    if (startError) {
      this.broadcast({ type: "error", payload: startError });
      throw new ExpectedGameStartError(startError.message);
    }

    const firstPlayer = this.gameState.players[0];

    if (!firstPlayer) {
      throw new Error("Cannot start a game without a player");
    }

    const jevSeat = this.jev;

    if (jevSeat && !jevSeat.credentialId) {
      // A host may connect TypeSafe from the lobby after adding Jev but before starting.
      const credential = await getJevCredential(this.env, jevSeat.ownerId);

      if (credential) {
        jevSeat.credentialId = credential.id;
        await this.state.storage.put("jevSeat", jevSeat);
      } else if (!(await claimSponsoredJevTrial(this.env, jevSeat.ownerId))) {
        const msg =
          "Your free Jev game has been used. Connect TypeSafe in Profile settings to keep playing.";

        this.broadcast({ type: "error", payload: { message: msg, code: "JEV_TRIAL_USED" } });
        throw new ExpectedGameStartError(msg);
      }
    }

    this.gameState.status = "playing";
    this.gameState.playStartedAt = Date.now();
    this.gameState.gameTimeRemaining = this.gameState.timerConfig.gameTotalTime;
    this.gameState.turnState = {
      ...this.gameState.turnState,
      currentPlayerId: firstPlayer.id,
      turnNumber: 1,
      phase: this.initialTurnPhase,
      startedAt: Date.now(),
      turnTimeRemaining: this.gameState.timerConfig.turnTime,
    };

    if (this.gameState.series)
      this.gameState.series.metrics = Object.fromEntries(
        this.gameState.players.map((p) => [
          p.id,
          { actions: 0, decisionMs: 0, timeouts: 0, lastActionAt: Date.now() },
        ]),
      );
    await this.onStartGame();

    await this.captureBroadcastPermission();
    this.startTimers();
    // The match deadline changes here. Persist the repair marker with the state so
    // a restart between the two steps still knows the directory row is behind.
    this.directoryExpiryPending = true;
    // saveState persists the marker and retries the directory in the same step.
    await this.saveState();
    await this.markMeaningfulActivity();
    this.recordEvent("game_started", {
      currentPlayerId: this.gameState.turnState.currentPlayerId,
      turnNumber: this.gameState.turnState.turnNumber,
    });

    if (this.env.DB) {
      const state = this.gameState;

      const projected = broadcastProjection(this.projectStateFor("", state), state.players);

      try {
        await this.env.DB.prepare(`INSERT INTO broadcast_rooms
          (id, room_id, game_type, created_at, listed_at, expires_at, summary, game_log_id, broadcast_allowed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(room_id, created_at) DO NOTHING`)
          .bind(
            crypto.randomUUID(),
            roomIdFor(normalizeGameType(state.type)!, state.roomCode),
            state.type,
            state.createdAt,
            Date.now(),
            state.expiresAt,
            JSON.stringify({ type: state.type, status: "playing", players: projected.players }),
            state.id,
            state.broadcastAllowed ? 1 : 0,
          )
          .run();
        await this.env.DB.prepare("DELETE FROM broadcast_rooms WHERE expires_at <= ?")
          .bind(Date.now())
          .run();
      } catch (error) {
        console.error("Failed to publish spectator directory entry", error);
      }
    }

    this.broadcastProjected("game_started");
  }

  /**
   * Subclass hook called when the overall game timer reaches zero.
   * Override to apply game-outcome logic (e.g. declare a draw on timeout).
   */
  protected onGameTimeout(): void | Promise<void> {
    // Override in subclasses, e.g. to set winner
  }

  /** Game-specific timeout behavior. Round-robin games use the default. */
  protected async onTurnTimeout(_playerId: string | null): Promise<void> {
    await this.nextTurn();
  }

  // ─── Timers ────────────────────────────────────────────────────

  /** Anchor client displays to server time, independent of the device's wall clock. */
  private clockSnapshot() {
    const serverTime = Date.now();
    const state = this.gameState;
    const running = state?.status === "playing";
    const gameCheckpoint = this.lastGameTimerTickAt || state?.updatedAt || serverTime;

    const turnCheckpoint =
      this.timerTurnStartedAt === state?.turnState.startedAt
        ? this.lastTurnTimerTickAt || state?.updatedAt || serverTime
        : state?.turnState.startedAt || serverTime;

    const gameTimeRemaining = Math.max(
      0,
      (state?.gameTimeRemaining ?? 0) - (running ? Math.max(0, serverTime - gameCheckpoint) : 0),
    );

    const turnTimeRemaining = Math.max(
      0,
      (state?.turnState.turnTimeRemaining ?? 0) -
        (running ? Math.max(0, serverTime - turnCheckpoint) : 0),
    );

    return {
      gameTimeRemaining,
      turnTimeRemaining,
      clock: {
        serverTime,
        gameEndsAt: running ? serverTime + gameTimeRemaining : null,
        turnEndsAt: running ? serverTime + turnTimeRemaining : null,
      },
    };
  }

  private buildBroadcastView() {
    const { turnTimeRemaining, ...clock } = this.clockSnapshot();
    const state = this.gameState!;
    const projected = broadcastProjection(this.projectStateFor("", state), state.players);

    return {
      ...projected,
      ...clock,
      turnState: {
        ...this.asProjectionPart(projected.turnState),
        turnTimeRemaining,
      },
    };
  }

  /** Initialize clock checkpoints. Durable alarms enforce the next deadline. */
  protected startTimers(): void {
    const now = Date.now();
    this.lastGameTimerTickAt = now;
    this.lastTurnTimerTickAt = now;
    this.timerTurnStartedAt = this.gameState?.turnState.startedAt ?? 0;
  }

  private syncRunningTimers(now: number): void {
    if (!this.gameState || this.gameState.status !== "playing") return;

    if (this.lastGameTimerTickAt <= 0 || this.lastTurnTimerTickAt <= 0) {
      this.lastGameTimerTickAt = now;
      this.lastTurnTimerTickAt = now;
      this.timerTurnStartedAt = this.gameState.turnState.startedAt;

      return;
    }

    const gameElapsed = Math.max(0, now - this.lastGameTimerTickAt);
    this.gameState.gameTimeRemaining = Math.max(0, this.gameState.gameTimeRemaining - gameElapsed);
    this.lastGameTimerTickAt = now;

    if (this.timerTurnStartedAt !== this.gameState.turnState.startedAt) {
      // A game action opened a fresh phase/turn. Its countdown starts at that
      // transition, not at the preceding interval checkpoint.
      this.timerTurnStartedAt = this.gameState.turnState.startedAt;
      this.lastTurnTimerTickAt = now;

      return;
    }

    const turnElapsed = Math.max(0, now - this.lastTurnTimerTickAt);
    this.gameState.turnState.turnTimeRemaining = Math.max(
      -TURN_EXPIRY_GRACE_MS,
      this.gameState.turnState.turnTimeRemaining - turnElapsed,
    );
    this.lastTurnTimerTickAt = now;
  }

  private async runTimerTick(): Promise<void> {
    if (this.timerTickRunning) return;
    this.timerTickRunning = true;

    try {
      if (!this.gameState || this.gameState.status !== "playing") return;
      const now = Date.now();
      this.syncRunningTimers(now);
      await this.settleExpiredTimers(now);
    } finally {
      this.timerTickRunning = false;
    }
  }

  /**
   * Apply timer outcomes before accepting another intent. This is shared by
   * the interval tick and action dispatch so an intent cannot sneak through
   * after its wall-clock deadline but before the next scheduled tick.
   */
  private async settleExpiredTimers(now: number): Promise<boolean> {
    if (!this.gameState || this.gameState.status !== "playing") return false;

    if (this.gameState.gameTimeRemaining <= 0) {
      this.gameState.status = "ended";

      try {
        await this.onGameTimeout();
      } catch (error) {
        // A game-specific scoring failure must not leave an expired match alive.
        console.error(`${this.roomLabel}: timeout result failed`, error);
      }

      if (!this.gameState) return true;
      this.gameState.status = "ended";
      this.gameState.turnState.phase = "ended";
      this.gameState.turnState.currentPlayerId = null;
      this.gameState.updatedAt = now;
      this.stopTimers();
      this.recordEvent("game_ended", { reason: "time_up" });
      await this.saveState();
      this.broadcastProjected("game_ended", { reason: "time_up" });

      return true;
    }

    // The browser stops at zero, but allow a small transport/rendering grace
    // before forfeiting the turn. Game and room deadlines remain exact.
    if (this.gameState.turnState.turnTimeRemaining > -TURN_EXPIRY_GRACE_MS) return false;

    const timedOutPlayerId = this.gameState.turnState.currentPlayerId;

    if (this.gameState.series) {
      const pending = timedOutPlayerId
        ? [timedOutPlayerId]
        : this.gameState.players.filter((p) => this.isYourTurn(p.id)).map((p) => p.id);

      for (const id of pending) {
        const metric = this.gameState.series.metrics[id] ?? {
          actions: 0,
          decisionMs: 0,
          timeouts: 0,
        };

        this.gameState.series.metrics[id] = { ...metric, timeouts: metric.timeouts + 1 };
      }
    }

    const currentPlayer = this.gameState.players.find((player) => player.id === timedOutPlayerId);

    this.broadcast({
      type: "turn_timeout",
      payload: {
        playerId: timedOutPlayerId || "",
        playerName: currentPlayer?.name,
        reason: "forfeit",
      },
    });
    await this.onTurnTimeout(timedOutPlayerId);
    this.recordEvent("turn_timeout", { playerId: timedOutPlayerId });

    if (this.gameState?.status === "playing" && this.gameState.turnState.turnTimeRemaining <= 0) {
      this.gameState.turnState.turnTimeRemaining = this.gameState.timerConfig.turnTime;
      this.gameState.turnState.startedAt = now;
      await this.saveState();
    }

    // A timeout may decide the match (a forfeit limit, a scoring rule). Persist
    // that finished state before the terminal projection, exactly like an action.
    await this.flushPendingMatchEnd();

    const handledAt = Date.now();
    this.lastGameTimerTickAt = handledAt;
    this.lastTurnTimerTickAt = handledAt;
    this.timerTurnStartedAt = this.gameState?.turnState.startedAt ?? 0;

    return true;
  }

  /**
   * Clears the running clock checkpoints.
   * Safe to call multiple times; does nothing if no timers are running.
   */
  protected stopTimers(): void {
    this.lastGameTimerTickAt = 0;
    this.lastTurnTimerTickAt = 0;
    this.timerTurnStartedAt = 0;
  }

  /**
   * Advances the game to the next player's turn in round-robin order.
   * Resets the turn timer, increments the turn counter, updates the `currentPlayerId`,
   * persists the state, and broadcasts a `turn_changed` event.
   *
   * @returns {Promise<void>}
   */
  protected async nextTurn(): Promise<void> {
    if (!this.gameState) return;

    if (this.gameState.players.length === 0) {
      const spectatorHostStillPresent = this.ensureSpectators().some(
        (member) => member.id === this.gameState?.hostId,
      );

      if (!spectatorHostStillPresent || this.gameState.status !== "waiting") {
        await this.endGame();
      }

      return;
    }

    const currentIndex = this.gameState.players.findIndex(
      (p) => p.id === this.gameState!.turnState.currentPlayerId,
    );

    const nextIndex = (currentIndex + 1) % this.gameState.players.length;

    const nextPlayer = this.gameState.players[nextIndex];

    if (!nextPlayer) {
      throw new Error("Unable to resolve the next player");
    }

    this.gameState.turnState.currentPlayerId = nextPlayer.id;
    this.gameState.turnState.turnTimeRemaining = this.gameState.timerConfig.turnTime;
    this.gameState.turnState.startedAt = Date.now();
    this.gameState.turnState.turnNumber++;

    await this.saveState();

    this.recordEvent("turn_changed", {
      currentPlayerId: this.gameState.turnState.currentPlayerId,
      turnNumber: this.gameState.turnState.turnNumber,
      phase: this.gameState.turnState.phase,
    });

    this.broadcast({
      type: "turn_changed",
      payload: {
        currentPlayerId: this.gameState.turnState.currentPlayerId,
        turnNumber: this.gameState.turnState.turnNumber,
        phase: this.gameState.turnState.phase,
        turnTimeRemaining: this.gameState.turnState.turnTimeRemaining,
      },
    });
    this.broadcastState();
  }

  // ─── Player management ─────────────────────────────────────────

  /** Promote one waiting-room spectator into an available player seat. */
  protected promoteSpectatorToPlayer(playerId: string): string | void {
    if (!this.gameState) return "No game state";

    if (this.gameState.status !== "waiting") {
      return "Player seats can only be claimed before the game starts";
    }

    if (this.gameState.players.some((player) => player.id === playerId)) return;

    if (this.gameState.players.length >= this.gameState.maxPlayers) {
      return "No player seat is available";
    }

    const spectators = this.ensureSpectators();
    const spectatorIndex = spectators.findIndex((member) => member.id === playerId);

    if (spectatorIndex < 0) return "Spectator not found";
    const [member] = spectators.splice(spectatorIndex, 1);

    if (!member) return "Spectator not found";

    this.gameState.players.push(member);
    this.onRoomMemberRoleChanged(playerId, "player");
    this.gameState.updatedAt = Date.now();

    for (const [ws, session] of this.sessions) {
      if (session.id !== playerId) continue;
      session.isSpectator = false;

      try {
        ws.serializeAttachment({
          id: session.id,
          name: session.name,
          joinedAt: session.joinedAt,
          isSpectator: false,
        } satisfies WsSessionAttachment);
      } catch {
        // Some test WebSocket shims do not implement hibernation attachments.
      }
    }
  }

  /**
   * Atomically assign the waiting-room player seats from stable member IDs.
   * A playing host is retained implicitly. A spectator-host stays watch-only
   * unless explicitly included in `playerIds`.
   */
  private async setPlayerSeats(playerIds: WireValue): Promise<string | void> {
    if (!this.gameState) return "No game state";

    if (this.gameState.status !== "waiting") {
      return "Player seats can only be set before the game starts";
    }

    if (!Array.isArray(playerIds)) return "playerIds must be an array";

    const requested: string[] = [];
    const seen = new Set<string>();

    for (const value of playerIds) {
      if (!isString(value) || value.length < 1 || value.length > 128) {
        return "playerIds must be an array of valid room-member IDs";
      }

      if (seen.has(value)) return "playerIds must not contain duplicate IDs";
      seen.add(value);
      requested.push(value);
    }

    const members = [...this.gameState.players, ...this.ensureSpectators()];

    const byId = new Map(members.map((member) => [member.id, member]));

    for (const playerId of requested) {
      if (!byId.has(playerId)) return `Player not found: ${playerId}`;
    }

    const hostIsSpectating = this.isSpectator(this.gameState.hostId);

    const keepHostSpectating = hostIsSpectating && !requested.includes(this.gameState.hostId);

    const desiredIds = keepHostSpectating
      ? requested
      : [
          this.gameState.hostId,
          ...requested.filter((playerId) => playerId !== this.gameState?.hostId),
        ];

    if (desiredIds.length > this.gameState.maxPlayers) {
      return "playerIds must be limited to the available player seats";
    }

    if (members.length - desiredIds.length > MAX_SPECTATORS) {
      return "Spectator limit reached";
    }

    const desired = new Set(desiredIds);
    this.gameState.players = desiredIds.map((playerId) => byId.get(playerId)!);
    this.gameState.spectators = members.filter((member) => !desired.has(member.id));

    for (const member of members) {
      this.onRoomMemberRoleChanged(member.id, desired.has(member.id) ? "player" : "spectator");
    }

    this.gameState.updatedAt = Date.now();

    // Keep browser sockets and hibernation attachments aligned with the new role.
    this.restoreSessions();

    for (const [ws, session] of this.sessions) {
      if (!byId.has(session.id)) continue;
      session.isSpectator = !desired.has(session.id);

      try {
        ws.serializeAttachment({
          id: session.id,
          name: session.name,
          joinedAt: session.joinedAt,
          isSpectator: session.isSpectator,
        } satisfies WsSessionAttachment);
      } catch {
        // Some test WebSocket shims do not implement hibernation attachments.
      }
    }

    await this.saveState();
    this.broadcastState();
  }

  /** Toggle whether the host occupies a player seat or only organizes. */
  private async setHostSpectating(spectating: boolean): Promise<string | void> {
    if (!this.gameState) return "No game state";

    if (this.gameState.status !== "waiting") {
      return "Host participation can only change before the game starts";
    }

    const hostId = this.gameState.hostId;
    const currentlySpectating = this.isSpectator(hostId);

    if (currentlySpectating === spectating) return;

    if (spectating) {
      const playerIndex = this.gameState.players.findIndex((player) => player.id === hostId);

      if (playerIndex < 0) return "Host player seat not found";
      const spectators = this.ensureSpectators();

      if (spectators.length >= MAX_SPECTATORS) return "Spectator limit reached";
      const [host] = this.gameState.players.splice(playerIndex, 1);

      if (!host) return "Host player seat not found";
      spectators.push(host);
      this.onRoomMemberRoleChanged(hostId, "spectator");
    } else {
      if (this.gameState.players.length >= this.gameState.maxPlayers) {
        return "No player seat is available for the host";
      }

      const spectators = this.ensureSpectators();
      const spectatorIndex = spectators.findIndex((member) => member.id === hostId);

      if (spectatorIndex < 0) return "Host spectator seat not found";
      const [host] = spectators.splice(spectatorIndex, 1);

      if (!host) return "Host spectator seat not found";
      this.gameState.players.unshift(host);
      this.onRoomMemberRoleChanged(hostId, "player");
    }

    this.gameState.updatedAt = Date.now();
    this.restoreSessions();

    for (const [ws, session] of this.sessions) {
      if (session.id !== hostId) continue;
      session.isSpectator = spectating;

      try {
        ws.serializeAttachment({
          id: session.id,
          name: session.name,
          joinedAt: session.joinedAt,
          isSpectator: spectating,
        } satisfies WsSessionAttachment);
      } catch {
        // Some test WebSocket shims do not implement hibernation attachments.
      }
    }

    await this.saveState();
    this.broadcastState();
  }

  /**
   * Move a playing seat, including the host's, to the watch list without disconnecting it.
   * This is intentionally limited to the waiting room so game-specific seat,
   * board, chip, and turn state cannot be invalidated mid-match.
   */
  private async movePlayerToSpectator(playerId: string | undefined): Promise<string | void> {
    if (!this.gameState) return "No game state";

    if (this.gameState.status !== "waiting") {
      return "Players can only be moved to spectators before the game starts";
    }

    if (!playerId) return "playerId required";

    if (playerId === this.gameState.hostId) {
      return await this.setHostSpectating(true);
    }

    const playerIndex = this.gameState.players.findIndex((p) => p.id === playerId);

    if (playerIndex < 0) return "Player not found";

    const spectators = this.ensureSpectators();

    if (spectators.length >= MAX_SPECTATORS) {
      return "Spectator limit reached";
    }

    const [seat] = this.gameState.players.splice(playerIndex, 1);

    if (!seat) return "Player not found";
    spectators.push(seat);
    this.onRoomMemberRoleChanged(playerId, "spectator");

    // Keep browser connections alive and immediately make them watch-only.
    this.restoreSessions();

    for (const [ws, session] of this.sessions) {
      if (session.id !== playerId) continue;
      session.isSpectator = true;

      try {
        ws.serializeAttachment({
          id: session.id,
          name: session.name,
          joinedAt: session.joinedAt,
          isSpectator: true,
        } satisfies WsSessionAttachment);
      } catch {
        // Some test WebSocket shims do not implement hibernation attachments.
      }
    }

    await this.saveState();
    this.broadcast({
      type: "player_moved_to_spectator",
      payload: { playerId, name: seat.name },
    });
    this.broadcastState();
  }

  /**
   * Forcibly removes a player from the room (host action).
   * Closes the player's WebSocket with code 1001, removes them from both the
   * sessions map and the players list, and broadcasts `player_kicked`.
   *
   * If the room is left empty the game is ended. If the kicked player was the
   * host, the next player in the list is promoted and `host_changed` is broadcast.
   *
   * @param {string} playerId - The ID of the player to kick.
   * @returns An error message when the target does not exist.
   */
  private async kickPlayer(playerId: string): Promise<string | void> {
    if (!this.gameState) return "No game state";

    const player = this.gameState.players.find((p) => p.id === playerId);

    if (!player) return "Player not found";

    this.restoreSessions();

    for (const [ws, p] of this.sessions) {
      if (p.id === playerId) {
        ws.close(1001, "Kicked by host");
        this.sessions.delete(ws);
      }
    }

    this.gameState.players = this.gameState.players.filter((p) => p.id !== playerId);

    this.broadcast({
      type: "player_kicked",
      payload: { playerId, name: player.name },
    });

    if (this.gameState.players.length === 0) {
      await this.endGame();
    } else if (this.gameState.hostId === playerId) {
      const nextHost = this.gameState.players.find((member) => !member.hostedAgent);

      if (!nextHost) {
        await this.endGame();

        return;
      }

      this.gameState.hostId = nextHost.id;
      this.broadcast({
        type: "host_changed",
        payload: { newHostId: this.gameState.hostId },
      });
    }

    await this.saveState();
  }

  /**
   * Handles a voluntary player departure.
   * Removes the player from the sessions map and the game's player list,
   * promotes a new host if necessary, broadcasts `player_left` (and optionally
   * `host_changed`), and ends the game if the room becomes empty while waiting.
   *
   * @param {Player}    player - The player who is leaving.
   * @param {WebSocket} ws     - The player's WebSocket connection to clean up.
   */
  private handlePlayerLeave(player: Player, ws: WebSocket): void {
    this.sessions.delete(ws);
    void this.leaveMember(player.id, player.name);
  }

  private async leaveMember(playerId: string, fallbackName?: string): Promise<void> {
    if (!this.gameState) return;

    if (
      this.gameState.series &&
      this.gameState.status !== "ended" &&
      this.gameState.players.some((p) => p.id === playerId)
    ) {
      this.gameState.series.aborted = true;
      await this.endGame();

      return;
    }

    const spectatorIndex = this.ensureSpectators().findIndex((s) => s.id === playerId);

    if (spectatorIndex >= 0) {
      const [spectator] = this.gameState.spectators!.splice(spectatorIndex, 1);
      const wasHost = this.gameState.hostId === playerId;
      this.closeSessionsForUser(playerId);
      this.broadcast({
        type: "spectator_left",
        payload: { userId: playerId, name: spectator?.name || fallbackName },
      });

      if (wasHost) {
        const nextHost = this.gameState.players.find((member) => !member.hostedAgent);

        if (!nextHost) {
          await this.endGame();

          return;
        }

        this.gameState.hostId = nextHost.id;
        this.broadcast({
          type: "host_changed",
          payload: { newHostId: this.gameState.hostId },
        });
      }

      await this.saveState();
      await this.markMeaningfulActivity();
      this.broadcastState();

      return;
    }

    const playerIndex = this.gameState.players.findIndex((p) => p.id === playerId);

    if (playerIndex < 0) return;
    const [departed] = this.gameState.players.splice(playerIndex, 1);
    const wasHost = this.gameState.hostId === playerId;
    this.closeSessionsForUser(playerId);
    this.broadcast({
      type: "player_left",
      payload: { userId: playerId, name: departed?.name || fallbackName },
    });

    if (this.gameState.status === "playing") {
      await this.endGame();

      return;
    }

    if (this.gameState.players.length === 0) {
      const spectatorHostStillPresent = this.ensureSpectators().some(
        (member) => member.id === this.gameState?.hostId,
      );

      if (!spectatorHostStillPresent) {
        await this.endGame();

        return;
      }
    }

    if (wasHost) {
      const nextHost = this.gameState.players.find((member) => !member.hostedAgent);

      if (!nextHost) {
        await this.endGame();

        return;
      }

      this.gameState.hostId = nextHost.id;
      this.broadcast({
        type: "host_changed",
        payload: { newHostId: this.gameState.hostId },
      });
    }

    await this.saveState();
    await this.markMeaningfulActivity();
    this.broadcastState();
  }

  // ─── Broadcasting & persistence ────────────────────────────────

  /**
   * Rebuild `this.sessions` from Cloudflare's hibernatable WebSocket set.
   *
   * Durable Objects may sleep while sockets stay open. The in-memory Map is
   * empty on wake, which previously caused join/state broadcasts to reach only
   * the newly connected client (host UI stayed stale until refresh).
   */
  protected restoreSessions(): void {
    let sockets: WebSocket[];

    try {
      sockets = this.state.getWebSockets?.() ?? [];
    } catch {
      // Non-DO test shims may not implement getWebSockets.
      return;
    }

    const next = new Map<WebSocket, Player>();

    for (const ws of sockets) {
      const existing = this.sessions.get(ws);

      if (existing) {
        existing.socket = ws;
        existing.isConnected = true;
        next.set(ws, existing);
        continue;
      }

      let att: WsSessionAttachment | null = null;

      try {
        att = z
          .object({
            id: z.string(),
            name: z.string(),
            joinedAt: z.number(),
            isSpectator: z.boolean().optional(),
          })
          .nullable()
          .catch(null)
          .parse(ws.deserializeAttachment());
      } catch {
        att = null;
      }

      if (!att?.id) continue;

      next.set(ws, {
        id: att.id,
        name: att.name || "Anonymous",
        socket: ws,
        isConnected: true,
        joinedAt: isNumber(att.joinedAt) ? att.joinedAt : Date.now(),
        isSpectator: att.isSpectator === true,
      });
    }

    this.sessions = next;
  }

  /** Close and forget every open socket for a seat (reconnect / replace). */
  protected closeSessionsForUser(userId: string): void {
    for (const [ws, player] of [...this.sessions]) {
      if (player.id !== userId) continue;
      this.sessions.delete(ws);

      try {
        ws.close(1000, "replaced");
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Sends a serialised {@link ServerMessage} to all currently open WebSocket sessions.
   * State-bearing messages should use {@link broadcastState} / {@link broadcastProjected}
   * so each client gets a role-projected view.
   */
  protected broadcast(message: ServerMessage, exclude?: WebSocket): void {
    this.restoreSessions();

    for (const [ws] of this.sessions) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        this.sendTo(ws, message);
      }
    }
  }

  private broadcastAttachment(ws: WebSocket): BroadcastAttachment | null {
    try {
      const value = z
        .object({
          kind: z.literal("broadcast"),
          connectionId: z.string().optional(),
          subject: z.string().optional(),
          sequence: z.number(),
        })
        .nullable()
        .catch(null)
        .parse(ws.deserializeAttachment());

      return value?.kind === "broadcast" ? value : null;
    } catch {
      return null;
    }
  }

  private broadcastSockets(): WebSocket[] {
    try {
      return (this.state.getWebSockets?.() ?? []).filter(
        (ws) => ws.readyState === WebSocket.OPEN && this.broadcastAttachment(ws),
      );
    } catch {
      return [];
    }
  }

  /** Capture before queueing so rapid moves cannot overwrite one another. */
  protected queueBroadcastState(sockets = this.broadcastSockets(), snapshot = false): void {
    const state = this.gameState;

    if (!state || state.broadcastAllowed !== true || sockets.length === 0) return;

    if (this.broadcastPending >= 64) {
      for (const ws of sockets) ws.close(1013, "Broadcast overloaded; resynchronize");

      return;
    }

    const payload = this.buildBroadcastView();
    const ended = state.status === "ended";
    this.broadcastPending++;
    this.broadcastQueue = this.broadcastQueue
      .then(async () => {
        for (const ws of sockets) {
          if (ws.readyState !== WebSocket.OPEN) continue;
          const attachment = this.broadcastAttachment(ws)!;
          attachment.sequence++;
          ws.serializeAttachment(attachment);
          ws.send(
            JSON.stringify({
              type: snapshot ? "snapshot" : "state",
              sequence: attachment.sequence,
              connectionId: attachment.connectionId,
              state: payload,
            }),
          );

          if (ended) ws.close(1000, "Game ended");
        }
      })
      .catch(() => {
        for (const ws of sockets) {
          try {
            ws.close(1011, "Broadcast unavailable");
          } catch {
            /* closed */
          }
        }
      })
      .finally(() => {
        this.broadcastPending--;
      });
    this.state.waitUntil?.(this.broadcastQueue);
  }

  /** Broadcast projected `state` to every connected player. */
  protected broadcastState(): void {
    if (!this.gameState) return;
    this.queueBroadcastState();
    this.restoreSessions();

    for (const [ws, player] of this.sessions) {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendTo(ws, {
          type: "state",
          payload: this.buildClientView(player.id),
        });
      }
    }
  }

  /**
   * Broadcast game_started / game_ended with per-player projected state.
   */
  protected broadcastProjected(
    type: "game_started" | "game_ended",
    extra?: { reason?: string },
  ): void {
    if (!this.gameState) return;

    if (type === "game_ended" && this.terminalBroadcastSent) return;
    this.queueBroadcastState();
    this.restoreSessions();

    if (type === "game_ended") {
      this.initializeFinalDeliveryRecipients();
    }

    const rewatch = type === "game_ended" ? this.buildRewatchPayload() : null;

    for (const [ws, player] of this.sessions) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const view = this.buildClientView(player.id);

      if (type === "game_started") {
        this.sendTo(ws, {
          type: "game_started",
          payload: { state: view, ...extra },
        });
      } else {
        this.sendTo(ws, {
          type: "game_ended",
          payload: {
            finalState: view,
            reason: isString(extra?.reason) && extra.reason ? extra.reason : "ended",
            ...extra,
            rewatch: rewatch!,
          },
        });
      }
    }

    if (type === "game_ended") {
      this.terminalBroadcastSent = true;
    }

    if (type === "game_ended" && !this.endedCleanupTimer) {
      // Browser and agent clients acknowledge after copying the final payload.
      // This timer is the fallback for disconnected or older clients.
      const deliveryDeadline = this.gameState.updatedAt + FINAL_STATE_DELIVERY_GRACE_MS;

      void this.state.storage.setAlarm(deliveryDeadline);
      this.endedCleanupTimer = setTimeout(
        () => {
          this.endedCleanupTimer = null;

          if (this.gameState?.status === "ended") {
            void this.cleanup("Final-state delivery grace elapsed");
          }
        },
        Math.max(0, deliveryDeadline - Date.now()),
      );
    }

    if (type === "game_ended") {
      this.maybeCleanupAfterFinalDelivery("Final state delivered");
    }
  }

  protected sendTo(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error("Send error:", error);
    }
  }

  private archiveEndReason(events: GameEventRecord[], fallback: string): string {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];

      if (event?.type !== "game_ended") continue;
      const reason = this.asProjectionPart(event.summary)?.reason;

      if (isString(reason) && reason) return reason;
    }

    return fallback;
  }

  /**
   * Upload one gzip JSON object to R2 and index it in D1. The room retains its
   * DO state until this succeeds, making cleanup and alarm retries idempotent.
   */
  private queueCompletedGameArchive(
    reason: string,
    rewatch = this.buildRewatchPayload(),
  ): Promise<boolean> {
    if (this.archivePersist) return this.archivePersist;

    if (!this.gameState) return Promise.resolve(true);

    const events = this.readEventRows();

    const started =
      events.some((event) => event.type === "game_started") ||
      this.gameState.turnState.turnNumber > 0;

    if (!started) return Promise.resolve(true);

    const db = this.env?.DB;
    const bucket = this.env?.GAME_LOGS;

    // Unit harnesses intentionally omit external bindings. In a configured
    // runtime, having only one binding is an error and must retain the outbox.
    if (!db && !bucket) return Promise.resolve(true);

    if (!db || !bucket) {
      console.error(`${this.roomLabel}: incomplete game-log bindings`);
      logEvent("archive_failed", { stage: "bindings", roomType: this.gameState.type });

      return Promise.resolve(false);
    }

    const archive = buildCompletedGameArchive(
      structuredClone(this.gameState),
      events,
      structuredClone(rewatch),
      this.archiveEndReason(events, reason),
    );

    const task = persistCompletedGameArchive({ DB: db, GAME_LOGS: bucket }, archive)
      .then(() => true)
      .catch((error) => {
        console.error(`${this.roomLabel}: game-log archive failed`, error);
        logEvent("archive_failed", {
          stage: "persist",
          roomType: archive.document.gameType,
          gameId: archive.document.gameId,
          endReason: archive.document.endReason,
          events: archive.document.events.length,
        });

        return false;
      });

    this.archivePersist = task;
    const waitUntil = this.state.waitUntil?.bind(this.state);

    if (waitUntil) waitUntil(task);

    return task;
  }

  /**
   * Applies the room-lifetime policy without extending it on activity.
   *
   * A waiting lobby is reclaimed at `createdAt + lobbyMs`. Once the match has
   * started, the deadline is anchored at the match start so lobby waiting time
   * cannot shorten a long game.
   */
  private applyRoomLifetimePolicy(): number | null {
    if (!this.gameState) return null;

    const lifecycle = gameLifecycle(this.gameState.type);
    const playStartedAt = this.gameState.playStartedAt;
    const playing = this.gameState.status === "playing" && playStartedAt !== undefined;

    const lobbyExpiresAt = this.gameState.createdAt + lifecycle.lobbyMs;

    // A match only ever extends the room: starting late must not shorten the
    // lobby deadline, and a long match must not be cut by it.
    const expiresAt = playing
      ? Math.max(
          lobbyExpiresAt,
          playStartedAt +
            Math.min(this.gameState.timerConfig.gameTotalTime, lifecycle.playingMs) +
            MATCH_END_GRACE_MS,
        )
      : lobbyExpiresAt;

    this.gameState.expiresAt = expiresAt;
    this.gameState.timerConfig.gameTotalTime = Math.min(
      this.gameState.timerConfig.gameTotalTime,
      lifecycle.playingMs,
    );
    this.gameState.gameTimeRemaining = Math.min(
      this.gameState.gameTimeRemaining,
      this.gameState.timerConfig.gameTotalTime,
    );

    return expiresAt;
  }

  /**
   * Keep the D1 room directory in step with a phase change. The row is released
   * by exact expiry during cleanup, so the two timestamps must always match.
   */
  private async extendDirectoryExpiry(): Promise<void> {
    const game = this.gameState;
    const gameType = game ? normalizeGameType(game.type) : null;

    if (!game || !gameType || !this.env.DB) return;

    const roomId = roomIdFor(gameType, game.roomCode);

    try {
      const result = await extendRoomCode(this.env.DB, game.roomCode, roomId, game.expiresAt);

      // "current" means an earlier attempt (or a newer room) already covers this
      // deadline; only a missing row needs repair.
      if (result !== "missing") return this.clearDirectoryPending();

      const existing = await readRoomCode(this.env.DB, game.roomCode);

      if (existing && existing.roomId !== roomId) {
        // Another live room owns this code now; never republish someone else's row.
        logEvent("room_directory_conflict", { roomType: game.type });

        return this.clearDirectoryPending();
      }

      // An active row is already past this repair; nothing left to do.
      if (existing?.status === "active") return this.clearDirectoryPending();

      if (!existing) {
        const reservation = await reserveRoomCode(
          this.env.DB,
          gameType,
          game.roomCode,
          game.expiresAt,
        );

        // A lost race to reserve means the next save starts over from a fresh read.
        if (!reservation) throw new Error("Room code reservation was taken by another room");
      }

      // Finish an activation that an earlier failure left half done, or activate
      // the reservation taken just above.
      await activateRoomCode(this.env.DB, game.roomCode, roomId, game.expiresAt);
      logEvent("room_directory_repaired", {
        roomType: game.type,
        stage: existing ? "activate" : "reserve",
      });

      return this.clearDirectoryPending();
    } catch (error) {
      // A stale directory row hides a live room from /rooms/join. Keep playing and
      // retry on the next save so a short D1 outage heals itself.
      console.error(`${this.roomLabel}: room directory extension failed`, error);
      logEvent("room_directory_failed", { stage: "extend", roomType: game.type });
      this.directoryExpiryPending = true;
      await this.state.storage.put(DIRECTORY_PENDING_KEY, true);
    }
  }

  private async clearDirectoryPending(): Promise<void> {
    if (!this.directoryExpiryPending) return;

    this.directoryExpiryPending = false;
    await this.state.storage.put(DIRECTORY_PENDING_KEY, false);
  }

  /** Persist a newly created room and start its inactivity deadline. */
  private async saveCreatedStateAndScheduleExpiry(
    meaningfulActivityAt = Date.now(),
  ): Promise<void> {
    this.applyRoomLifetimePolicy();
    await this.saveState();
    await this.markMeaningfulActivity(meaningfulActivityAt);
  }

  /** Renew only for real room progress, never reads, waits, or timer ticks. */
  private async markMeaningfulActivity(at = Date.now()): Promise<void> {
    if (!this.gameState || this.gameState.status === "ended") return;
    this.lastMeaningfulActivityAt = at;
    await this.state.storage.put("lastMeaningfulActivityAt", this.lastMeaningfulActivityAt);
    await this.scheduleNextRoomAlarm();
  }

  private jevMember(): BasePlayerInfo | undefined {
    return [...(this.gameState?.players ?? []), ...(this.gameState?.spectators ?? [])].find(
      (member) => member.hostedAgent === "jev",
    );
  }

  private async manageJev(add: boolean): Promise<string | void> {
    const state = this.gameState!;

    if (!JEV_GAMES.has(state.type)) return "Jev is not available for this game";
    const existing = this.jevMember();

    if (!add) {
      if (!existing) return "Jev is not in this room";
      state.players = state.players.filter((member) => member.id !== existing.id);
      state.spectators = state.spectators?.filter((member) => member.id !== existing.id);
      this.jev = null;
    } else {
      if (existing) return "Only one Jev player is allowed per room";

      if (state.players.length >= state.maxPlayers) return "No player seat is available";
      const hostId = state.hostId;
      const ownerId = await this.broadcastHostOwner();

      if (!ownerId) return "A signed-in host is required to add Jev";
      const credential = await getJevCredential(this.env, ownerId);

      if (!credential && !this.env.TYPESAFE_API_KEY)
        return "Connect TypeSafe in Profile settings to add Jev";

      if (!credential && !(await hasSponsoredJevTrial(this.env, ownerId))) {
        return "Your free Jev game has been used. Connect TypeSafe in Profile settings to keep playing";
      }

      // Another request may have filled a seat, added Jev, or started the match.
      if (
        this.gameState !== state ||
        state.hostId !== hostId ||
        state.status !== "waiting" ||
        this.jevMember() ||
        state.players.length >= state.maxPlayers
      )
        return "The lobby changed; try again";
      const playerId = crypto.randomUUID();
      this.jev = {
        playerId,
        ownerId,

        calls: 0,
        attempts: 0,
        retryAt: 0,
        status: "ready",
      };

      if (credential) this.jev.credentialId = credential.id;

      if (state.type === "battleship") this.jev.fleets = generateJevFleets();
      state.players.push({
        id: playerId,
        name: "Jev",
        codename: "Jev",
        isAgent: true,
        environmentLabel: "TypeSafe",
        hostedAgent: "jev",
      });
    }

    // Roster and private controller must survive a restart together.
    await this.state.storage.put({ gameState: state, jevSeat: this.jev });
    state.updatedAt = Date.now();
    await this.saveState();
    this.broadcastState();
  }

  /** Games can hold MCP and hosted decisions until a server-owned transition is ready. */
  protected agentDecisionReadyAt(): number {
    return 0;
  }

  private isAgentTurnReady(playerId: string): boolean {
    return Date.now() >= this.agentDecisionReadyAt() && this.isYourTurn(playerId);
  }

  private pendingJevDecision() {
    const state = this.gameState;
    const seat = this.jev;

    if (
      !state ||
      state.status !== "playing" ||
      !seat ||
      !state.players.some((p) => p.id === seat.playerId && p.hostedAgent === "jev") ||
      Date.now() < this.agentDecisionReadyAt() ||
      !this.isYourTurn(seat.playerId)
    )
      return null;

    const decision = jevDecision(
      parseJevView(compactAgentDecisionState(this.buildAgentView(seat.playerId))),
      seat.fleets,
    );

    if (!decision) return null;

    // Clocks inform the model but ticking alone must not invalidate an in-flight answer.
    const {
      gameTimeRemaining: _gameClock,
      turnTimeRemaining: _turnClock,
      ...position
    } = decision.state;

    const key = JSON.stringify([state.turnState.startedAt, { ...decision, state: position }]);

    return { decision, key, seat };
  }

  private nextJevAlarm(now: number): number {
    if (this.jevInFlight) return Infinity;
    const readyAt = this.agentDecisionReadyAt();

    if (this.jev && readyAt > now) return readyAt;
    const pending = this.pendingJevDecision();

    if (!pending || pending.seat.status === "limit_reached") return Infinity;

    if (pending.key !== pending.seat.decisionKey) return now + 100;

    return pending.seat.attempts < 2 && pending.seat.status === "retrying"
      ? Math.max(now + 100, pending.seat.retryAt)
      : Infinity;
  }

  /** Event-driven adapter: one model-selected intent for the current decision. */
  private async runJevDecision(): Promise<void> {
    if (this.jevInFlight) return;
    const pending = this.pendingJevDecision();

    if (!pending) return;
    const { decision, key, seat } = pending;

    if (seat.status === "limit_reached") return;

    if (
      seat.decisionKey === key &&
      (seat.status !== "retrying" || seat.attempts >= 2 || seat.retryAt > Date.now())
    )
      return;
    this.jevInFlight = true;

    try {
      if (seat.decisionKey !== key) {
        seat.decisionKey = key;
        seat.attempts = 0;
      }

      seat.attempts++;
      seat.status = "thinking";
      // Persist before sending so isolate restarts cannot duplicate a paid attempt.
      await this.state.storage.put("jevSeat", seat);
      await this.scheduleNextRoomAlarm();
      this.broadcastState();
      let requestEnv = this.env;

      if (seat.credentialId) {
        const credential = await getJevCredential(this.env, seat.ownerId);

        if (!credential || credential.id !== seat.credentialId) throw new JevError();
        requestEnv = {
          ...this.env,
          TYPESAFE_API_KEY: await decryptJevKey(this.env, seat.ownerId, credential),
        };
      }

      const action = await chooseJev(requestEnv, decision, async () => {
        if (this.pendingJevDecision()?.key !== key) throw new JevError();

        if (
          seat.credentialId
            ? seat.calls >= 2000 ||
              !(await reservePersonalJevCall(this.env, seat.ownerId, seat.credentialId))
            : seat.calls >= 200 || !(await reserveJevCall(this.env, seat.ownerId))
        ) {
          seat.status = "limit_reached";
          throw new JevLimitError();
        }

        seat.calls++;
        await this.state.storage.put("jevSeat", seat);

        if (this.pendingJevDecision()?.key !== key) throw new JevError();
      });

      // A human action, timeout, departure or room end may occur during the fetch.
      if (this.pendingJevDecision()?.key !== key) return;
      const player = this.jevMember();

      if (!player) return;
      seat.status = "ready";

      const rejection = await this.dispatchAction(
        { ...player, isConnected: true, joinedAt: Date.now() },
        action,
      );

      if (rejection) seat.status = "unavailable";
    } catch (error) {
      if (!(error instanceof JevLimitError))
        seat.status =
          error instanceof JevError && error.retryable && seat.attempts < 2
            ? "retrying"
            : "unavailable";
      seat.retryAt = Date.now() + 2000;
      // Never log provider bodies, the projected hand, or credentials.
    } finally {
      this.jevInFlight = false;

      if (this.gameState && this.jev === seat) {
        await this.state.storage.put("jevSeat", seat);
        this.broadcastState();
        await this.scheduleNextRoomAlarm();
      }
    }
  }

  /** Wake for the next turn, match, inactivity, hosted decision, or room deadline. */
  private async scheduleNextRoomAlarm(): Promise<void> {
    if (!this.gameState || this.gameState.status === "ended") return;
    const expiresAt = this.applyRoomLifetimePolicy();

    if (expiresAt === null) return;

    const lastMeaningfulActivityAt =
      this.lastMeaningfulActivityAt ||
      this.gameState?.updatedAt ||
      this.gameState?.createdAt ||
      Date.now();

    const running = this.gameState?.status === "playing" ? this.gameState : null;
    const now = Date.now();

    const alarmAt = Math.min(
      expiresAt,
      this.nextJevAlarm(now),
      ...(running
        ? [
            now +
              Math.max(
                0,
                running.gameTimeRemaining - Math.max(0, now - (this.lastGameTimerTickAt || now)),
              ),
            now +
              Math.max(
                0,
                running.turnState.turnTimeRemaining +
                  TURN_EXPIRY_GRACE_MS -
                  Math.max(0, now - (this.lastTurnTimerTickAt || now)),
              ),
          ]
        : []),
      lastMeaningfulActivityAt + ROOM_INACTIVITY_MS,
    );

    await this.state.storage.setAlarm(alarmAt);
  }

  /** End and purge a room whose players made no meaningful progress for five minutes. */
  private async expireInactiveRoom(): Promise<void> {
    if (!this.gameState || this.gameState.status === "ended") return;
    logEvent("room_lifecycle", {
      phase: this.gameState.status,
      reason: "room_inactive",
      roomType: this.gameState.type,
      players: this.gameState.players.length,
    });
    this.gameState.status = "ended";
    this.gameState.turnState.phase = "ended";
    this.gameState.turnState.currentPlayerId = null;
    this.gameState.updatedAt = Date.now();
    this.stopTimers();
    this.recordEvent("game_ended", { reason: "room_inactive" });
    await this.saveState();
    this.broadcastProjected("game_ended", { reason: "room_inactive" });
  }

  /**
   * Persists the current game state to Durable Object storage.
   * No-ops if `gameState` is `null`.
   *
   * @returns {Promise<void>}
   */
  private async broadcastHostOwner(): Promise<string | null> {
    const state = this.gameState;

    if (!state || !this.env.DB) return null;

    const agent = await this.env.DB.prepare(`SELECT s.owner_user_id FROM mcp_room_players p
      JOIN mcp_agent_seats s ON s.id = p.agent_id WHERE p.player_id = ? LIMIT 1`)
      .bind(state.hostId)
      .first<{ owner_user_id: string }>();

    return agent?.owner_user_id ?? state.hostId;
  }

  protected async captureBroadcastPermission(): Promise<void> {
    if (this.gameState) this.gameState.broadcastAllowed = false;
  }

  /** Clear legacy permission when a persisted room resumes. */
  protected async restoreBroadcastPermission(): Promise<void> {
    if (!this.gameState || this.gameState.broadcastAllowed === false) return;
    this.gameState.broadcastAllowed = false;
    await this.state.storage.put("gameState", this.gameState);
  }

  protected async saveState(): Promise<void> {
    if (!this.gameState) return;
    this.syncRunningTimers(Date.now());
    this.gameState.updatedAt = Date.now();

    // State, its request receipts and the directory-repair marker travel in one
    // write, so a crash can never persist a move without its receipt.
    const entries = {
      gameState: this.gameState,
      ackedActionRecords: [...this.ackedActions.values()],
      directoryExpiryPending: this.directoryExpiryPending,
    };

    await this.state.storage.put(entries);

    // Persist a wake-up for the next decision/match deadline as well as expiry.
    // Local setInterval callbacks alone do not survive an isolate restart.
    if (this.gameState.status !== "ended") await this.scheduleNextRoomAlarm();

    // A directory row that lagged behind this room catches up on the next save.
    if (this.directoryExpiryPending) await this.extendDirectoryExpiry();
  }

  /**
   * Stops all timers, closes every open WebSocket connection gracefully (code 1000),
   * clears the sessions map, and deletes all Durable Object storage.
   * Called internally when a game ends or all players leave.
   *
   * @returns {Promise<void>}
   */
  private async cleanup(closeReason = "Game ended"): Promise<void> {
    this.stopTimers();

    if (this.gameState?.status === "ended" && !this.terminalBroadcastSent) {
      const reason = this.archiveEndReason(this.readEventRows(), closeReason);
      this.broadcastProjected("game_ended", { reason });

      return;
    }

    if (this.endedCleanupTimer) {
      clearTimeout(this.endedCleanupTimer);
      this.endedCleanupTimer = null;
    }

    this.restoreSessions();

    const directoryGameType = this.gameState ? normalizeGameType(this.gameState.type) : null;

    const directoryRoom =
      this.gameState && directoryGameType
        ? {
            expiresAt: this.gameState.expiresAt,
            roomCode: this.gameState.roomCode,
            roomId: roomIdFor(directoryGameType, this.gameState.roomCode),
          }
        : null;

    if (this.gameState?.status === "ended") {
      // Persist the terminal snapshot before yielding to R2/D1. If the isolate
      // resets during external I/O, construction will restore this outbox and
      // schedule an immediate archive retry instead of reviving live play.
      await this.saveState();

      try {
        if (this.env.DB && directoryRoom) {
          const snapshot = broadcastProjection(
            this.projectStateFor("", this.gameState),
            this.gameState.players,
          );

          await this.env.DB.prepare(`UPDATE broadcast_rooms SET summary = ?, snapshot = ?, expires_at = ?
            WHERE room_id = ? AND created_at = ? AND snapshot IS NULL`)
            .bind(
              JSON.stringify({
                type: this.gameState.type,
                status: "ended",
                players: snapshot.players,
              }),
              JSON.stringify(snapshot),
              Date.now() + 900_000,
              directoryRoom.roomId,
              this.gameState.createdAt,
            )
            .run();
          await this.env.DB.prepare("DELETE FROM broadcast_rooms WHERE expires_at <= ?")
            .bind(Date.now())
            .run();
        }
      } catch (error) {
        console.error(`${this.roomLabel}: final broadcast snapshot failed; retrying`, error);
        logEvent("archive_failed", { stage: "directory", roomType: this.gameState.type });
        await this.state.storage.setAlarm(Date.now() + 60_000);

        return;
      }

      const archived = await this.queueCompletedGameArchive(closeReason);

      if (!archived) {
        this.archivePersist = null;
        await this.state.storage.setAlarm(Date.now() + 60_000);

        return;
      }

      if (!(await this.reportSeriesResult(closeReason))) {
        await this.state.storage.setAlarm(Date.now() + 5000);

        return;
      }
    }

    await this.broadcastQueue;

    for (const ws of this.broadcastSockets()) ws.close(1000, "Game ended");

    for (const [ws] of this.sessions) {
      try {
        ws.close(1000, closeReason);
      } catch {
        /* ignore */
      }
    }

    this.sessions.clear();

    // Make the room unavailable before yielding on storage I/O. Any concurrent
    // request now sees a missing room and cannot enqueue a save that resurrects it.
    this.gameState = null;
    this.jev = null;
    this.eventSeq = 0;
    this.rewatchFrameSeq = 0;
    this.fallbackEventRows = [];
    this.fallbackRewatchRows = [];
    this.lastRewatchSerialized = "";
    this.pendingRewatchAcks = null;
    this.pendingAgentFinalAcks = null;
    this.terminalBroadcastSent = false;
    this.terminalResponseHolds = 0;
    this.archivePersist = null;
    this.ackedActions.clear();
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
    this.historyReady = false;

    if (directoryRoom && this.env.DB) {
      try {
        await releaseRoomCode(
          this.env.DB,
          directoryRoom.roomCode,
          directoryRoom.roomId,
          directoryRoom.expiresAt,
        );
      } catch (error) {
        console.error("Failed to release active room code", error);
        logEvent("room_directory_failed", { stage: "release", roomType: directoryGameType });
      }
    }
  }

  /**
   * Ends the current game session gracefully.
   * Sets the game status to `ended`, stops timers, broadcasts `game_ended`,
   * and lets the final-delivery barrier close sockets and purge storage.
   *
   * @returns {Promise<void>}
   */
  /** Retry before room deletion so an interrupted callback cannot lose a result. */
  private async reportSeriesResult(fallbackReason: string): Promise<boolean> {
    const game = this.gameState;

    if (!game?.series || game.series.reported) return true;
    const series = game.series;
    const reason = this.archiveEndReason(this.readEventRows(), fallbackReason);
    const winner = "winner" in game ? game.winner : undefined;
    const events = this.readEventRows();

    try {
      const response = await this.env.GAME_SERIES.get(
        this.env.GAME_SERIES.idFromName(`series-${series.code}`),
      ).fetch("https://series.internal/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roomId: roomIdFor(normalizeGameType(game.type)!, game.roomCode),
          result: {
            index: series.index,
            gameType: game.type,
            gameId: game.id,
            firstParticipantId: null,
            winnerId: isString(winner) && winner !== "draw" ? winner : null,
            outcome:
              series.aborted || ["room_inactive", "room_expired"].includes(reason)
                ? "aborted"
                : isString(winner) && winner !== "draw"
                  ? "win"
                  : "draw",
            reason,
            startedAt: events.find((event) => event.type === "game_started")?.at ?? game.createdAt,
            endedAt:
              [...events].reverse().find((event) => event.type === "game_ended")?.at ??
              game.updatedAt,
            metrics: Object.fromEntries(
              Object.entries(series.metrics).map(([id, metric]) => [
                id,
                {
                  actions: metric.actions,
                  decisionMs: metric.decisionMs,
                  timeouts: metric.timeouts,
                },
              ]),
            ),
          },
        }),
      });

      if (!response.ok || !(await response.json<{ ok: boolean }>()).ok) return false;
      series.reported = true;
      await this.saveState();

      return true;
    } catch {
      return false;
    }
  }

  /** The coordinator's chosen seat replaces randomness only in series rooms. */
  protected startingPlayerIndex(): number {
    const game = this.gameState!;

    return game.series
      ? Math.max(
          0,
          game.players.findIndex((p) => p.id === game.series!.firstPlayerId),
        )
      : randomInt(game.players.length);
  }

  protected async endGame(): Promise<void> {
    if (!this.gameState) return;

    this.gameState.status = "ended";
    this.gameState.turnState.phase = "ended";
    this.gameState.turnState.currentPlayerId = null;
    this.gameState.updatedAt = Date.now();
    this.stopTimers();

    this.recordEvent("game_ended", { reason: "Game completed" });
    await this.saveState();
    this.broadcastProjected("game_ended", { reason: "Game completed" });
  }
}
