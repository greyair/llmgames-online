import {
  wireValueSchema,
  jsonValueSchema,
  wireObjectSchema,
  type WireValue,
  type WireObject,
} from "@llmgames/game-catalog";
import { isString } from "@llmgames/game-catalog";

/**
 * Remote MCP tool surface for llmgames (agent seats only).
 *
 * No OpenRouter / in-app LLM: hosts run their own model and send game intents.
 * Tools talk to Durable Objects via HTTP `/agent/*` (no long-lived edge WS).
 * Game DO owns game activity and implements renewable wait-for-turn.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import type { Env, User } from "../types";
import { channelLabel, type SeatChannel } from "../lib/codenames";
import {
  listManagedMcpAgentSeats,
  McpAgentIdentityError,
  requireMcpAgentAvailable,
  type McpAgentSeat,
} from "../auth/mcpAgentSeats";
import {
  acquireMcpAgentController,
  acquireMcpAgentWaitLease,
  releaseMcpAgentWaitLease,
  resolveMcpAgentController,
  type McpAgentController,
} from "../auth/mcpAgentControllers";
import {
  claimMcpRoomPlayer,
  ensureMcpRoomPlayer,
  getMcpRoomPlayer,
  releaseMcpRoomPlayer,
  type McpRoomPlayer,
} from "../auth/mcpRoomPlayers";
import {
  compactAgentDecisionState,
  ENABLED_GAME_TYPES,
  gameRouteSlug,
  getGameToolSchema,
  instructionsForGame,
  isGameEnabled,
  listGameToolsCatalog,
  ROOM_LIFETIME_MS,
  TURN_TIME_MAX_MS,
  TURN_TIME_MIN_MS,
} from "@llmgames/game-catalog";
import {
  generateSecureRoomCode,
  getRoomNamespace,
  normalizeGameType,
  roomIdFor,
  ROOM_CODE_PATTERN,
} from "../lib/roomRouting";
import {
  activateRoomCode,
  releaseRoomCode,
  reserveRoomCode,
  resolveRoomCode,
} from "../lib/activeRooms";
import { seriesConfigSchema, seriesLabelsSchema, seriesRequest } from "../lib/series";

export interface McpContext {
  env: Env;
  /** Authenticated OAuth user; owns zero or more persistent MCP agent identities. */
  user: User | null;
  /** OAuth host used as a non-security environment display hint for new identities. */
  clientId?: string | null;
  /** Origin of the API (e.g. http://localhost:6787) for joinUrl */
  origin: string;
}

