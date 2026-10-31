/** Offline documentation export. Fictional data and in-memory rooms; no network or provider calls. */
import { URL } from "node:url";
import { z } from "zod";
import { providerRequestSchema, type ProviderRequest } from "./jev-contracts";
import { testEnv } from "../src/tests/fixtures/env";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import {
  GAME_ACTIONS,
  GAME_INSTRUCTIONS,
  KNOWN_GAME_TYPES,
  projectionPart,
} from "../../../packages/game-catalog/src/index";
import { createLlmgamesMcpServer } from "../src/mcp/createServer";
import { compactState } from "../src/games/agent-decision";
import { chooseJev, jevDecision, parseJevView, JEV_GAMES } from "../src/agents/jev";
import { battleshipExamples, documentationFleets } from "../src/tests/fixtures/battleship";

import { otherGameExamples } from "../src/tests/fixtures/game-spec";

interface DocumentedJevExchange {
  request: ProviderRequest;
  response: { answers: Record<string, { type: "choice"; choice: string | undefined }> };
  omittedQuestions: number;
  omittedCriteria: Record<string, number>;
}

async function jevExample(view: ReturnType<typeof compactAgentDecisionState>, placement = false) {
  const decision = jevDecision(parseJevView(view), placement ? documentationFleets : undefined);

  if (!decision) throw new Error("Invalid documentation fixture");

  const requests: DocumentedJevExchange[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (url !== "https://api.typesafe.ai/v1/systemone")
      throw new Error("Unexpected documentation request");
    const body = providerRequestSchema.parse(JSON.parse(z.string().parse(init?.body)));

    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([id, question]) => [
        id,
        { type: "choice" as const, choice: Object.keys(question.criteria)[0] },
      ]),
    );

    const questions = Object.entries(body.questions);

    const kept = questions.slice(
      0,
      body.state && decision.state.game === "contexto" ? 1 : questions.length,
    );

    const omittedCriteria: Record<string, number> = {};

    const excerpt = Object.fromEntries(
      kept.map(([id, question]) => {
        const criteria = Object.entries(question.criteria);
        const limit = decision.state.game === "contexto" ? 3 : 7;

        if (criteria.length > limit) omittedCriteria[id] = criteria.length - limit;

        return [id, { ...question, criteria: Object.fromEntries(criteria.slice(0, limit)) }];
      }),
    );

    requests.push({
      request: { ...body, questions: excerpt },
      response: {
        answers: Object.fromEntries(
          kept.map(([id]) => {
            const answer = answers[id];

            if (!answer) throw new Error("Missing documentation answer");

            return [id, answer];
          }),
        ),
      },
      omittedQuestions: questions.length - kept.length,
      omittedCriteria,
    });

    return new Response(JSON.stringify({ answers }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const action = await chooseJev(
      { TYPESAFE_API_KEY: "offline-documentation-placeholder" },
      decision,
    );

    return { requests, action, requestCount: requests.length };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server = createLlmgamesMcpServer({
    env: testEnv(),
    user: null,
    clientId: null,
    origin: "https://www.llmgames.online",
  });

  const client = new Client({ name: "offline-spec-export", version: "1" });
  let tools;

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    tools = (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }

  const battleship = await battleshipExamples();
  const fixtures = await otherGameExamples();
  const games = [];

  for (const id of KNOWN_GAME_TYPES) {
    const decisionExample = compactState(
      projectionPart(id === "battleship" ? battleship.battle : fixtures[id]),
    );

    const jev = JEV_GAMES.has(id) ? await jevExample(decisionExample) : null;
    games.push({
      id,
      instructions: GAME_INSTRUCTIONS[id],
      actions: GAME_ACTIONS.filter((action) => action.games.includes(id)),
      decisionExample,
      sendActionExample: {
        controllerId: "00000000-0000-4000-8000-000000000001",
        roomId: `${id}-ABC234`,
        gameType: id,
        ...(jev?.action ?? { actionType: "guess_word", data: { index: 1 } }),
      },
      jev,
    });
  }

  const placement = compactState(projectionPart(battleship.placement));

  const spec = {
    title: "LLM Games AI application contract",
    version: 1,
    description:
      "Documentation snapshot generated offline from MCP tools/list, the shared action catalog, the compact projection builder and the Jev adapter. Fictional examples; some repeated arrays and candidate lists are shortened. This describes the LLM Games application contract, not a replacement for the MCP protocol specification. State fields vary by phase and role. Server validation remains authoritative.",
    mcp: {
      endpoint: "https://www.llmgames.online/api/v1/mcp",
      transport: "Streamable HTTP",
      protocolVersion: LATEST_PROTOCOL_VERSION,
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      authentication: "OAuth 2.1; Authorization: Bearer <access_token>",
      responseEncoding:
        "MCP content[0].text contains serialized JSON. Tool failures set isError: true.",
      tools,
    },
    jev: {
      endpoint: "https://api.typesafe.ai/v1/systemone",
      method: "POST",
      authentication: "Authorization: Bearer <server-held TypeSafe key>",
      contentType: "application/json",
      model: "jev-latest",
      timeoutMs: 12000,
      requestSchema: {
        type: "object",
        required: ["model", "state", "questions"],
        additionalProperties: false,
        properties: {
          model: { const: "jev-latest" },
          state: {
            type: "object",
            description: "Game-specific projected state, shown in each example.",
          },
          questions: {
            type: "object",
            additionalProperties: {
              type: "object",
              required: ["type", "instructions", "criteria"],
              properties: {
                type: { const: "choice" },
                instructions: { type: "string" },
                criteria: {
                  type: "object",
                  maxProperties: 255,
                  description: "Candidate IDs mapped to a description, structured object, or null.",
                },
              },
            },
          },
        },
      },
      responseSchema: {
        type: "object",
        required: ["answers"],
        properties: {
          answers: {
            type: "object",
            additionalProperties: {
              type: "object",
              required: ["type", "choice"],
              properties: {
                type: { const: "choice" },
                choice: {
                  type: "string",
                  description: "Must match a supplied candidate ID for this question.",
                },
              },
            },
          },
        },
      },
      battleshipPlacement: { decisionExample: placement, ...(await jevExample(placement, true)) },
    },
    games,
  };

  const path = new URL("../../web/src/interface/content/ai-spec.json", import.meta.url);
  const output = `${JSON.stringify(spec, null, 2)}\n`;

  if (process.argv.includes("--check")) {
    // A Windows checkout with core.autocrlf rewrites the committed LF file, so normalize before comparing.
    const committed = (await readFile(path, "utf8")).replaceAll("\r\n", "\n");

    if (committed !== output)
      throw new Error("AI spec is stale. Run pnpm generate:ai-spec.");
    console.log(
      `AI spec matches all ${tools.length} MCP tools, 8 game catalogs and 7 hosted Jev adapters. No network calls.`,
    );
  } else {
    await writeFile(path, output);
    console.log("Exported AI spec from current source. No network calls.");
  }
}

void main();
