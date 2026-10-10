import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocketServer } from "ws";
import { AgentClient } from "../dist/index.js";

const projection = { status: "playing", you: { playerId: "p1", isYourTurn: false } };

const room = { roomId: "test-room", roomCode: "ABC234", wsUrl: "/api/v1/ws/games/test-room" };

const emit = (ws, type, payload) => ws.send(JSON.stringify({ type, payload }));

async function fixture(t, connected = true, options = {}) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const sockets = [];
  server.on("connection", (ws) => {
    sockets.push(ws);

    if (connected) emit(ws, "connected", { state: projection });
  });

  const client = new AgentClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    accessToken: "test-token",
    ...options,
  });

  t.after(async () => {
    client.leave();

    for (const ws of server.clients) ws.terminate();
    await new Promise((resolve) => server.close(resolve));
  });

  return { server, client, sockets };
}

test("reconnect clears state and ignores the old socket's close and messages", async (t) => {
  const { server, client, sockets } = await fixture(t);
  await client.connect(room);
  const old = sockets[0];
  const oldClosed = once(old, "close");
  emit(old, "state", { ...projection, roomCode: "STALE", you: { isYourTurn: true } });
  server.removeAllListeners("connection");
  const nextSocket = once(server, "connection");
  const reconnect = client.connect(room);
  assert.equal(client.currentState, null);
  const [next] = await nextSocket;
  emit(next, "connected", { state: { ...projection, roomCode: "DEF234" } });
  await reconnect;
  // A delayed close for the previous socket must not clear the replacement.
  await oldClosed;
  old.close(1000, "replaced");
  assert.equal(client.isConnected, true);
  assert.equal(client.currentState.roomCode, "DEF234");
});

test("initial close rejects connect immediately", async (t) => {
  const { server, client } = await fixture(t, false);
  const socket = once(server, "connection");
  const connecting = client.connect(room);
  const rejection = assert.rejects(connecting, /closed before connected/);
  const [ws] = await socket;
  ws.close();
  await rejection;
  assert.equal(client.currentState, null);
});

test("a reconnect without connected times out despite the old state", async (t) => {
  const { server, client } = await fixture(t, true, { connectTimeoutMs: 100 });
  await client.connect(room);
  server.removeAllListeners("connection");
  await assert.rejects(client.connect(room), /Timed out waiting for connected/);
  assert.equal(client.isConnected, false);
  assert.equal(client.currentState, null);
});

test("successful connect clears its deadline", async (t) => {
  const { client } = await fixture(t);
  const timers = new Set();
  const schedule = globalThis.setTimeout;
  const cancel = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
    const timer = schedule(fn, ms, ...args);
    timers.add(timer);

    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer) => {
    timers.delete(timer);
    cancel(timer);
  });
  await client.connect(room);
  assert.equal(timers.size, 0);
});

test("disconnect rejects turn and message waits instead of timing out", async (t) => {
  const { client, sockets } = await fixture(t);
  await client.connect(room);
  const turn = assert.rejects(client.waitForTurn(), /disconnected/);
  const message = assert.rejects(client.waitForMessage("state"), /disconnected/);
  sockets[0].close();
  await Promise.all([turn, message]);
  assert.equal(client.currentState, null);
});

test("throwing subscribers cannot block final state delivery or its acknowledgement", async (t) => {
  const { client, sockets } = await fixture(t);
  await client.connect(room);
  t.mock.method(console, "error", () => {});
  client.onMessage(() => {
    throw new Error("broken subscriber");
  });
  const ended = client.waitForMessage("game_ended");
  const acknowledgement = once(sockets[0], "message");
  emit(sockets[0], "game_ended", { finalState: { status: "ended" } });
  await ended;
  const [data] = await acknowledgement;
  assert.equal(JSON.parse(data).type, "rewatch_saved");
  assert.equal(client.currentState.status, "ended");
});

for (const stallAfterHeaders of [false, true])
  test(`REST deadline covers stalled ${stallAfterHeaders ? "response bodies" : "requests"}`, async (t) => {
    const server = createServer((_request, response) => {
      if (stallAfterHeaders) {
        response.writeHead(200, { "content-type": "application/json" });
        response.flushHeaders();
      }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });

    const client = new AgentClient({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      accessToken: "test-token",
      requestTimeoutMs: 100,
    });

    await assert.rejects(client.me(), (error) => error.name === "TimeoutError");
  });
