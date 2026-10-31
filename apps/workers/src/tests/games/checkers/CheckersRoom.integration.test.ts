import { roomTestEnv } from "../../fixtures/room-env";
import { parseJevView } from "../../../agents/jev";
import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { TestRoomSocket } from "../../fixtures/socket";

import { describe, it, expect } from "vitest";
import {
  CheckersRoom,
  getCheckersLegalMoves,
  countCheckersPieces,
} from "../../../durable-objects/CheckersRoom";
import type { CheckersGameState, CheckersCell, Player } from "../../../durable-objects/types";

import {
  compactAgentDecisionState,
  getGameToolSchema,
  listGameToolsCatalog,
} from "@llmgames/game-catalog";
import { compactState } from "../../../games/agent-decision";
import { broadcastProjection } from "../../../lib/broadcastProjection";
import { jevDecision } from "../../../agents/jev";

class TestRoom extends CheckersRoom {
  async position(board: CheckersCell[][], seat: 1 | 2 = 1, quietTurns = 0) {
    const s = this.gameState!;
    s.board = board;
    s.seats = { p1: 1, p2: 2 };
    s.scores = countCheckersPieces(board);
    s.turnState.currentPlayerId = seat === 1 ? "p1" : "p2";
    s.legalMoves = getCheckersLegalMoves(board, seat);
    s.forcedPiece = null;
    s.quietTurns = quietTurns;
    s.positionCounts = {};
    await this.saveState();
  }
  attach(ws: WebSocket, id: string, spectator = false) {
    this.sessions.set(ws, {
      id,
      name: id,
      isConnected: true,
      joinedAt: Date.now(),
      socket: ws,
      isSpectator: spectator,
    } satisfies Player);
  }
  async timeout() {
    await this.onTurnTimeout(this.gameState!.turnState.currentPlayerId);
  }
  async expireMatch() {
    this.gameState!.gameTimeRemaining = 0;
    await this.alarm();
  }
  addSpectator() {
    this.gameState!.spectators = [
      { id: "watcher", name: "QuietMoon", isAgent: true, channel: "mcp" },
    ];
  }
  async persist() {
    await this.saveState();
  }
  stop() {
    this.stopTimers();
  }
}

function harness(storage = new Map<string, unknown>()) {
  let alarm: number | null = null;
  let initialized: Promise<unknown> = Promise.resolve();
  const sockets: WebSocket[] = [];

  const state = new MemoryRoomRuntime(
    storage,
    (at) => {
      alarm = at;
    },
    sockets,
    true,
  );

  const room = new TestRoom(state, roomTestEnv());
  initialized = state.initialized;

  return { room, storage, sockets, initialized };
}