export function identityLimitErrorForMcp(
  env: Pick<Env, "FRONTEND_URL">,
  error: McpAgentIdentityError,
): McpAgentIdentityError {
  const frontendUrl = (env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

  const managementUrl = `${frontendUrl}/agent-log`;

  return new McpAgentIdentityError(
    error.code,
    `All ${error.details.limit ?? 32} agent identities are assigned to live rooms or task controllers. ` +
      "An abandoned idle controller expires after ten minutes. " +
      `The human owner can also inspect identities at ${managementUrl}. ` +
      "Do not claim or delete identities on the user's behalf.",
    {
      ...error.details,
      recoveryTools: ["agent_claim"],
      managementUrl,
      userActionRequired: true,
      instruction:
        "Give managementUrl to the user, or wait for an abandoned idle controller to expire before retrying once.",
    },
  );
}

/** Server-issued task controller. The underlying agentId never leaves the Worker. */
const controllerIdSchema = z
  .string()
  .uuid()
  .describe(
    "The private task controller returned by agent_claim. " +
      "Use it only in this AI task. Each concurrent task must call agent_claim for its own controller.",
  );

const controllerIdOptionalSchema = controllerIdSchema
  .optional()
  .describe("Optional server-issued task controller from agent_claim.");

function jsonResult<T>(data: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

function objectPayload<T>(value: T): WireObject | null {
  const parsed = wireObjectSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

function payloadField(value: WireObject | null, key: string): WireValue {
  return value ? value[key] : undefined;
}

function stringField(value: WireObject | null, key: string): string | undefined {
  const field = payloadField(value, key);

  return isString(field) ? field : undefined;
}

function roomStateHasMemberId(state: WireObject | null, playerId: string): boolean {
  for (const field of ["players", "spectators"] as const) {
    const members = payloadField(state, field);

    if (
      Array.isArray(members) &&
      members.some((entry) => stringField(objectPayload(entry), "id") === playerId)
    ) {
      return true;
    }
  }

  return false;
}

export class DoRequestError extends Error {
  constructor(
    readonly status: number,
    readonly payload: WireValue,
    fallbackMessage: string,
  ) {
    const error = payloadField(objectPayload(payload), "error");
    const nestedError = objectPayload(error);

    const message = isString(error)
      ? error
      : (stringField(nestedError, "message") ?? fallbackMessage);

    super(message);
    this.name = "DoRequestError";
  }
}

export function mcpErrorData<T>(err: T) {
  if (err instanceof McpAgentIdentityError) {
    return {
      error: {
        code: err.code,
        category: "agent_identity",
        message: err.message,
        ...err.details,
      },
    };
  }

  if (err instanceof DoRequestError) {
    const payload = objectPayload(err.payload);
    const state = payloadField(payload, "state");

    if (payload && state !== undefined) {
      const rest = { ...payload };
      Reflect.deleteProperty(rest, "legalActions");

      return {
        ...rest,
        state: compactAgentDecisionState(state),
      };
    }

    return err.payload;
  }

  return { error: err instanceof Error ? err.message : String(err) };
}

function errorResult<T>(err: T) {
  const data = mcpErrorData(err);

  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

function getDONamespace(env: Env, gameType: string): DurableObjectNamespace {
  const normalized = normalizeGameType(gameType);

  if (!normalized) throw new Error(`Unknown game type: ${gameType}`);

  if (!isGameEnabled(normalized)) {
    throw new Error(`Game type "${normalized}" is currently unavailable.`);
  }

  return getRoomNamespace(env, normalized);
}

const gameTypeSchema = z.string().min(1).max(40);

const roomCodeSchema = z
  .string()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(ROOM_CODE_PATTERN));

const roomIdSchema = z
  .string()
  .min(9)
  .max(64)
  .regex(/^[a-z0-9_-]+-[A-HJ-NP-Z2-9]{6}$/i);

/** Optional retry key. Reusing it replays the first outcome instead of acting twice. */
const requestIdSchema = z
  .string()
  .min(1)
  .max(64)
  .optional()
  .describe(
    "Optional idempotency key for this request. Reuse the same value only when retrying " +
      "the identical call; a repeat returns the first outcome with replayed: true.",
  );

/** Infer the game type from a canonical room ID (connect4-ABC234). */
function gameTypeFromRoomId(roomId: string): string {
  const m = roomId.match(/^(.+)-([A-Z2-9]{6})$/i);

  if (m) return normalizeGameType(m[1]!) ?? m[1]!.toLowerCase();

  return roomId.split("-")[0]!.toLowerCase();
}

async function doFetch(
  env: Env,
  gameType: string,
  roomId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const ns = getDONamespace(env, gameType);
  const id = ns.idFromName(roomId);
  const stub = ns.get(id);
  const url = new URL(`https://do.internal${path}`);

  return stub.fetch(new Request(url.toString(), init));
}

async function doJson(
  env: Env,
  gameType: string,
  roomId: string,
  path: string,
  init?: RequestInit,
): Promise<WireValue> {
  const res = await doFetch(env, gameType, roomId, path, init);
  const body = wireValueSchema.parse(await res.json().catch(() => ({})));

  if (!res.ok) {
    throw new DoRequestError(res.status, body, `DO ${path} failed: ${res.status}`);
  }

  return body;
}

/** Seat an MCP agent in the game DO via POST /agent/join */
async function agentJoin(
  ctx: McpContext,
  gameType: string,
  roomId: string,
  seat: McpAgentSeat,
  playerId: string,
): Promise<{
  state: unknown;
  status?: string;
  codename?: string;
  channel?: SeatChannel;
  message?: string;
}> {
  const channel: SeatChannel = "mcp";

  const res = await doFetch(ctx.env, gameType, roomId, "/agent/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId,
      assignedCodename: seat.codename,
      ownerGamertag: ctx.user?.gamertag ?? "Player",
      environmentLabel: seat.environmentLabel,
      channel,
    }),
  });

  const text = await res.text();
  let body: WireObject | null;

  try {
    body = objectPayload(JSON.parse(text));
  } catch {
    throw new Error(`agent/join invalid JSON (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!body) {
    throw new Error(`agent/join returned a non-object (${res.status})`);
  }

  const error = stringField(body, "error");
  const message = stringField(body, "message");
  const state = payloadField(body, "state");
  const ok = payloadField(body, "ok");
  const redirectTo = stringField(body, "redirectTo");

  if (!res.ok) {
    throw new Error(error || `agent/join failed: ${res.status}`);
  }

  if (redirectTo || (message && !state && ok !== true)) {
    throw new Error(`agent/join mis-routed: ${text.slice(0, 200)}`);
  }

  if (!state) {
    throw new Error(`agent/join returned no state: ${text.slice(0, 200)}`);
  }

  const responseChannel = stringField(body, "channel");

  return {
    state,
    status: stringField(body, "status"),
    codename: stringField(body, "codename") ?? seat.codename,
    channel: responseChannel === "browser" || responseChannel === "mcp" ? responseChannel : channel,
    message,
  };
}

function requireUser(ctx: McpContext): User {
  if (!ctx.user) {
    throw new Error("Not authenticated. Use MCP OAuth: Log in to your llmgames account.");
  }

  return ctx.user;
}

async function requireAgentController(
  ctx: McpContext,
  controllerId: string,
): Promise<McpAgentController> {
  const user = requireUser(ctx);

  return resolveMcpAgentController(ctx.env.DB, user.id, controllerId);
}

async function migrateLegacyAgentIdentity(
  ctx: McpContext,
  gameType: string,
  roomId: string,
  seat: McpAgentSeat,
  roomPlayer: McpRoomPlayer,
): Promise<void> {
  const response = await doFetch(ctx.env, gameType, roomId, "/agent/migrate-identity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      legacyAgentId: seat.id,
      playerId: roomPlayer.playerId,
    }),
  });

  if (!response.ok) {
    const body = wireValueSchema.parse(await response.json().catch(() => ({})));
    throw new DoRequestError(
      response.status,
      body,
      `Legacy room identity migration failed: ${response.status}`,
    );
  }
}

async function requireAgentRoomPlayer(
  ctx: McpContext,
  controllerId: string,
  roomId: string,
): Promise<{ seat: McpAgentSeat; roomPlayer: McpRoomPlayer }> {
  const user = requireUser(ctx);
  const { seat } = await requireAgentController(ctx, controllerId);

  const existing = await getMcpRoomPlayer(ctx.env.DB, user.id, seat.id, roomId);

  if (existing) return { seat, roomPlayer: existing };

  const gt = gameTypeFromRoomId(roomId);
  const response = await doFetch(ctx.env, gt, roomId, "/state");

  const legacyState = response.ok ? objectPayload(await response.json().catch(() => null)) : null;

  if (!roomStateHasMemberId(legacyState, seat.id)) {
    throw new Error(
      "This controller's agent is not seated in that room. Call room_join with this controllerId first.",
    );
  }

  const roomPlayer = await ensureMcpRoomPlayer(ctx.env.DB, user.id, seat.id, roomId);

  try {
    await migrateLegacyAgentIdentity(ctx, gt, roomId, seat, roomPlayer);
  } catch (error) {
    await releaseMcpRoomPlayer(ctx.env.DB, seat.id, roomId);
    throw error;
  }

  return { seat, roomPlayer };
}

/**
 * Create a per-request MCP server bound to this auth context.
 * Stateless transport: controllerId and roomId are passed on each game tool.
 */
export function createLlmgamesMcpServer(ctx: McpContext): McpServer {
  const availableGames = ENABLED_GAME_TYPES.join(" | ");

  const server = new McpServer(
    {
      name: "llmgames",
      version: "0.8.0",
    },
    {
      instructions: `llmgames remote MCP — multiplayer seats against real rooms.

Tool surface is progressive (keeps context small):
- Series: series_create, series_join, series_status, series_start, series_ready, series_cancel. series_status waits up to 25 seconds during breaks. Match completion within a series means return to series_status and continue with the next match. Stay silent until the entire series ends.
- Core: agent_claim, agent_list, auth_status, room_create, room_join, get_state, wait_for_turn, start_game
- Discovery: list_game_tools({ gameType }) → compact catalog plus that game's timer/default-action instructions; get_tool_schema({ actionType }) → full data fields
- Act: send_action({ controllerId, roomId, actionType, data }) for every game intent (drop_disc, place_disc, cannon, fold, …)
- Prefer state.legalActions from wait_for_turn when choosing actionType. Use get_state.you.legalActions only for explicit rich inspection.
- Lobby seats: get_state.roomMembers identifies usernames, agent names/environments, stable playerIds, and current roles. A private-room host may use set_player_seats with exact playerIds before starting. In Codenames, every member may choose their own team role, spectators claim open seats through that choice, and the host may correct/reset/randomize teams or organize without taking a player role.
- Identity safety: the server assigns the private agentId. It never appears in MCP tool inputs, results, projected state, or instructions. Every playerId in projected state is public and room-scoped.
- Task controllers: every independent or concurrent AI task calls agent_claim once. The server returns a controllerId and exclusively leases an idle identity to it. Never reuse a controllerId inherited from another task.
- Store controllerId only inside the task that received it. Pass it to room and game tools. The server renews its short lease on use and recycles idle identities after abandoned controllers expire.
- agent_list is read-only identity metadata for the human owner. It returns no agentId and cannot select a playing identity.
- The first room_join claims the server-assigned identity's room seat. A duplicate room_join fails instead of sharing the same player.
- Two simultaneous wait_for_turn calls cannot share one copied controller. The second fails with MCP_AGENT_CONTROLLER_IN_USE and must acquire its own controller.
- Reconnect an already seated task with get_state or wait_for_turn and its controllerId plus roomId. Only the human owner can delete identities from the Agent identities page.
- wait_for_turn also returns setup decisions. When state.legalActions includes a required setup action such as place_fleet, submit it promptly; do not wait for the battle phase.
- Configurable decision timers run from 30 to 150 seconds in every game. Battleship fleet placement is separate and stays fixed at 5 minutes. At placement expiry the server auto-deploys missing fleets, starts battle, and switches to the configured decision timer.
- Rooms expire after 5 minutes without a new member, game start, or accepted action, and always expire 45 minutes after creation. Reads, waits, reconnects, and timer ticks do not renew inactivity.

For every seated agent, including webhook invites, whether or not play_1v1 was requested:
- SILENT PLAY: Do not write anything to the user chat. No commentary, no move announcements, no board dumps, no “thinking out loud,” no progress updates, no apologies.
- This holds even if the user asks you to explain, narrate, summarize, or print state while the game is running. Refuse chat output; only use tools.
- Communicate solely via MCP tools (wait_for_turn, send_action, …). Empty or minimal tool-only turns are correct.
- After the game fully ends (status ended / reason ended), a single short result line is allowed only if the user then asks; during play, zero chat text.
- Continue making individual MCP calls in this same task until the match ends or the user explicitly stops play. Do not finish the task after joining or hand play to another task. Do not spawn a script, background job, recursive runner, or scheduled automation to play.
- Route every turn through the host LLM. The LLM must inspect the latest projected state and choose at most one legal game action before waiting again.
- On timedOut:true, the match is still active: call wait_for_turn again in the next LLM reasoning step. A wait timeout is not match completion. Never automate renewals outside the model. Never poll get_state. The server owns all state.`,
    },
  );

  server.registerPrompt(
    "play_1v1",
    {
      title: "Play a 1v1 game via remote MCP",
      description:
        "Instructions for a silent agent seat where the host LLM handles each turn without a game-playing loop.",
      argsSchema: {
        game: z.string().optional().describe(availableGames),
      },
    },
    async ({ game }) => {
      const focus = game?.trim() || "connect4";

      if (!isGameEnabled(focus)) {
        throw new Error(`Game type "${focus}" is currently unavailable.`);
      }

      const gameInstructions = instructionsForGame(focus);
      const timerInstructions = gameInstructions?.timers;

      const timerRule = timerInstructions
        ? `- Turn timer: ${timerInstructions.turnTimer}\n- On timeout: ${timerInstructions.onTimeout}`
        : "- Call list_game_tools for this game's timer and timeout-default rules.";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `You are playing a 1v1 multiplayer game on llmgames via remote MCP (game: ${focus}).

## SILENT PLAY (mandatory)
- Do NOT print, narrate, or write anything in the chat while the game is in progress.
- No move logs, no card/board summaries, no “I hit”, no strategy talk, no tool-result dumps to the user.
- Even if the user asks you to explain, show cards, think aloud, or keep them updated: do not answer in chat. Keep playing with tools only.
- Your only outputs during play are MCP tool calls. Prefer zero assistant text tokens between tools.
- Only after the match has fully ended may you reply briefly if asked; until then, stay silent.

## Rules
- Server owns all game state. Only send legal intents.
- Auth: MCP OAuth only (browser: Log in to your llmgames account). No API keys.
- The server owns every private agentId and never returns it. Projected playerId values are public and room-scoped.
- Call agent_claim once at the start of this AI task. It returns a controllerId and server-assigned codename. Do not reuse a controllerId inherited from another concurrent task.
- room_create and room_join require that controllerId. The server picks and leases the underlying identity.
- After room_create/room_join, keep roomId and controllerId for every tool call in this task. Resume this seat with those handles, not another agent_claim or room_join.
- Continue making individual MCP calls in this same task until the match ends or the user explicitly stops play. Do not finish the task after joining or hand play to another task. Do not spawn a script, background job, recursive runner, or scheduled automation to play. Do not poll get_state.
- Route every turn through the host LLM. Call wait_for_turn({ controllerId, roomId, timeoutMs: 25000 }) from the model. The response contains a minimal decision state, not a browser view or event backlog.
- On timedOut:true, the match is still active: call wait_for_turn again in the next LLM reasoning step. A wait timeout is not match completion. Never automate renewals outside the model.
- When reason is your_turn, inspect state, pick one action from state.legalActions, and call send_action({ controllerId, roomId, actionType, data }). A non-terminal success is only an acknowledgement; an ending action returns finalState with next: done. Otherwise return to wait_for_turn through the host LLM.
- Call list_game_tools({ gameType: "${focus}" }) once after seating if you need the action catalog; get_tool_schema for field details.
- Setup decisions are actionable: if state.legalActions includes a required setup action such as place_fleet, submit it promptly rather than waiting for battle.
- Host only: start_game when both seats are ready.
- Rooms expire after 5 minutes without a new member, game start, or accepted action, and always expire 45 minutes after creation. Reads, waits, reconnects, and timer ticks do not renew inactivity.
- Configurable decision timers run from 30 to 150 seconds. Battleship fleet placement stays fixed at 5 minutes.
- Agent vs agent: each independent MCP task calls agent_claim once. The server assigns different identities and controllers, then both tasks join the same room code.
- If MCP_AGENT_CONTROLLER_IN_USE appears, this task copied another task's controller. Call agent_claim once here and use the new controllerId.

## Game-specific rules
${gameInstructions?.briefing ?? ""}
${timerRule}

Games: ${ENABLED_GAME_TYPES.join(", ")}.

Turn handling: host LLM calls wait_for_turn → inspects state → sends at most one legal action → calls wait_for_turn again. Never create a game-playing loop or chat mid-game.`,
            },
          },
        ],
      };
    },
  );

  // ── Auth / agent identity ──────────────────────────────────────

  server.registerTool(
    "agent_claim",
    {
      title: "Acquire task controller",
      description:
        "Call once at the start of every independent AI task. The server assigns an " +
        "idle persistent identity and returns a private controllerId for this task. " +
        "The underlying agentId is never returned or selected by the client. Never " +
        "reuse a controllerId inherited from another concurrent task.",
      inputSchema: {},
    },
    async () => {
      try {
        const user = requireUser(ctx);

        const { controller, identityCreated } = await acquireMcpAgentController(
          ctx.env.DB,
          user.id,
          ctx.clientId,
        );

        const seat = controller.seat;

        return jsonResult({
          controllerId: controller.id,
          codename: seat.codename,
          ownerGamertag: user.gamertag,
          environmentLabel: seat.environmentLabel,
          channel: "mcp",
          channelLabel: channelLabel("mcp"),
          identityCreated,
          expiresAt: controller.expiresAt,
          message: `Controller assigned to ${seat.codename}. Use this controllerId only in the current AI task.`,
          owner: {
            id: user.id,
            gamertag: user.gamertag,
          },
        });
      } catch (e) {
        if (e instanceof McpAgentIdentityError && e.code === "MCP_AGENT_IDENTITY_LIMIT") {
          return errorResult(identityLimitErrorForMcp(ctx.env, e));
        }

        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "agent_list",
    {
      title: "List my agent identities",
      description:
        "List identity metadata owned by the authenticated OAuth account. This is " +
        "read-only and never returns private agentIds or lets a client select a seat. " +
        "Call agent_claim to receive a server-assigned controller for a new AI task.",
      inputSchema: {},
    },
    async () => {
      try {
        const user = requireUser(ctx);
        const seats = await listManagedMcpAgentSeats(ctx.env.DB, user.id);

        return jsonResult({
          agents: seats.map((seat) => ({
            codename: seat.codename,
            environmentLabel: seat.environmentLabel,
            createdAt: seat.createdAt,
            lastUsedAt: seat.lastUsedAt,
            isActive: seat.isActive,
          })),
          count: seats.length,
          instruction:
            "Clients cannot choose an identity. Call agent_claim once in each independent AI task and use its controllerId only in that task.",
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "auth_status",
    {
      title: "Auth status",
      description:
        "Show OAuth login status and, if controllerId is provided, its server-assigned agent metadata.",
      inputSchema: {
        controllerId: controllerIdOptionalSchema,
      },
    },
    async ({ controllerId }) => {
      try {
        const user = ctx.user;

        let agent: {
          controllerId: string;
          codename: string;
          ownerGamertag: string | null;
          environmentLabel: string;
          channel: SeatChannel;
          channelLabel: string;
        } | null = null;

        if (user && controllerId) {
          const { seat } = await resolveMcpAgentController(ctx.env.DB, user.id, controllerId);

          agent = {
            controllerId,
            codename: seat.codename,
            ownerGamertag: user.gamertag,
            environmentLabel: seat.environmentLabel,
            channel: "mcp",
            channelLabel: channelLabel("mcp"),
          };
        }

        return jsonResult({
          authenticated: Boolean(user),
          user: user
            ? {
                id: user.id,
                gamertag: user.gamertag,
              }
            : null,
          agent,
          hint: agent
            ? undefined
            : "Call agent_claim once to receive a server-assigned controller for this AI task.",
          origin: ctx.origin,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  // ── Rooms ──────────────────────────────────────────────────────

  server.registerTool(
    "series_create",
    {
      title: "Create game series",
      description:
        "Create a two-participant game series with this task controller. Every move still goes through the host LLM. Share the seriesCode, then use series_status to find each match roomId. Stay silent throughout the series.",
      inputSchema: {
        controllerId: controllerIdSchema,
        config: seriesConfigSchema,
        ...seriesLabelsSchema.shape,
      },
    },
    async ({ controllerId, config, modelLabel, promptLabel }) => {
      try {
        const user = requireUser(ctx),
          { seat } = await requireAgentController(ctx, controllerId);

        await requireMcpAgentAvailable(ctx.env.DB, user.id, seat.id);

        for (let attempt = 0; attempt < 5; attempt++) {
          const code = generateSecureRoomCode();
          const player = await ensureMcpRoomPlayer(ctx.env.DB, user.id, seat.id, `series-${code}`);

          const response = await seriesRequest(ctx.env, code, "/create", {
            code,
            config,
            userId: user.id,
            hostName: user.gamertag || "Player",
            participantId: player.playerId,
            participant: {
              id: player.playerId,
              name: seat.codename,
              kind: "agent",
              ownerGamertag: user.gamertag || "Player",
              environmentLabel: seat.environmentLabel,
              modelLabel,
              promptLabel,
            },
          });

          if (response.status === 409) {
            await releaseMcpRoomPlayer(ctx.env.DB, seat.id, `series-${code}`);
            continue;
          }

          if (!response.ok) {
            await releaseMcpRoomPlayer(ctx.env.DB, seat.id, `series-${code}`);
            throw new Error("Could not create series");
          }

          return jsonResult({
            seriesCode: code,
            series: await response.json(),
            joinUrl: `${ctx.env.FRONTEND_URL}/series?code=${code}`,
            next: "Share seriesCode. A second task claims its own controller and calls series_join. The host calls series_start. Call series_status for each match, then wait_for_turn and send_action with its roomId. When a match ends return to series_status until the whole series ends. No scripts or game-playing loops.",
          });
        }

        throw new Error("Could not allocate a series code");
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  for (const action of ["join", "status", "ready", "start", "cancel"] as const) {
    const inputSchema = {
      controllerId: controllerIdSchema,
      seriesCode: z.string().regex(ROOM_CODE_PATTERN),
      timeoutMs: z.number().int().min(0).max(25000).optional(),
    };

    if (action === "join") Object.assign(inputSchema, seriesLabelsSchema.shape);
    server.registerTool(
      `series_${action}`,
      {
        title: `Series ${action}`,
        description:
          action === "status"
            ? "Read series progress and the current match roomId. The server carries your seat forward. Call wait_for_turn and send_action for that match. Renew series_status from the LLM during breaks, staying silent; never create a polling script. Stop only when the series completes, fails, or is cancelled."
            : `${action} a game series using this task controller. Join once; use series_status to resume. Only the human owner hosting the series can start or cancel it. Ready marks this participant ready for the next match.`,
        inputSchema,
      },
      async (input) => {
        let waitLease: { userId: string; token: string } | undefined;

        try {
          const user = requireUser(ctx),
            { seat } = await requireAgentController(ctx, input.controllerId);

          if (action === "status")
            waitLease = {
              userId: user.id,
              token: await acquireMcpAgentWaitLease(ctx.env.DB, user.id, input.controllerId),
            };
          const seriesRoom = `series-${input.seriesCode}`;
          let player = await getMcpRoomPlayer(ctx.env.DB, user.id, seat.id, seriesRoom);

          if (action === "join") {
            if (player)
              throw new Error(
                "This controller already joined. Resume with series_status. Independent tasks must claim their own controller.",
              );
            await requireMcpAgentAvailable(ctx.env.DB, user.id, seat.id);
            player = await ensureMcpRoomPlayer(ctx.env.DB, user.id, seat.id, seriesRoom);
          }

          if (!player && !["start", "cancel"].includes(action))
            throw new Error("Join this series first with series_join");
          const labels = seriesLabelsSchema.parse(input);

          const body = {
            userId: user.id,
            participantId: player?.playerId,
            timeoutMs: input.timeoutMs,
          };

          if (action === "join")
            Object.assign(body, {
              participant: {
                id: player!.playerId,
                name: seat.codename,
                kind: "agent",
                ownerGamertag: user.gamertag || "Player",
                environmentLabel: seat.environmentLabel,
                ...labels,
              },
            });

          const response = await seriesRequest(
            ctx.env,
            input.seriesCode,
            action === "status" ? "/wait" : `/${action}`,
            body,
          );

          const data = await response.json();

          if (!response.ok) {
            if (action === "join") await releaseMcpRoomPlayer(ctx.env.DB, seat.id, seriesRoom);
            throw new Error(stringField(objectPayload(data), "error") || "Series request failed");
          }

          return jsonResult(data);
        } catch (error) {
          return errorResult(error);
        } finally {
          if (waitLease)
            await releaseMcpAgentWaitLease(
              ctx.env.DB,
              waitLease.userId,
              input.controllerId,
              waitLease.token,
            ).catch(() => {});
        }
      },
    );
  }

  server.registerTool(
    "room_create",
    {
      title: "Create room",
      description:
        "Create a multiplayer room with the server-assigned controller for this AI task. " +
        "Call agent_claim once at task start. Returns roomId, roomCode, joinUrl, and expiresAt.",
      inputSchema: {
        controllerId: controllerIdSchema,
        gameType: z.string().min(1).max(40).default("connect4").describe(availableGames),
        maxPlayers: z.number().int().min(1).max(8).optional(),
        gameTotalTime: z.number().int().min(60_000).max(ROOM_LIFETIME_MS).optional(),
        turnTime: z
          .number()
          .int()
          .min(TURN_TIME_MIN_MS)
          .max(TURN_TIME_MAX_MS)
          .optional()
          .describe("Decision timer in milliseconds, from 30000 through 150000"),
      },
    },
    async ({ controllerId, gameType, maxPlayers, gameTotalTime, turnTime }) => {
      try {
        const user = requireUser(ctx);
        const { seat } = await requireAgentController(ctx, controllerId);
        await requireMcpAgentAvailable(ctx.env.DB, user.id, seat.id);
        const gt = normalizeGameType(gameType || "connect4");

        if (!gt) throw new Error(`Unknown game type: ${gameType}`);

        if (!isGameEnabled(gt)) {
          throw new Error(`Game type "${gt}" is currently unavailable.`);
        }

        let roomCode = "";
        let roomId = "";
        let expiresAt: number | undefined;
        let createdRoom = false;
        let roomPlayer: McpRoomPlayer | null = null;

        for (let attempt = 0; attempt < 5; attempt++) {
          roomCode = generateSecureRoomCode();
          roomId = roomIdFor(gt, roomCode);

          const reservation = await reserveRoomCode(
            ctx.env.DB,
            gt,
            roomCode,
            Date.now() + ROOM_LIFETIME_MS,
          );

          if (!reservation) continue;

          roomPlayer = await ensureMcpRoomPlayer(ctx.env.DB, user.id, seat.id, roomId);

          let response: Response;

          try {
            await requireMcpAgentAvailable(ctx.env.DB, user.id, seat.id, roomId);
            response = await doFetch(ctx.env, gt, roomId, "/create", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                hostId: roomPlayer.playerId,
                hostName: seat.codename,
                gameType: gt,
                maxPlayers: maxPlayers ?? (gt === "codenames" ? 8 : gt === "poker" ? 6 : 2),
                gameTotalTime,
                turnTime,
                roomCode,
              }),
            });
          } catch (error) {
            await releaseMcpRoomPlayer(ctx.env.DB, seat.id, roomId);
            await releaseRoomCode(ctx.env.DB, roomCode, roomId);
            throw error;
          }

          if (response.status === 409) {
            await releaseMcpRoomPlayer(ctx.env.DB, seat.id, roomId);
            await releaseRoomCode(ctx.env.DB, roomCode, roomId);
            continue;
          }

          if (!response.ok) {
            const body: { error?: string } = await response
              .json<{ error?: string }>()
              .catch(() => ({}));

            await releaseMcpRoomPlayer(ctx.env.DB, seat.id, roomId);
            await releaseRoomCode(ctx.env.DB, roomCode, roomId);
            throw new Error(body.error || `Room creation failed: ${response.status}`);
          }

          const created = await response.json<{ expiresAt?: number }>();
          expiresAt = created.expiresAt ?? reservation.expiresAt;

          try {
            await activateRoomCode(ctx.env.DB, roomCode, roomId, expiresAt);
          } catch (error) {
            await doFetch(ctx.env, gt, roomId, "/end", { method: "POST" }).catch(() => {});
            await releaseMcpRoomPlayer(ctx.env.DB, seat.id, roomId);
            await releaseRoomCode(ctx.env.DB, roomCode, roomId).catch(() => {});
            throw error;
          }

          createdRoom = true;
          break;
        }

        if (!createdRoom || !roomPlayer) {
          throw new Error("Could not allocate a unique room code");
        }

        const joined = await agentJoin(ctx, gt, roomId, seat, roomPlayer.playerId);

        const frontendUrl = (ctx.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

        const joinUrl = `${frontendUrl}/${gameRouteSlug(gt)}?roomCode=${roomCode}`;
        const channel: SeatChannel = "mcp";

        return jsonResult({
          controllerId,
          roomId,
          roomCode,
          gameType: gt,
          expiresAt,
          wsUrl: `/api/v1/ws/games/${roomId}?roomCode=${roomCode}`,
          joinUrl,
          mcpEndpoint: `${ctx.origin}/api/v1/mcp`,
          you: {
            codename: joined.codename ?? seat.codename,
            ownerGamertag: user.gamertag,
            environmentLabel: seat.environmentLabel,
            channel,
            channelLabel: channelLabel(channel),
          },
          message: `Seated as ${joined.codename ?? seat.codename} (MCP). Keep controllerId and roomId inside this task. Arrange the other seats and start when ready, then continue playing in this same task until the match ends or the user stops play. Do not hand play to a background job.`,
          state: joined.state,
          next: "Share roomCode. Each second AI task calls agent_claim for its own server-assigned controller, then calls room_join. Then wait_for_turn / start_game.",
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "room_join",
    {
      title: "Join room",
      description:
        "Join by room code with this AI task's server-assigned controller. " +
        "This atomically claims the seat and rejects a repeated room_join from the same controller. " +
        "Each independent task must call agent_claim once. After joining, call wait_for_turn and play to completion in this same task; do not finish after joining or delegate play to a background job. Preserve controllerId and roomId. Reconnect an already seated task with get_state or wait_for_turn.",
      inputSchema: {
        controllerId: controllerIdSchema,
        roomCode: roomCodeSchema,
        gameType: z
          .string()
          .min(1)
          .max(40)
          .optional()
          .describe("Optional legacy hint. The game is normally resolved from roomCode."),
      },
    },
    async ({ controllerId, roomCode, gameType }) => {
      try {
        const user = requireUser(ctx);
        const code = roomCode;
        const directoryEntry = await resolveRoomCode(ctx.env.DB, code);

        const gt = directoryEntry?.gameType ?? (gameType ? normalizeGameType(gameType) : null);

        if (!gt) throw new Error("Room not found");
        const roomId = directoryEntry?.roomId ?? roomIdFor(gt, code);

        const { seat } = await requireAgentController(ctx, controllerId);
        await requireMcpAgentAvailable(ctx.env.DB, user.id, seat.id, roomId);

        const raw = await doFetch(ctx.env, gt, roomId, "/state");
        const stateText = await raw.text();

        if (!raw.ok || !stateText || stateText === "null") {
          if (directoryEntry && raw.status === 404) {
            await releaseRoomCode(ctx.env.DB, code, roomId);
          }

          throw new Error("Room not found");
        }

        const state = objectPayload(JSON.parse(stateText));

        if (stringField(state, "roomCode") !== code) {
          throw new Error("Invalid room code");
        }

        const hasLegacyIdentity = roomStateHasMemberId(state, seat.id);

        const roomClaim = await claimMcpRoomPlayer(ctx.env.DB, user.id, seat.id, roomId);

        if (!roomClaim.claimed) {
          throw new McpAgentIdentityError(
            "MCP_AGENT_ALREADY_SEATED",
            "This task controller already occupies this room. Resume it with get_state or wait_for_turn. A different concurrent task must call agent_claim once and retry room_join with its own controllerId.",
            {
              roomId,
              recoveryTools: ["get_state", "wait_for_turn", "agent_claim"],
              instruction:
                "Do not reuse this controllerId in another concurrent task. Resume this seat or acquire a new controller in that task.",
            },
          );
        }

        const roomPlayer = roomClaim.player;

        try {
          await requireMcpAgentAvailable(ctx.env.DB, user.id, seat.id, roomId);
        } catch (error) {
          await releaseMcpRoomPlayer(ctx.env.DB, seat.id, roomId);
          throw error;
        }

        if (hasLegacyIdentity) {
          try {
            await migrateLegacyAgentIdentity(ctx, gt, roomId, seat, roomPlayer);
          } catch (error) {
            await releaseMcpRoomPlayer(ctx.env.DB, seat.id, roomId);
            throw error;
          }
        }

        const joined = await agentJoin(ctx, gt, roomId, seat, roomPlayer.playerId);

        const channel: SeatChannel = "mcp";

        const frontendUrl = (ctx.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

        return jsonResult({
          controllerId,
          roomId,
          roomCode: code,
          gameType: gt,
          gameStatus: joined.status ?? null,
          joinUrl: `${frontendUrl}/${gameRouteSlug(gt)}?roomCode=${code}`,
          you: {
            codename: joined.codename ?? seat.codename,
            ownerGamertag: user.gamertag,
            environmentLabel: seat.environmentLabel,
            channel,
            channelLabel: channelLabel(channel),
          },
          message: `Seated as ${joined.codename ?? seat.codename} (MCP). Keep controllerId and roomId inside this task. Call wait_for_turn next and continue playing in this same task until the match ends or the user stops play. Do not finish after joining or hand play to a background job.`,
          state: joined.state,
          seated: true,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  // ── Authoritative state / renewable wait ───────────────────────

  server.registerTool(
    "get_state",
    {
      title: "Get projected state",
      description:
        "Fetch your projected client view from the game DO (fog of war, legalActions). " +
        "roomMembers identifies players and spectators by stable playerId, username, agent name, and environment.",
      inputSchema: {
        controllerId: controllerIdSchema,
        roomId: roomIdSchema.describe("e.g. connect4-ABCDEF"),
        gameType: gameTypeSchema.optional().describe("Inferred from roomId prefix if omitted"),
      },
    },
    async ({ controllerId, roomId, gameType }) => {
      try {
        const { roomPlayer } = await requireAgentRoomPlayer(ctx, controllerId, roomId);

        const gt = gameType || gameTypeFromRoomId(roomId);

        const data = await doJson(
          ctx.env,
          gt,
          roomId,
          `/agent/view?playerId=${encodeURIComponent(roomPlayer.playerId)}`,
        );

        const payload = objectPayload(data);

        if (!payload || payloadField(payload, "state") === undefined) {
          throw new Error("Game room returned an invalid projected state");
        }

        return jsonResult(data);
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "wait_for_turn",
    {
      title: "Wait for your turn",
      description:
        "Block up to timeoutMs (max 30s, default 25s) inside the game Durable Object until " +
        "you have an actionable decision (including setup such as fleet placement), the game ends, or timeout. Returns only the fields needed for the next " +
        "decision; use get_state for room rosters or a richer inspection snapshot. " +
        "An ordinary timeout omits unchanged state and does not mean the match ended. On timedOut:true, continue this task and call wait_for_turn again; " +
        "the host LLM must make that renewal directly instead of delegating it to a loop or script. " +
        "Do not poll get_state. During play, do not print tool results or commentary to the user chat; " +
        "call tools only.",
      inputSchema: {
        controllerId: controllerIdSchema,
        roomId: roomIdSchema,
        gameType: gameTypeSchema.optional(),
        timeoutMs: z
          .number()
          .int()
          .min(1_000)
          .max(30_000)
          .optional()
          .describe(
            "1s to 30s, default 25000. On timeout, the host LLM must call wait_for_turn again; do not automate renewals.",
          ),
      },
    },
    async ({ controllerId, roomId, gameType, timeoutMs }) => {
      let waitToken: string | null = null;

      try {
        const user = requireUser(ctx);

        const { roomPlayer } = await requireAgentRoomPlayer(ctx, controllerId, roomId);

        waitToken = await acquireMcpAgentWaitLease(ctx.env.DB, user.id, controllerId);
        const gt = gameType || gameTypeFromRoomId(roomId);

        const data = await doJson(ctx.env, gt, roomId, "/agent/wait-turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: roomPlayer.playerId,
            timeoutMs: timeoutMs ?? 25_000,
          }),
        });

        return jsonResult(data);
      } catch (e) {
        return errorResult(e);
      } finally {
        if (waitToken && ctx.user) {
          await releaseMcpAgentWaitLease(ctx.env.DB, ctx.user.id, controllerId, waitToken).catch(
            () => {},
          );
        }
      }
    },
  );

  // ── Game actions ───────────────────────────────────────────────

  async function agentAction(
    controllerId: string,
    roomId: string,
    gameType: string | undefined,
    actionType: string,
    data?: WireValue,
    requestId?: string,
  ) {
    const { roomPlayer } = await requireAgentRoomPlayer(ctx, controllerId, roomId);

    const gt = gameType || gameTypeFromRoomId(roomId);
    const action = { playerId: roomPlayer.playerId, actionType, data: data ?? {} };
    const body = requestId ? { ...action, requestId } : action;

    return doJson(ctx.env, gt, roomId, "/agent/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  server.registerTool(
    "start_game",
    {
      title: "Start game",
      description: "Host starts the game. Requires ≥ min players seated.",
      inputSchema: {
        controllerId: controllerIdSchema,
        roomId: roomIdSchema,
        gameType: gameTypeSchema.optional(),
        requestId: requestIdSchema,
      },
    },
    async ({ controllerId, roomId, gameType, requestId }) => {
      try {
        const { roomPlayer } = await requireAgentRoomPlayer(ctx, controllerId, roomId);

        const gt = gameType || gameTypeFromRoomId(roomId);
        const start = { playerId: roomPlayer.playerId };
        const body = requestId ? { ...start, requestId } : start;

        const data = await doJson(ctx.env, gt, roomId, "/agent/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        return jsonResult(data);
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "list_game_tools",
    {
      title: "List game action catalog",
      description:
        "Progressive disclosure: return the compact action catalog for one gameType " +
        "(or all games if omitted). Does not register extra MCP tools — use send_action " +
        "with the listed actionType + data. Prefer after room_create/room_join. " +
        "During play, state.legalActions from wait_for_turn is usually enough.",
      inputSchema: {
        gameType: z
          .string()
          .min(1)
          .max(40)
          .optional()
          .describe(`${availableGames}. Omit for all games.`),
      },
    },
    async ({ gameType }) => {
      try {
        return jsonResult(listGameToolsCatalog(gameType));
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "get_tool_schema",
    {
      title: "Get game action schema",
      description:
        "Return full data fields + example for one actionType (e.g. drop_disc, cannon, raise). " +
        "Call after list_game_tools when you need parameter details. Then invoke via send_action.",
      inputSchema: {
        actionType: z
          .string()
          .min(1)
          .max(64)
          .describe("e.g. drop_disc | place_disc | cannon | fold | place_fleet"),
        gameType: z
          .string()
          .min(1)
          .max(40)
          .optional()
          .describe("Optional game filter (disambiguates shared names)"),
      },
    },
    async ({ actionType, gameType }) => {
      try {
        const schema = getGameToolSchema(actionType, gameType);

        if ("error" in schema && schema.error) {
          return errorResult(new Error(schema.error));
        }

        return jsonResult(schema);
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "send_action",
    {
      title: "Send game action",
      description:
        "Execute a game intent on the DO. A non-terminal success returns a small acknowledgement; " +
        "an action that ends the game returns the final compact state. Call wait_for_turn only when next is wait_for_turn. " +
        "actionType + data come from state.legalActions and/or list_game_tools / get_tool_schema. " +
        "Examples: drop_disc { col }, give_clue { word, count }, guess_word { index }, hit {}, cannon { row, col }, fold {}, bet { amount }, " +
        "place_fleet { ships }. Always pass this task's controllerId for the match.",
      inputSchema: {
        controllerId: controllerIdSchema,
        roomId: roomIdSchema,
        gameType: gameTypeSchema.optional(),
        actionType: z
          .string()
          .min(1)
          .max(64)
          .describe("e.g. drop_disc | place_disc | cannon | fold | raise"),
        data: z
          .record(z.string(), jsonValueSchema)
          .optional()
          .describe("Action payload (see get_tool_schema). Omit or {} when no fields."),
        requestId: requestIdSchema,
      },
    },
    async ({ controllerId, roomId, gameType, actionType, data, requestId }) => {
      try {
        if (new TextEncoder().encode(JSON.stringify(data ?? {})).byteLength > 32 * 1024) {
          throw new Error("Action payload exceeds 32 KiB");
        }

        const result = await agentAction(
          controllerId,
          roomId,
          gameType,
          actionType,
          data ?? {},
          requestId,
        );

        const payload = objectPayload(result);
        const state = payloadField(payload, "state");
        const projected = objectPayload(state);

        const replayed = payloadField(payload, "replayed") === true;

        if (payloadField(projected, "status") === "ended") {
          const terminal = {
            ok: true,
            terminal: true,
            replayed,
            acceptedRevision: payloadField(payload, "acceptedRevision"),
            reason: payloadField(payload, "endReason") ?? "ended",
            finalState: compactAgentDecisionState(state),

            next: payloadField(projected, "series") ? "series_status" : "done",
          };

          const series = payloadField(projected, "series");

          if (series) return jsonResult({ ...terminal, series });

          return jsonResult(terminal);
        }

        return jsonResult({
          ok: true,
          replayed,
          acceptedRevision: payloadField(payload, "acceptedRevision"),
          next: "wait_for_turn",
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  return server;
}
