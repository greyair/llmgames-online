import { roomTestEnv } from "../../fixtures/room-env";

import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { describe, expect, it } from "vitest";

import { ReversiRoom } from "../../../durable-objects/ReversiRoom";
import type { ReversiGameState } from "../../../durable-objects/types";

class TestReversiRoom extends ReversiRoom {
  snapshot() {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }
}

function createHarness() {
  const storage = new Map<string, unknown>();
  let alarmAt: number | null = null;

  const state = new MemoryRoomRuntime(storage, (at) => {
    alarmAt = at;
  });

  return { room: new TestReversiRoom(state, roomTestEnv()), storage };
}

async function post<T>(room: ReversiRoom, path: string, body: T): Promise<Response> {
  return room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function getState(room: ReversiRoom, playerId: string) {
  const response = await room.fetch(
    new Request(`https://room.test/agent/view?playerId=${playerId}`),
  );

  return response.json<{ state: ReversiGameState & { you?: { legalActions?: string[] } } }>();
}

async function startRoom() {
  const harness = createHarness();
  await post(harness.room, "/create", {
    hostId: "p1",
    hostName: "Player One",
    roomCode: "REV234",
    turnTime: 30_000,
  });
  await post(harness.room, "/agent/join", {
    playerId: "p2",
    assignedCodename: "SwiftAnchor",
  });
  expect((await post(harness.room, "/agent/start", { playerId: "p1" })).status).toBe(200);

  return harness;
}

describe("Reversi room", () => {
  it("serves legal moves through the public agent route and applies a placement", async () => {
    const { room } = await startRoom();
    const initial = await getState(room, "p1");
    const currentPlayer = initial.state.turnState.currentPlayerId!;
    const currentView = await getState(room, currentPlayer);
    const move = initial.state.legalMoves[0]!;

    expect(initial.state.turnState.phase).toBe("play");
    expect(initial.state.legalMoves).toHaveLength(4);
    expect(currentView.state.you?.legalActions).toContain("place_disc");

    const illegal = await post(room, "/agent/action", {
      playerId: currentPlayer,
      actionType: "place_disc",
      data: { row: 0, col: 0 },
    });

    expect(illegal.status).toBe(422);

    const placed = await post(room, "/agent/action", {
      playerId: currentPlayer,
      actionType: "place_disc",
      data: { row: move.row, col: move.col },
    });

    expect(placed.status).toBe(200);
    const body = await placed.json<{ state: ReversiGameState }>();

    expect(body.state.board[move.row]![move.col]).toBe(1);
    expect(body.state.scores).toEqual({ 1: 4, 2: 1 });
    expect(body.state.lastMove).toMatchObject({
      playerId: currentPlayer,
      row: move.row,
      col: move.col,
      flipped: [{ row: 3, col: 3 }],
    });
    expect(body.state.turnState.currentPlayerId).not.toBe(currentPlayer);

    await post(room, "/end", {});
  });
});
