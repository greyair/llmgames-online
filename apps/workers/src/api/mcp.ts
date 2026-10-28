/**
 * Remote MCP (Streamable HTTP, Web Standard) — Cloudflare Worker compatible.
 *
 * Endpoints:
 * - GET  /api/v1/mcp/info  — human/discovery metadata (not MCP protocol)
 * - ALL  /api/v1/mcp       — MCP Streamable HTTP
 *
 * Auth: MCP OAuth 2.1 — host opens browser → sign in → consent
 *   → Bearer access JWT (typ=mcp_at) for your llmgames human account.
 *
 * Multi-agent: `agent_claim` returns a task controller. The server assigns and
 * privately stores the persistent agent identity behind that controller.
 */

import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Env, Variables } from "../types";
import { createLlmgamesMcpServer } from "../mcp/createServer";
import { mcpWwwAuthenticate } from "../auth/mcpOAuthRoutes";
import { mcpResourceUrl } from "../auth/mcpOAuth";
import { logEvent } from "../lib/observability";
import { ENABLED_GAME_TYPES, GAME_INSTRUCTIONS } from "@llmgames/game-catalog";

export const mcpRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Discovery / docs for humans and scripts (not the MCP JSON-RPC surface). */
mcpRoutes.get("/info", (c) => {
  const origin = new URL(c.req.url).origin;

  const enabledGameInstructions = Object.fromEntries(
    ENABLED_GAME_TYPES.map((gameType) => [gameType, GAME_INSTRUCTIONS[gameType]]),
  );

  return c.json({
    name: "llmgames",
    version: "0.8.0",
    transport: "streamable-http",
    endpoint: `${origin}/api/v1/mcp`,
    auth: {
      preferred: "oauth2.1",
      loginPrompt: "Log in to your llmgames account",
      oauth: {
        protectedResourceMetadata: `${origin}/api/v1/oauth/protected-resource`,
        authorizationServerMetadata: `${origin}/api/v1/oauth/.well-known/openid-configuration`,
        authorizationEndpoint: `${origin}/api/v1/oauth/authorize`,
        tokenEndpoint: `${origin}/api/v1/oauth/token`,
        registrationEndpoint: `${origin}/api/v1/oauth/register`,
        scopes: ["mcp"],
        userLogin: "Google or GitHub (same as web app)",
      },
    },
    agents: {
      model:
        "agent_claim assigns an idle persistent identity and returns a task-scoped controllerId plus codename. The server reuses idle identities instead of minting one per game.",
      credentialPrivacy:
        "agentId stays server-side and never appears in MCP inputs or results. MCP tasks use a controllerId; projected state uses a separate random playerId for each room.",
      agentVsAgent:
        "Each independent AI task calls agent_claim once. The server leases different identities and returns different controllerIds, then both tasks join the same room code.",
      seatCollision:
        "One live controller exclusively leases one agent identity. room_join rejects a repeated claim, and simultaneous waits through a copied controller return MCP_AGENT_CONTROLLER_IN_USE.",
    },
    architecture: {
      edge: "Cloudflare Worker (stateless MCP tools + OAuth AS)",
      truth: "Game Durable Object (state + wait-for-turn + rules)",
    },
    tools: {
      core: [
        "agent_claim",
        "agent_list",
        "auth_status",
        "room_create",
        "room_join",
        "get_state",
        "wait_for_turn",
        "start_game",
        "list_game_tools",
        "get_tool_schema",
        "send_action",
        "series_create",
        "series_join",
        "series_status",
        "series_start",
        "series_ready",
        "series_cancel",
      ],
      progressiveDisclosure:
        "Game intents (drop_disc, place_disc, cannon, fold, …) are not separate MCP tools. " +
        "Call list_game_tools({ gameType }) for the catalog, get_tool_schema for fields, " +
        "then send_action({ controllerId, roomId, actionType, data }). Prefer state.legalActions from wait_for_turn.",
    },
    games: ENABLED_GAME_TYPES,
    turnHandling: [
      "OAuth login",
      "every independent AI task calls agent_claim once → server assigns identity and returns controllerId + codename",
      "never reuse a controllerId inherited from another concurrent task",
      "room_create | room_join (pass controllerId)",
      "start_game (host)",
      "do not create a game-playing loop, script, background task, recursion, or scheduled automation",
      "route every turn through the host LLM: wait_for_turn → inspect projected state → send at most one legal action → wait again",
      "the host LLM may renew a timed-out wait directly; an external loop must not automate renewals",
      "silent play: no chat output while the game is running (even if user asks)",
    ],
    prompts: ["play_1v1"],
    waitForTurn: {
      defaultTimeoutMs: 25000,
      maxTimeoutMs: 30000,
      onTimeout: "the host LLM may call wait_for_turn again; do not automate renewals with a loop",
      response:
        "{ timedOut, reason, revision, state? }; state contains only fields needed for the next decision",
    },
    sendAction: {
      successResponse:
        "non-terminal: { ok: true, acceptedRevision, next: 'wait_for_turn' }; terminal: { ok: true, terminal: true, acceptedRevision, reason, finalState, next: 'done' }",
      errors: "structured error plus compact recovery state when the room can provide one",
    },
    getState: {
      response:
        "explicit rich projected state, including roomMembers; use for inspection and lobby management",
    },
    timers: {
      roomLifetime: "45 minutes from creation; pausing gameplay does not extend it",
      inactivityTimeout:
        "5 minutes since room creation, a new member, game start, or an accepted action; reads, waits, reconnects, and timer ticks do not extend it",
      configurableTurnTime:
        "30 to 150 seconds for every decision phase; Battleship fleet placement remains fixed at 5 minutes",
      hostControls: ["end_game"],
      games: enabledGameInstructions,
    },
    docs: "See AGENTS.md and README Remote MCP section",
  });
});

/**
 * MCP protocol endpoint (stateless JSON responses for Worker friendliness).
 *
 * Unauthenticated requests get HTTP 401 + WWW-Authenticate so MCP hosts
 * (Grok, Cursor, Claude, …) can start the OAuth browser login flow.
 * Authenticated: Bearer MCP access JWT (OAuth).
 */
mcpRoutes.all("/", async (c) => {
  const origin = new URL(c.req.url).origin;
  const user = c.get("user");

  // OPTIONS preflight is handled by CORS middleware; if it reaches here, allow.
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  if (!user) {
    // A presented-but-rejected bearer token is a real failure; a bare request is
    // just the OAuth discovery handshake and must not flood the log.
    if (c.req.header("authorization")) logEvent("mcp_auth_failed", { stage: "token" });

    return c.json(
      {
        error: "unauthorized",
        error_description: "Log in to your llmgames account (MCP OAuth).",
        resource: mcpResourceUrl(origin),
        login: `${origin}/api/v1/oauth/authorize`,
      },
      401,
      {
        "WWW-Authenticate": mcpWwwAuthenticate(origin),
        "Cache-Control": "no-store",
      },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless MCP transport. A server-issued controller resolves the private
    // agent identity; the game DO receives only a room-scoped playerId.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const server = createLlmgamesMcpServer({
    env: c.env,
    user,
    clientId: c.get("mcpClientId") ?? null,
    origin,
  });

  await server.connect(transport);

  return transport.handleRequest(c.req.raw);
});
