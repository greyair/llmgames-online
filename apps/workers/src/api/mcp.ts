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
import { MCP_SERVER_VERSION } from "../mcp/version";
import { mcpWwwAuthenticate } from "../auth/mcpOAuthRoutes";
import { mcpResourceUrl } from "../auth/mcpOAuth";
import {
  isPersonalToken,
  personalTokenClientId,
  verifyPersonalToken,
} from "../auth/mcpPersonalTokens";
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
    version: MCP_SERVER_VERSION,
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
      // For clients that cannot open a browser: a Linux box, a CLI, a runner.
      personalAccessToken: {
        header: "Authorization: Bearer llgm_pat_v1_<id>.<secret>",
        endpoint: `${origin}/api/v1/mcp`,
        manageAt: `${origin}/profile`,
        scope: "mcp",
        revocable: "Each token expires and can be revoked on its own; revocation applies immediately.",
        notASession: "A token authenticates the account for MCP only. It cannot read or change account settings.",
        agents: "Token identity and agent identity stay separate: agent_claim still issues a controllerId per task.",
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
        "send_room_message",
        "get_room_messages",
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
/**
 * Personal access tokens — accepted here and nowhere else.
 *
 * The token proves which *user* is calling. It does not prove which agent task
 * is calling: that is still `agent_claim`, and each token still gets its own
 * controllers. Mounting this on the MCP router (rather than in the global
 * session middleware) is what keeps a PAT out of the account and credential
 * APIs.
 */
mcpRoutes.use("/", async (c, next) => {
  if (c.get("user")) return next();

  const bearer = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  // Not our prefix: leave the request to the OAuth branch below, which answers
  // with the discovery challenge a browser-capable client needs.
  if (!bearer || !isPersonalToken(bearer)) return next();

  const verified = await verifyPersonalToken(c.env.DB, c.env.ENCRYPTION_SECRET, bearer).catch(
    () => null,
  );

  if (!verified) {
    logEvent("mcp_auth_failed", { stage: "personal_token" });

    const origin = new URL(c.req.url).origin;

    return c.json(
      {
        error: "invalid_token",
        error_description:
          "This MCP access token is unknown, expired or revoked. Create a new one in settings.",
        resource: mcpResourceUrl(origin),
      },
      401,
      { "WWW-Authenticate": mcpWwwAuthenticate(origin), "Cache-Control": "no-store" },
    );
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 60;

  c.set("user", verified.user);
  // The seat label is the token's own name, so a roster shows "DSH Server"
  // rather than a generic agent.
  c.set("mcpClientId", personalTokenClientId(verified.tokenName));
  c.set("session", {
    userId: verified.user.id,
    email: verified.user.email,
    name: verified.user.name,
    expiresAt,
  });

  return next();
});

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
