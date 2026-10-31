import { roomTestEnv } from "../../fixtures/room-env";

import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { describe, expect, it } from "vitest";

import { GomokuRoom } from "../../../durable-objects/GomokuRoom";
import type { GomokuGameState } from "../../../durable-objects/types";

class TestGomokuRoom extends GomokuRoom {
  snapshot() {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }
}

function createHarness(storage = new Map<string, unknown>()) {
  let alarmAt: number | null = null;

  const state = new MemoryRoomRuntime(
    storage,
    (at) => {
      alarmAt = at;
    },
    [],
    true,
  );

  const room = new TestGomokuRoom(state, roomTestEnv());

  return { room, storage, initialized: state.initialized };
}

async function post<T>(room: GomokuRoom, path: string, body: T): Promise<Response> {
  return room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function view(room: GomokuRoom, playerId: string) {
  const response = await room.fetch(
    new Request(`https://room.test/agent/view?playerId=${playerId}`),
  );

  return response.json<{
    state: GomokuGameState & {
      you?: { seat?: number | null; role?: string | null; legalActions?: string[] };
    };
  }>();
}

async function createStartedRoom() {
  const harness = createHarness();

  await post(harness.room, "/create", {
    hostId: "p1",
    hostName: "Player One",
    roomCode: "GMK234",
    turnTime: 30_000,
  });
  await post(harness.room, "/agent/join", { playerId: "p2", assignedCodename: "SwiftAnchor" });
  expect((await post(harness.room, "/agent/start", { playerId: "p1" })).status).toBe(200);

  return harness;
}

/** Both seats, with the seat to move first. */
async function seatsOf(room: GomokuRoom) {
  const started = await view(room, "p1");
  const first = started.state.turnState.currentPlayerId!;

  return { first, second: first === "p1" ? "p2" : "p1" };
}

describe("Gomoku room", () => {
  it("starts with black on move and offers only the current seat a placement", async () => {
    const { room } = await createStartedRoom();

    try {
      const started = await view(room, "p1");
      const { first, second } = await seatsOf(room);

      expect(started.state.type).toBe("gomoku");
      expect(started.state.status).toBe("playing");
      expect(started.state.board).toHaveLength(15);
      expect(started.state.board[0]).toHaveLength(15);
      // Seat order comes from the platform's draw; the starter is always black.
      // The agent `you` block is a fixed compact shape, so the seat number lives
      // in `state.seats`; the role is the part the agent view carries.
      expect(started.state.seats[first]).toBe(1);
      expect((await view(room, first)).state.you).toMatchObject({ role: "black" });
      expect((await view(room, second)).state.you).toMatchObject({ role: "white" });
      expect((await view(room, second)).state.seats[second]).toBe(2);
      expect((await view(room, first)).state.you?.legalActions).toContain("place_stone");
      expect((await view(room, second)).state.you?.legalActions ?? []).not.toContain("place_stone");
    } finally {
      await post(room, "/end", {});
    }
  });

  it("accepts a placement, hands the turn over and keeps the stone", async () => {
    const { room } = await createStartedRoom();

    try {
      const { first, second } = await seatsOf(room);

      const response = await post(room, "/agent/action", {
        playerId: first,
        actionType: "place_stone",
        data: { row: 7, col: 7 },
      });

      expect(response.status).toBe(200);

      const after = await view(room, second);

      expect(after.state.board[7]![7]).toBe(1);
      expect(after.state.turnState.currentPlayerId).toBe(second);
      expect(after.state.lastMove).toMatchObject({ row: 7, col: 7 });
      expect(after.state.you?.legalActions).toContain("place_stone");
    } finally {
      await post(room, "/end", {});
    }
  });

  it("rejects an occupied point, an off-board point and a move out of turn", async () => {
    const { room } = await createStartedRoom();

    try {
      const { first, second } = await seatsOf(room);

      expect(
        (
          await post(room, "/agent/action", {
            playerId: first,
            actionType: "place_stone",
            data: { row: 7, col: 7 },
          })
        ).status,
      ).toBe(200);

      const occupied = await post(room, "/agent/action", {
        playerId: second,
        actionType: "place_stone",
        data: { row: 7, col: 7 },
      });

      const offBoard = await post(room, "/agent/action", {
        playerId: second,
        actionType: "place_stone",
        data: { row: 15, col: 0 },
      });

      const occupiedBody = await occupied.json<{ error: { message: string } }>();
      const offBoardBody = await offBoard.json<{ error: { message: string } }>();

      expect(occupied.status).toBe(409);
      expect(offBoard.status).toBe(400);
      expect(occupiedBody.error.message).toBe("That point already has a stone");
      expect(offBoardBody.error.message).toContain("0–14");

      const outOfTurn = await post(room, "/agent/action", {
        playerId: first,
        actionType: "place_stone",
        data: { row: 0, col: 0 },
      });

      expect(outOfTurn.status).toBe(409);

      const unchanged = await view(room, "p1");

      expect(unchanged.state.board[0]![0]).toBe(0);
      expect(unchanged.state.turnState.currentPlayerId).toBe(second);
    } finally {
      await post(room, "/end", {});
    }
  });

  it("ends on five in a row and reports the winning line", async () => {
    const { room } = await createStartedRoom();

    try {
      const { first, second } = await seatsOf(room);

      const line = [
        { row: 7, col: 3 },
        { row: 0, col: 0 },
        { row: 7, col: 4 },
        { row: 0, col: 1 },
        { row: 7, col: 5 },
        { row: 0, col: 2 },
        { row: 7, col: 6 },
        { row: 0, col: 3 },
        { row: 7, col: 7 },
      ];

      let response: Response | null = null;

      for (const [index, point] of line.entries()) {
        response = await post(room, "/agent/action", {
          playerId: index % 2 === 0 ? first : second,
          actionType: "place_stone",
          data: point,
        });

        expect(response.status).toBe(200);
      }

      const ended = await response!.json<{ state: GomokuGameState }>();

      expect(ended.state.status).toBe("ended");
      expect(ended.state.winner).toBe(first);
      expect(ended.state.winLine).toHaveLength(5);
      expect(ended.state.turnState.phase).toBe("ended");
      expect((await view(room, first)).state.you?.legalActions ?? []).not.toContain("place_stone");
    } finally {
      await post(room, "/end", {});
    }
  });

  it("keeps the board across a room restart", async () => {
    const { room, storage } = await createStartedRoom();

    try {
      const { first } = await seatsOf(room);

      expect(
        (
          await post(room, "/agent/action", {
            playerId: first,
            actionType: "place_stone",
            data: { row: 7, col: 7 },
          })
        ).status,
      ).toBe(200);

      const restored = createHarness(storage);
      await restored.initialized;
      const reloaded = await view(restored.room, "p1");

      expect(reloaded.state.board[7]![7]).toBe(1);
      expect(reloaded.state.lastMove).toMatchObject({ row: 7, col: 7 });
      expect(reloaded.state.status).toBe("playing");
    } finally {
      await post(room, "/end", {});
    }
  });
});
