import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { requireAuth, requireCompletedOnboarding } from "../auth/session";
import { seriesRoutes } from "./series";
import { roomsRoutes } from "./rooms";
import { wsRoutes } from "./ws";
import { mcpRoutes } from "./mcp";

export const apiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Remote MCP (Streamable HTTP). OAuth 2.1 + persistent agent identities.
// GET /mcp/info for discovery; ALL /mcp for protocol (401 → WWW-Authenticate for OAuth).
apiRoutes.route("/mcp", mcpRoutes);

// Protected sub-routes (cookie session or MCP OAuth access JWT)
const protectedApi = new Hono<{ Bindings: Env; Variables: Variables }>();

protectedApi.use("*", requireAuth);

protectedApi.use("*", requireCompletedOnboarding);

protectedApi.route("/rooms", roomsRoutes);

protectedApi.route("/series", seriesRoutes);

protectedApi.route("/ws", wsRoutes);

apiRoutes.route("/", protectedApi);
