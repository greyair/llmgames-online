import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { AgentClient } from "@llmgames/agent-client";
import { getGameToolSchema } from "@llmgames/game-catalog";
import { BridgeSession } from "../dist/session.js";
import { createMcpServer } from "../dist/server.js";

const requireClient = createRequire(import.meta.resolve("@llmgames/agent-client"));

const { WebSocketServer } = requireClient("ws");

const state = { type: "connect4", status: "playing", board: [[0]], you: { isYourTurn: true } };

const room = {
  roomId: "audit-room-123",
  roomCode: "ABC234",
  gameType: "connect4",
  wsUrl: "/api/v1/ws/games/audit-room-123",
  expiresAt: Date.now() + 60_000,
};

const emit = (ws, type, payload) => ws.send(JSON.stringify({ type, payload }));

// Windows has no POSIX permission bits: stat() reports 0o666/0o777 regardless of chmod.
const posixPermissions = process.platform !== "win32";

const call = async (server, name, args = {}) => {
  const result = await server._registeredTools[name].handler(args, {});

  return { ...JSON.parse(result.content[0].text), isError: result.isError === true };
};

function sessionFixture(t) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmgames-bridge-test-"));
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
  const session = new BridgeSession({ configDir });

  return { session, configDir, configPath: path.join(configDir, "config.json") };
}

async function connectedFixture(t, respond) {
  const { session } = sessionFixture(t);
  const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wsServer, "listening");
  let socket;
  wsServer.on("connection", (ws) => {
    socket = ws;
    emit(ws, "connected", { state });
    ws.on("message", (raw) => {
      const message = JSON.parse(raw);

      if (message.type === "action" || message.type === "start_game") respond(ws, message);
    });
  });
  session.setBaseUrl(`http://127.0.0.1:${wsServer.address().port}`);
  session.setToken("dummy-test-token");
  await session.connect(room);
  t.after(async () => {
    session.leave();

    for (const ws of wsServer.clients) ws.terminate();
    await new Promise((resolve) => wsServer.close(resolve));
  });

  return { session, server: createMcpServer(session), socket: () => socket };
}

test("server rejection becomes an MCP error for actions and start_game", async (t) => {
  const { server } = await connectedFixture(t, (ws, message) => {
    emit(ws, "error", { message: "unrelated legacy error" });
    emit(ws, "action_result", { requestId: message.requestId, ok: false, message: "Illegal move" });
  });

  for (const name of ["send_action", "start_game"]) {
    const result = await call(server, name, { actionType: "drop_disc", data: { col: 99 } });
    assert.equal(result.isError, true);
    assert.equal(result.error, "Illegal move");
    assert.equal(result.ok, undefined);
  }
});

test("broadcasts and mismatched acknowledgements cannot confirm an action", async (t) => {
  const { session } = await connectedFixture(t, (ws, message) => {
    emit(ws, "state", state);
    emit(ws, "turn_changed", {
      currentPlayerId: "p2",
      phase: "play",
      turnNumber: 2,
      turnTimeRemaining: 30000,
    });
    emit(ws, "action_result", { requestId: "someone-else", ok: true, state });
  });

  await assert.rejects(
    session.runAction((c) => c.sendAction("drop_disc", { col: 0 }), 100),
    /acceptance is unknown/,
  );
});

test("a matching acknowledgement supplies the authoritative state", async (t) => {
  const next = { ...state, you: { isYourTurn: false }, board: [[1]] };

  const { session, server } = await connectedFixture(t, (ws, message) => {
    emit(ws, "state", state);
    emit(ws, "action_result", { requestId: message.requestId, ok: true, state: next });
  });

  const result = await call(server, "send_action", { actionType: "drop_disc", data: { col: 0 } });
  assert.equal(result.ok, true);
  assert.deepEqual(session.getState(), next);
  assert.equal(session.getState().you.isYourTurn, false);
});

