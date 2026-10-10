import {
  isNumber,
  isString,
  isWireObject,
  wireValueSchema,
  type WireValue,
  type WireObject,
} from "@llmgames/game-catalog";

/**
 * Two MCP agent seats under one OAuth account (agent vs agent).
 * Uses remote MCP: agent_claim → room_create / room_join → wait_for_turn.
 *
 * Prerequisites:
 *   npm run dev:workers
 *   npm run db:migrate
 *   LLMGAMES_ACCESS_TOKEN=<MCP OAuth access JWT>
 *
 * Run:
 *   npx tsx examples/remote-mcp-connect4.ts
 *   # or: npm run example:remote-mcp
 */

const BASE = (process.env.LLMGAMES_API || "http://localhost:6787").replace(/\/$/, "");

const MCP = `${BASE}/api/v1/mcp`;

const TOKEN = process.env.LLMGAMES_ACCESS_TOKEN;

function objectValue(value: WireValue): WireObject | null {
  return isWireObject(value) ? value : null;
}

function field(value: WireObject | null, key: string): WireValue {
  return value ? value[key] : undefined;
}

function requiredString(value: WireObject, key: string): string {
  const result = field(value, key);

  if (!isString(result) || !result) {
    throw new Error(`MCP response is missing ${key}`);
  }

  return result;
}

async function mcpCall(name: string, args: WireObject = {}): Promise<WireObject> {
  if (!TOKEN) {
    throw new Error(
      "Set LLMGAMES_ACCESS_TOKEN to a MCP OAuth access JWT " +
        "(complete OAuth in a host, or copy the Bearer token).",
    );
  }

  const res = await fetch(MCP, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  if (res.status === 401) {
    throw new Error("MCP unauthorized — OAuth access token missing or expired");
  }

  const body = objectValue(wireValueSchema.parse(await res.json()));

  if (!body) throw new Error("MCP returned a non-object response");
  const error = objectValue(field(body, "error"));

  if (error) {
    const message = field(error, "message");
    throw new Error(isString(message) ? message : "MCP error");
  }

  const result = objectValue(field(body, "result"));
  const content = field(result, "content");
  const firstContent = Array.isArray(content) ? objectValue(content[0]) : null;
  const text = field(firstContent, "text");

  if (!text) {
    throw new Error(`No tool result for ${name}: ${JSON.stringify(body)}`);
  }

  if (!isString(text)) throw new Error(`Invalid tool result for ${name}`);
  const parsed = objectValue(wireValueSchema.parse(JSON.parse(text)));

  if (!parsed) throw new Error(`Tool result for ${name} is not an object`);

  if (field(result, "isError") === true) {
    const parsedError = field(parsed, "error");
    throw new Error(isString(parsedError) ? parsedError : text);
  }

  return parsed;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const red = await mcpCall("agent_claim", {});
  const yel = await mcpCall("agent_claim", {});
  const redControllerId = requiredString(red, "controllerId");
  const yelControllerId = requiredString(yel, "controllerId");
  console.log("Red seat:", field(red, "codename"));
  console.log("Yel seat:", field(yel, "codename"));

  const room = await mcpCall("room_create", {
    controllerId: redControllerId,
    gameType: "connect4",
    maxPlayers: 2,
  });

  const roomId = requiredString(room, "roomId");
  const roomCode = requiredString(room, "roomCode");
  console.log("Room", roomCode, field(room, "joinUrl"));

  await mcpCall("room_join", {
    controllerId: yelControllerId,
    roomCode,
  });

  await mcpCall("start_game", {
    controllerId: redControllerId,
    roomId,
    gameType: "connect4",
  });
  console.log("Game started");

  for (let turn = 0; turn < 42; turn++) {
    for (const [controllerId, label] of [
      [redControllerId, "red"] as const,
      [yelControllerId, "yel"] as const,
    ]) {
      const wait = await mcpCall("wait_for_turn", {
        controllerId,
        roomId,
        gameType: "connect4",
        timeoutMs: 5000,
      });

      if (field(wait, "timedOut") === true) continue;

      const state = objectValue(field(wait, "state"));
      const you = objectValue(field(state, "you"));

      if (field(state, "status") === "ended") {
        console.log("Ended. Winner:", field(state, "winner"));

        return;
      }

      if (field(you, "isYourTurn") !== true) continue;

      const rawBoard = field(state, "board");

      const board = Array.isArray(rawBoard)
        ? rawBoard.filter(
            (row): row is number[] => Array.isArray(row) && row.every((cell) => isNumber(cell)),
          )
        : [];

      const order = [3, 2, 4, 1, 5, 0, 6];

      for (const col of order) {
        if (board[0]?.[col] === 0) {
          console.log(label, "drops", col);
          await mcpCall("send_action", {
            controllerId,
            roomId,
            gameType: "connect4",
            actionType: "drop_disc",
            data: { col },
          });
          await sleep(100);
          break;
        }
      }
    }
  }

  console.log("Max turns reached");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
