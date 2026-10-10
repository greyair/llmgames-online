#!/usr/bin/env node
/**
 * @llmgames/mcp-server — local stdio MCP bridge (optional).
 *
 * Prefer remote MCP + OAuth for multi-agent (agent_claim).
 *
 * Env:
 *   LLMGAMES_API             default http://localhost:6787
 *   LLMGAMES_ACCESS_TOKEN    MCP OAuth access JWT
 *
 * Tools: auth_set_token, rooms, game intents (browser-style single seat).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";
import { BridgeSession } from "./session.js";

async function main(): Promise<void> {
  const session = new BridgeSession();
  const server = createMcpServer(session);
  const transport = new StdioServerTransport();

  console.error(
    `[llmgames-mcp] starting (api=${session.baseUrl}, auth=${session.hasToken ? "yes" : "no"})`,
  );

  await server.connect(transport);
  console.error("[llmgames-mcp] connected on stdio");
}

main().catch((err) => {
  console.error("[llmgames-mcp] fatal", err);
  process.exit(1);
});