async function post<T>(room: CheckersRoom, path: string, body: T) {
  return room.fetch(
    new Request(`http://room${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function view(room: CheckersRoom, id = "p1") {
  const r = await room.fetch(new Request(`http://room/agent/view?playerId=${id}`));

  return (
    await r.json<{
      state: CheckersGameState & {
        you: {
          legalActions: string[];
          isSpectator: boolean;
        };
      };
    }>()
  ).state;
}

async function ready() {
  const h = harness();
  expect(
    (await post(h.room, "/create", { hostId: "p1", hostName: "One", roomCode: "CHK234" })).status,
  ).toBe(200);
  expect((await post(h.room, "/agent/start", { playerId: "p1" })).status).not.toBe(200);
  await post(h.room, "/agent/join", { playerId: "p2", assignedCodename: "SwiftAnchor" });
  expect((await post(h.room, "/agent/start", { playerId: "p1" })).status).toBe(200);

  return h;
}

async function move<T>(room: CheckersRoom, playerId: string, data: T) {
  return post(room, "/agent/action", { playerId, actionType: "move_checker", data });
}

const empty = (): CheckersCell[][] =>
  Array.from({ length: 8 }, () => Array<CheckersCell>(8).fill(0));

describe("Checkers room transport and lifecycle", () => {
  it("publishes MCP schemas and Jev choices from legal moves only", async () => {
    expect(
      listGameToolsCatalog("checkers").games.checkers?.some((a) => a.actionType === "move_checker"),
    ).toBe(true);
    expect(getGameToolSchema("move_checker", "checkers")).toMatchObject({
      send_action: { dataRequired: ["fromRow", "fromCol", "row", "col"] },
    });
    const { room } = await ready();
    const s = await view(room);
    const actor = s.turnState.currentPlayerId!;
    const projected = await view(room, actor);
    const compact = compactState(projected);
    expect(compact).toMatchObject({ gameType: "checkers", legalMoves: s.legalMoves });
    const jev = jevDecision(parseJevView(compact))!;
    expect(Object.keys(jev.options)).toHaveLength(7);
    expect(Object.values(jev.options)[0]!.action).toMatchObject({
      actionType: "move_checker",
      data: s.legalMoves[0] && { fromRow: s.legalMoves[0].fromRow },
    });
    expect(projected).not.toHaveProperty("positionCounts");
    room.stop();
  });
  it("rejects malformed, illegal, out-of-turn and spectator intents without mutation", async () => {
    const { room } = await ready();

    const s = await view(room),
      actor = s.turnState.currentPlayerId!,
      other = actor === "p1" ? "p2" : "p1";

    for (const data of [
      null,
      {},
      { fromRow: 5.5, fromCol: 0, row: 4, col: 1 },
      { fromRow: 5, fromCol: 0, row: -1, col: 1 },
      { fromRow: 5, fromCol: 0, row: 3, col: 0 },
    ])
      expect((await move(room, actor, data)).status).not.toBe(200);
    expect((await move(room, other, s.legalMoves[0])).status).not.toBe(200);
    room.addSpectator();
    expect((await view(room, "watcher")).you.isSpectator).toBe(true);
    expect((await move(room, "watcher", s.legalMoves[0])).status).not.toBe(200);
    expect((await view(room)).board).toEqual(s.board);
    room.stop();
  });
  it("keeps a chain on the same player and same timer, persists it on reload, and rejects switching pieces", async () => {
    const { room, storage } = await ready();
    const b = empty();
    b[5]![0] = 1;
    b[4]![1] = 2;
    b[2]![3] = 2;
    b[0]![7] = 2;
    b[5]![6] = 1;
    await room.position(b);
    const timer = (await view(room)).turnState.startedAt;
    expect((await move(room, "p1", { fromRow: 5, fromCol: 0, row: 3, col: 2 })).status).toBe(200);
    let s = await view(room);
    expect(s.forcedPiece).toEqual({ row: 3, col: 2 });
    expect(s.turnState.currentPlayerId).toBe("p1");
    expect(s.turnState.startedAt).toBe(timer);
    expect((await move(room, "p1", { fromRow: 5, fromCol: 6, row: 4, col: 5 })).status).not.toBe(
      200,
    );
    room.stop();
    const h = harness(storage);
    await h.initialized;
    const restored = h.room;
    s = await view(restored);
    expect(s.forcedPiece).toEqual({ row: 3, col: 2 });
    expect((await move(restored, "p1", { fromRow: 3, fromCol: 2, row: 1, col: 4 })).status).toBe(
      200,
    );
    s = await view(restored);
    expect(s.forcedPiece).toBeNull();
    expect(s.turnState.currentPlayerId).toBe("p2");
    expect(s.scores).toEqual({ 1: 2, 2: 1 });
    restored.stop();
  });
  it("crowns and ends the turn even with a backward capture available", async () => {
    const { room } = await ready();
    const b = empty();
    b[2]![1] = 1;
    b[1]![2] = 2;
    b[1]![4] = 2;
    await room.position(b);
    expect((await move(room, "p1", { fromRow: 2, fromCol: 1, row: 0, col: 3 })).status).toBe(200);
    const s = await view(room);
    expect(s.board[0]![3]).toBe(3);
    expect(s.lastMove?.crowned).toBe(true);
    expect(s.forcedPiece).toBeNull();
    expect(s.turnState.currentPlayerId).toBe("p2");
    room.stop();
  });
  it("wins by blocking the opponent, delivers one terminal replay, and strips private state", async () => {
    const { room, sockets } = await ready();
    const sent: string[] = [];

    const ws = Object.assign(new TestRoomSocket(), {
      readyState: WebSocket.OPEN,
      send: (v: string) => sent.push(v),
      close: () => {},
    });

    sockets.push(ws);
    room.attach(ws, "p1");
    const b = empty();
    b[7]![0] = 2;
    b[5]![2] = 1;
    await room.position(b);
    const response = await move(room, "p1", { fromRow: 5, fromCol: 2, row: 4, col: 1 });
    expect(response.status).toBe(200);

    const result = await response.json<{
      state: CheckersGameState;
    }>();

    expect(result.state).toMatchObject({ status: "ended", winner: "p1", legalMoves: [] });

    const terminal = sent.flatMap((value) => {
      const message = JSON.parse(value);

      return message.type === "game_ended" ? [message] : [];
    });

    expect(terminal).toHaveLength(1);
    expect(terminal[0].payload.rewatch).toMatchObject({
      gameType: "checkers",
      visibility: "full_reveal",
    });
    expect(JSON.stringify(terminal[0].payload.rewatch)).not.toContain("positionCounts");
    const broadcast = broadcastProjection(result.state, result.state.players);
    expect(broadcast).toMatchObject({
      type: "checkers",
      board: result.state.board,
      seats: { "seat-1": 1, "seat-2": 2 },
    });
    expect(JSON.stringify(broadcast)).not.toContain("CHK234");
    await room.webSocketMessage(ws, JSON.stringify({ type: "rewatch_saved" }));
    room.stop();
  });
  it("draws automatically on repetition and on 80 quiet turns", async () => {
    for (const quiet of [0, 79]) {
      const { room } = await ready();
      const b = empty();
      b[7]![0] = 3;
      b[0]![7] = 4;
      await room.position(b, 1, quiet);

      const cycle = [
        ["p1", { fromRow: 7, fromCol: 0, row: 6, col: 1 }],
        ["p2", { fromRow: 0, fromCol: 7, row: 1, col: 6 }],
        ["p1", { fromRow: 6, fromCol: 1, row: 7, col: 0 }],
        ["p2", { fromRow: 1, fromCol: 6, row: 0, col: 7 }],
      ] as const;

      for (let i = 0; i < 12; i++) {
        const [id, data] = cycle[i % 4]!;
        expect((await move(room, id, data)).status).toBe(200);

        if ((await view(room)).status === "ended") break;
      }

      expect(await view(room)).toMatchObject({ status: "ended", winner: "draw", legalMoves: [] });
      room.stop();
    }
  });
  it("returns forced continuations immediately to agent waiters", async () => {
    const { room } = await ready();
    const b = empty();
    b[5]![0] = 1;
    b[4]![1] = 2;
    b[2]![3] = 2;
    await room.position(b);
    await move(room, "p1", { fromRow: 5, fromCol: 0, row: 3, col: 2 });
    const response = await post(room, "/agent/wait-turn", { playerId: "p1", timeoutMs: 1000 });
    expect(await response.json()).toMatchObject({
      reason: "your_turn",
      state: {
        forcedPiece: { row: 3, col: 2 },
        legalMoves: [{ fromRow: 3, fromCol: 2, row: 1, col: 4 }],
      },
    });
    room.stop();
  });
  it("draws on match expiry regardless of material", async () => {
    const { room } = await ready();
    const b = empty();
    b[5]![0] = 1;
    b[5]![2] = 3;
    b[0]![7] = 2;
    await room.position(b);
    await room.expireMatch();
    expect(await view(room)).toMatchObject({
      status: "ended",
      winner: "draw",
      legalMoves: [],
      forcedPiece: null,
    });
    room.stop();
  });
  it("forfeits the match on turn timeout, including during a jump chain", async () => {
    const { room } = await ready();
    const b = empty();
    b[5]![0] = 1;
    b[4]![1] = 2;
    b[2]![3] = 2;
    await room.position(b);
    await move(room, "p1", { fromRow: 5, fromCol: 0, row: 3, col: 2 });
    await room.timeout();
    expect(await view(room)).toMatchObject({
      status: "ended",
      winner: "p2",
      forcedPiece: null,
      legalMoves: [],
    });
    room.stop();
  });
  it("can complete a whole match using only server-projected legal intents", async () => {
    const { room } = await ready();
    let s = await view(room);
    let count = 0;

    // Test driver only: real MCP turns are always selected by the host model.
    while (s.status === "playing" && count < 600) {
      const actor = s.turnState.currentPlayerId!;
      const m = s.legalMoves[(count * 17 + 3) % s.legalMoves.length]!;
      expect(m).toBeTruthy();
      const result = await move(room, actor, m);
      expect(result.status).toBe(200);
      s = (
        await result.json<{
          state: typeof s;
        }>()
      ).state;
      count++;
    }

    expect(s.status).toBe("ended");
    expect(s.winner).toBeTruthy();
    expect(count).toBeGreaterThan(10);
    room.stop();
  });
});