test("ending actions return finalState and stop waiting", async (t) => {
  const { server } = await connectedFixture(t, (ws, message) =>
    emit(ws, "action_result", {
      requestId: message.requestId,
      ok: true,
      state: { ...state, status: "ended" },
    }),
  );

  const result = await call(server, "send_action", { actionType: "drop_disc", data: { col: 0 } });
  assert.equal(result.terminal, true);
  assert.equal(result.next, "done");
  assert.equal(result.finalState.status, "ended");
});

test("closing the socket rejects an action whose acceptance is unknown", async (t) => {
  const { session } = await connectedFixture(t, (ws) => ws.close());
  await assert.rejects(
    session.runAction((c) => c.startGame()),
    /disconnected.*acceptance is unknown/,
  );
});

test("roomId-only selection cannot silently use another saved room", async (t) => {
  const { session, server } = await connectedFixture(t, () => {});
  const result = await call(server, "room_connect", { roomId: "different-room-123" });
  assert.equal(result.isError, true);
  assert.match(result.error, /roomCode is required/);
  assert.equal(session.status().room.roomId, room.roomId);
  assert.equal((await call(server, "room_connect", { roomId: room.roomId })).connected, true);
});

test("local catalog matches registered tools and omits remote controller fields", async (t) => {
  const { session } = sessionFixture(t);
  const server = createMcpServer(session);
  const catalog = await call(server, "list_game_tools", { gameType: "connect4" });
  assert.deepEqual([...catalog.coreTools].sort(), Object.keys(server._registeredTools).sort());

  const schema = await call(server, "get_tool_schema", {
    actionType: "drop_disc",
    gameType: "connect4",
  });

  for (const value of [schema.send_action, schema.example]) {
    assert.equal("controllerId" in value, false);
    assert.equal("roomId" in value, false);
  }

  assert.ok(getGameToolSchema("drop_disc", "connect4").example.controllerId);
});

test("multibyte payloads are rejected by their byte size before sending", async (t) => {
  const { session } = sessionFixture(t);
  session.runAction = () => {
    throw new Error("must not send oversized data");
  };

  const result = await call(createMcpServer(session), "send_action", {
    actionType: "guess_word",
    data: { word: "漢".repeat(12000) },
  });

  assert.equal(result.error, "Action payload exceeds 32 KiB");
});

test("room saving is opt-in, excludes runtime tokens, expires, and clears on leave", async (t) => {
  const { session, configPath, configDir } = sessionFixture(t);
  session.setToken("dummy-test-token");
  session.requireClient = () => ({ createRoom: async () => room, joinRoom: async () => room });
  await session.createRoom({ gameType: "connect4" });
  assert.equal(fs.existsSync(configPath), false);
  await session.joinRoom({ roomCode: room.roomCode });
  assert.equal(fs.existsSync(configPath), false);
  await session.createRoom({ gameType: "connect4" }, { persist: true });
  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(saved.accessToken, undefined);
  assert.equal(saved.expiresAt, room.expiresAt);

  if (posixPermissions) {
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(configDir).mode & 0o777, 0o700);
  }

  assert.equal(new BridgeSession({ configDir }).status().room.roomId, room.roomId);
  fs.writeFileSync(configPath, JSON.stringify({ ...saved, expiresAt: Date.now() - 1 }));
  assert.equal(new BridgeSession({ configDir }).status().room, null);
  session.leave();
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).roomId, undefined);
});

test("saving the same origin preserves an existing disk token when the runtime token differs", (t) => {
  const { session, configPath } = sessionFixture(t);
  session.setToken("saved-test-token", { persist: true });
  session.setToken("temporary-test-token");
  session.setBaseUrl(session.baseUrl, { persist: true });
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).accessToken, "saved-test-token");
  session.clearToken({ persist: false });
  session.setBaseUrl("https://other-origin.test", { persist: true });
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).accessToken, undefined);
});
