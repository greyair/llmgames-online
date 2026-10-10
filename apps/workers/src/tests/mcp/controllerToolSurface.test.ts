import { testEnv } from "../fixtures/env";
import { wireObjectSchema } from "@llmgames/game-catalog";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createLlmgamesMcpServer } from "../../mcp/createServer";
import type { User } from "../../types";

describe("MCP controller tool surface", () => {
  it("never accepts agentId and requires controllerId on playing tools", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const user: User = {
      id: "owner-a",
      email: "owner@example.invalid",
      name: "Owner",
      gamertag: "Owner",
      created_at: 1,
      updated_at: 1,
    };

    const server = createLlmgamesMcpServer({
      env: testEnv(),
      user,
      clientId: "codex-client",
      origin: "https://games.test",
    });

    const client = new Client({ name: "controller-contract-test", version: "1" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));

    for (const name of [
      "room_create",
      "room_join",
      "get_state",
      "wait_for_turn",
      "start_game",
      "send_action",
    ]) {
      const schema = z
        .object({
          properties: wireObjectSchema.optional(),
          required: z.array(z.string()).optional(),
        })
        .passthrough()
        .parse(byName.get(name)?.inputSchema);

      expect(schema.properties).toHaveProperty("controllerId");
      expect(schema.properties).not.toHaveProperty("agentId");
      expect(schema.required).toContain("controllerId");
    }

    expect(byName.get("agent_claim")?.inputSchema).not.toHaveProperty("properties.agentId");
    await client.close();
    await server.close();
  });
});
