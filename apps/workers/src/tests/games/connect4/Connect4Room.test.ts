import { roomTestEnv } from "../../fixtures/room-env";

import type { WireObject } from "@llmgames/game-catalog";
import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { describe, expect, it } from "vitest";

import { Connect4Room } from "../../../durable-objects/Connect4Room";
import type { Connect4GameState } from "../../../durable-objects/types";

class TestConnect4Room extends Connect4Room {
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

  return { room: new TestConnect4Room(state, roomTestEnv()), storage };
}

async function post<T>(room: Connect4Room, path: string, body: T): Promise<Response> {
  return room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function view(room: Connect4Room, playerId: string) {
  const response = await room.fetch(
    new Request(`https://room.test/agent/view?playerId=${playerId}`),
  );

  return response.json<{ state: Connect4GameState & { you?: { legalActions?: string[] } } }>();
}

async function createStartedRoom() {
  const harness = createHarness();
  await post(harness.room, "/create", {
    hostId: "p1",
    hostName: "Player One",
    roomCode: "C4T234",
    turnTime: 30_000,
  });
  await post(harness.room, "/agent/join", {
    playerId: "p2",
    assignedCodename: "SwiftAnchor",
  });
  const started = await post(harness.room, "/agent/start", { playerId: "p1" });
  expect(started.status).toBe(200);

  return harness;
}

describe("Connect 4 room", () => {
  it("returns a decision-only wait response", async () => {
    const { room } = await createStartedRoom();

    try {
      const started = await view(room, "p1");
      const current = started.state.turnState.currentPlayerId!;

      const response = await post(room, "/agent/wait-turn", {
        playerId: current,
        timeoutMs: 1_000,
      });

      const body = await response.json<{
        timedOut: boolean;
        reason: string;
        revision: number;
        state: WireObject;
      }>();

      expect(body).toMatchObject({
        timedOut: false,
        reason: "your_turn",
        state: {
          gameType: "connect4",
          board: Array(6).fill("0000000"),
          legalColumns: [0, 1, 2, 3, 4, 5, 6],
          legalActions: ["drop_disc"],
        },
      });
      expect(body.state).not.toHaveProperty("players");
      expect(body.state).not.toHaveProperty("roomMembers");
      expect(body.state).not.toHaveProperty("you.playerId");
    } finally {
      await post(room, "/end", {});
    }
  });

  it("starts a public agent game and awards a horizontal win", async () => {
    const { room } = await createStartedRoom();

    try {
      const started = await view(room, "p1");
      const first = started.state.turnState.currentPlayerId!;
      const second = first === "p1" ? "p2" : "p1";
      const firstView = await view(room, first);

      expect(started.state.turnState.phase).toBe("play");
      expect(firstView.state.you?.legalActions).toContain("drop_disc");

      const moves = [
        [first, 0],
        [second, 0],
        [first, 1],
        [second, 1],
        [first, 2],
        [second, 2],
        [first, 3],
      ] as const;

      let finalAction: Response | null = null;

      for (const [playerId, col] of moves) {
        finalAction = await post(room, "/agent/action", {
          playerId,
          actionType: "drop_disc",
          data: { col },
        });
        expect(finalAction.status).toBe(200);
      }

      const ended = await finalAction!.json<{
        state: Connect4GameState & { you?: { legalActions?: string[] } };
      }>();

      expect(ended.state.status).toBe("ended");
      expect(ended.state.winner).toBe(first);
      expect(ended.state.turnState.phase).toBe("ended");
      expect(ended.state.lastMove).toMatchObject({ col: 3, seat: ended.state.seats[first] });
    } finally {
      await post(room, "/end", {});
    }
  });

  it("rejects out-of-turn moves and full columns without changing the board", async () => {
    const { room } = await createStartedRoom();

    try {
      const started = await view(room, "p1");
      const first = started.state.turnState.currentPlayerId!;
      const second = first === "p1" ? "p2" : "p1";

      const outOfTurn = await post(room, "/agent/action", {
        playerId: second,
        actionType: "drop_disc",
        data: { col: 0 },
      });

      expect(outOfTurn.status).toBe(409);

      for (let row = 0; row < 6; row++) {
        const playerId = row % 2 === 0 ? first : second;
        expect(
          (
            await post(room, "/agent/action", {
              playerId,
              actionType: "drop_disc",
              data: { col: 0 },
            })
          ).status,
        ).toBe(200);
      }

      const full = await post(room, "/agent/action", {
        playerId: first,
        actionType: "drop_disc",
        data: { col: 0 },
      });

      expect(full.status).toBe(409);
      const body = await full.json<{ error: { message: string }; state: Connect4GameState }>();
      expect(body.error.message).toBe("Column is full");
      expect(body.state.board.flat().filter((cell) => cell !== 0)).toHaveLength(6);
    } finally {
      await post(room, "/end", {});
    }
  });
});
