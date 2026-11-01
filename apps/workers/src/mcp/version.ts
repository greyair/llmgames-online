/**
 * Version advertised by both MCP handshake paths (`/api/v1/mcp/info` and the
 * server initialization result). Kept in one place so the two cannot drift.
 *
 * Bump the minor number whenever the tool surface or the game catalog changes:
 * agents cache the tool list against this string.
 */
export const MCP_SERVER_VERSION = "0.9.0";
