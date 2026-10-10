/**
 * Local stdio MCP bridge via @llmgames/agent-client.
 * Prefer hosted remote MCP + OAuth for multi-agent (agent_claim).
 * Server (Worker DO) remains source of truth.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BridgeSession, errorResult, jsonResult } from "./session.js";
import {
  compactAgentDecisionState,
  jsonValueSchema,
  ENABLED_GAME_TYPES,
  getGameToolSchema,
  isGameEnabled,
  listGameToolsCatalog,
  ROOM_LIFETIME_MS,
  TURN_TIME_MAX_MS,
  TURN_TIME_MIN_MS,
} from "@llmgames/game-catalog";

export function createMcpServer(session = new BridgeSession()): McpServer {
  const availableGames = ENABLED_GAME_TYPES.join(" | ");

  const server = new McpServer(
    {
      name: "llmgames",
      version: "0.6.0",
    },
    {
      instructions: `llmgames local MCP bridge. The server owns game state and timers.
Rooms expire 45 minutes after creation; hosts may end the room. Countdown displays run locally from server timestamps.
Decision timers run from 30 to 150 seconds. Battleship fleet placement stays fixed at 5 minutes. Missing fleets are server-deployed at expiry, then the configured battle timer begins.
Use list_game_tools to receive the selected game's timer/default-action instructions and action catalog, get_tool_schema for fields, send_action to act, and wait_for_turn for minimal decision state instead of polling get_state.
Do not create a game-playing loop, script, background task, recursion, or scheduled automation. Route every turn through the host LLM. It must inspect the latest state and choose at most one legal action before waiting again.`,
    },
  );

  // ── Auth ─────────────────────────────────────────────────────────

  server.registerTool(
    "auth_set_token",
    {
      title: "Set OAuth access token",
      description:
        "Set your MCP OAuth access JWT as the session Bearer token. " +
        "Obtain it by completing OAuth against the remote MCP endpoint. " +
        "Prefer connecting hosts directly to remote MCP for agent_claim multi-agent.",
      inputSchema: {
        accessToken: z.string().min(20).max(16_384).describe("MCP OAuth access JWT"),
        persist: z.boolean().optional().describe("Save to ~/.llmgames/config.json (default false)"),
      },
    },
    async ({ accessToken, persist }) => {
      try {
        session.setToken(accessToken, { persist: persist === true });

        return jsonResult({
          ok: true,
          accessTokenMasked: session.tokenMasked,
          baseUrl: session.baseUrl,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "auth_status",
    {
      title: "Auth / connection status",
      description:
        "Show whether an access token is set (masked), API base URL, room, and WS connection status.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(session.status());
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "auth_whoami",
    {
      title: "Who am I",
      description: "Call the API with the current Bearer token and return the authenticated user.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(await session.whoami());
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "auth_clear",
    {
      title: "Clear session token",
      description: "Drop the bearer token from this MCP process (optionally from disk config).",
      inputSchema: {
        persist: z
          .boolean()
          .optional()
          .describe("Also remove token from ~/.llmgames/config.json (default true)"),
      },
    },
    async ({ persist }) => {
      try {
        session.clearToken({ persist: persist !== false });

        return jsonResult({ ok: true, authenticated: false });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "set_api_url",
    {
      title: "Set API base URL",
      description:
        "Set the llmgames API base URL. HTTPS is required except for loopback; clear the token before changing origins.",
      inputSchema: {
        baseUrl: z.string().describe("e.g. http://localhost:6787 or https://api.example.com"),
        persist: z.boolean().optional(),
      },
    },
    async ({ baseUrl, persist }) => {
      try {
        session.setBaseUrl(baseUrl, { persist: persist !== false });

        return jsonResult({ baseUrl: session.baseUrl });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  // ── Rooms ────────────────────────────────────────────────────────

  server.registerTool(
    "room_create",
    {
      title: "Create room",
      description:
        "Create a multiplayer room. Returns roomId, roomCode, wsUrl, joinUrl (browser link), and expiresAt. Requires auth.",
      inputSchema: {
        gameType: z.string().min(1).max(40).default("connect4").describe(availableGames),
        maxPlayers: z.number().int().min(1).max(8).optional(),
        persist: z
          .boolean()
          .optional()
          .describe("Save room details for reconnecting after restart, default false"),
        gameTotalTime: z.number().int().min(60_000).max(ROOM_LIFETIME_MS).optional(),
        turnTime: z.number().int().min(TURN_TIME_MIN_MS).max(TURN_TIME_MAX_MS).optional(),
      },
    },
    async ({ gameType, maxPlayers, gameTotalTime, turnTime, persist }) => {
      try {
        if (!isGameEnabled(gameType || "connect4")) {
          throw new Error(`Game type "${gameType}" is currently unavailable.`);
        }

        const room = await session.createRoom(
          {
            gameType: gameType || "connect4",
            maxPlayers,
            gameTotalTime,
            turnTime,
          },
          { persist: persist === true },
        );

        return jsonResult(room);
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
        "Join an existing room by code (browser-style single seat under this OAuth token).",
      inputSchema: {
        roomCode: z
          .string()
          .regex(/^[A-HJ-NP-Z2-9]{6}$/i)
          .describe("6-character room code"),
        persist: z
          .boolean()
          .optional()
          .describe("Save room details for reconnecting after restart, default false"),
        gameType: z
          .string()
          .min(1)
          .max(40)
          .optional()
          .describe("Optional legacy hint. The game is normally resolved from roomCode."),
      },
    },
    async ({ roomCode, gameType, persist }) => {
      try {
        const room = await session.joinRoom(
          {
            roomCode,
            gameType,
          },
          { persist: persist === true },
        );

        return jsonResult(room);
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "room_connect",
    {
      title: "Connect WebSocket",
      description:
        "Open the game WebSocket for the current (or given) room. Required before start_game / actions. Keeps the connection open for this MCP process.",
      inputSchema: {
        roomId: z.string().min(9).max(64).optional(),
        roomCode: z
          .string()
          .regex(/^[A-HJ-NP-Z2-9]{6}$/i)
          .optional(),
        wsUrl: z.string().min(1).max(256).optional(),
      },
    },
    async ({ roomId, roomCode, wsUrl }) => {
      try {
        if ((wsUrl || roomCode) && !roomId)
          throw new Error("roomId is required when specifying wsUrl or roomCode");

        const room = roomId
          ? {
              roomId,
              roomCode: roomCode ?? "",
              wsUrl: wsUrl ?? `/api/v1/ws/games/${encodeURIComponent(roomId)}`,
            }
          : undefined;

        const state = await session.connect(room);

        return jsonResult({
          connected: true,
          you: state.you,
          status: state.status,
          roomCode: state.roomCode,
          players: state.players,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "room_leave",
    {
      title: "Leave room",
      description: "Send leave and close the WebSocket.",
      inputSchema: {},
    },
    async () => {
      try {
        session.leave();

        return jsonResult({ ok: true, connected: false });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  // ── State ────────────────────────────────────────────────────────

  server.registerTool(
    "get_state",
    {
      title: "Get projected game state",
      description:
        "Return the last projected client view (board fog-of-war, you.legalActions, etc.). Server is source of truth.",
      inputSchema: {},
    },
    async () => {
      try {
        const state = session.getState();

        if (!state) {
          return jsonResult({
            state: null,
            hint: "Connect first with room_connect, or wait for updates after actions.",
          });
        }

        return jsonResult(state);
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "wait_for_turn",
    {
      title: "Wait until your turn",
      description:
        "Block until you.isYourTurn or the game ends. Return only decision-relevant fields. " +
        "Use get_state for a richer inspection snapshot. Call from the host LLM after opponents move; " +
        "do not automate calls with a game-playing loop.",
      inputSchema: {
        timeoutMs: z.number().int().min(1_000).max(30_000).optional().describe("Default 25000"),
      },
    },
    async ({ timeoutMs }) => {
      try {
        const c = session.requireConnected();
        const state = await c.waitForTurn(timeoutMs ?? 25000);

        return jsonResult({
          timedOut: false,
          reason: state.status === "ended" ? "ended" : "your_turn",
          revision: session.getStateRevision(),
          state: compactAgentDecisionState(state),
        });
      } catch (e) {
        if (e instanceof Error && e.message === "waitForTurn timeout") {
          return jsonResult({
            timedOut: true,
            reason: "timeout",
            revision: session.getStateRevision(),
          });
        }

        return errorResult(e);
      }
    },
  );

  // ── Game actions (progressive disclosure) ───────────────────────

  server.registerTool(
    "start_game",
    {
      title: "Start game",
      description: "Host starts the game (waiting lobby → playing).",
      inputSchema: {},
    },
    async () => {
      try {
        const state = await session.runAction((c) => c.startGame());

        return jsonResult({ ok: true, you: state?.you, status: state?.status });
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
        "Progressive disclosure: compact action catalog for one gameType (or all). " +
        "Use send_action with listed actionType + data. Prefer you.legalActions during play.",
      inputSchema: {
        gameType: z.string().min(1).max(40).optional().describe(availableGames),
      },
    },
    async ({ gameType }) => {
      try {
        return jsonResult(listGameToolsCatalog(gameType, { transport: "local" }));
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "get_tool_schema",
    {
      title: "Get game action schema",
      description: "Full data fields + example for one actionType. Then call send_action.",
      inputSchema: {
        actionType: z
          .string()
          .min(1)
          .max(64)
          .describe("e.g. drop_disc | place_disc | cannon | fold"),
        gameType: z.string().min(1).max(40).optional(),
      },
    },
    async ({ actionType, gameType }) => {
      try {
        const schema = getGameToolSchema(actionType, gameType, { transport: "local" });

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
        "Execute a game intent over the WebSocket. A non-terminal success returns a small acknowledgement; " +
        "an ending action returns finalState. Call wait_for_turn only when next is wait_for_turn. " +
        "actionType + data from state.legalActions and/or list_game_tools / get_tool_schema. " +
        "Examples: drop_disc { col }, hit {}, cannon { row, col }, fold {}.",
      inputSchema: {
        actionType: z
          .string()
          .min(1)
          .max(64)
          .describe("e.g. drop_disc | place_disc | cannon | fold | raise"),
        data: z
          .record(z.string(), jsonValueSchema)
          .optional()
          .describe("Action payload. Omit or {} when no fields."),
      },
    },
    async ({ actionType, data }) => {
      try {
        if (Buffer.byteLength(JSON.stringify(data ?? {}), "utf8") > 32 * 1024) {
          throw new Error("Action payload exceeds 32 KiB");
        }

        const state = await session.runAction((c) => c.sendAction(actionType, data ?? {}));

        if (state?.status === "ended") {
          return jsonResult({
            ok: true,
            terminal: true,
            acceptedRevision: session.getStateRevision(),
            reason: "ended",
            finalState: compactAgentDecisionState(state),
            next: "done",
          });
        }

        return jsonResult({
          ok: true,
          acceptedRevision: session.getStateRevision(),
          next: "wait_for_turn",
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  // Resources for hosts that prefer read APIs
  server.registerResource(
    "session",
    "llmgames://session",
    {
      description: "Auth + room + connection summary (token masked)",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "llmgames://session",
          mimeType: "application/json",
          text: JSON.stringify(session.status(), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "state",
    "llmgames://state",
    {
      description: "Last projected game state for this seat",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "llmgames://state",
          mimeType: "application/json",
          text: JSON.stringify(session.getState() ?? { state: null }, null, 2),
        },
      ],
    }),
  );

  return server;
}
