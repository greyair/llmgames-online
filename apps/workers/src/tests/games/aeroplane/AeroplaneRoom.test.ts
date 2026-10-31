import { roomTestEnv } from "../../fixtures/room-env";

import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AeroplaneRoom } from "../../../durable-objects/AeroplaneRoom";
import type { AeroplaneGameState } from "../../../durable-objects/types";

class TestAeroplaneRoom extends AeroplaneRoom {
  snapshot() {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }
}

function createHarness(storage = new Map<string, unknown>()) {
  const state = new MemoryRoomRuntime(
    storage,
    () => {},
    [],
    true,
  );

  const room = new TestAeroplaneRoom(state, roomTestEnv());

  return { room, storage, initialized: state.initialized };
}

async function post<T>(room: AeroplaneRoom, path: string, body: T): Promise<Response> {
  return room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function view(room: AeroplaneRoom, playerId: string) {
  const response = await room.fetch(
    new Request(`https://room.test/agent/view?playerId=${playerId}`),
  );

  return response.json<{
    state: AeroplaneGameState & {
      you?: { seat?: number | null; legalActions?: string[] };
    };
  }>();
}

async function createStartedRoom(seats = 2) {
  const harness = createHarness();

  await post(harness.room, "/create", {
    hostId: "p1",
    hostName: "Player One",
    roomCode: "AER234",
    maxPlayers: seats,
    turnTime: 30_000,
  });

  await post(harness.room, "/agent/join", { playerId: "p2", assignedCodename: "SwiftAnchor" });

  if (seats > 2)
    await post(harness.room, "/agent/join", { playerId: "p3", assignedCodename: "QuietForge" });

  if (seats > 3)
    await post(harness.room, "/agent/join", { playerId: "p4", assignedCodename: "QuartzAnvil" });

  expect((await post(harness.room, "/agent/start", { playerId: "p1" })).status).toBe(200);

  return harness;
}

/**
 * Fixes the next die rolls.
 *
 * The room rolls through the platform CSPRNG, so a test drives it by filling the
 * draw buffer: `randomInt` takes the remainder of a uint32, so face - 1 lands on
 * the face we want and the production path is otherwise untouched.
 */
function rigDice(faces: readonly number[]) {
  let index = 0;

  return vi.spyOn(crypto, "getRandomValues").mockImplementation(
    // SAFETY: the room only reads a Uint32Array back, and a face minus one is a
    // draw it could have made; nothing else about the signature changes.
    ((buffer: Uint32Array) => {
      const face = faces[index] ?? faces[faces.length - 1] ?? 1;

      index += 1;
      buffer[0] = face - 1;

      return buffer;
    }) as typeof crypto.getRandomValues,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Aeroplane room", () => {
  it("deals a colour and four hangared planes to every seat", async () => {
    const { room } = await createStartedRoom(3);

    try {
      const started = await view(room, "p1");

      expect(started.state.type).toBe("aeroplane");
      expect(started.state.status).toBe("playing");
      expect(started.state.turnState.phase).toBe("roll");
      expect(started.state.colours).toEqual([0, 1, 2]);
      expect(started.state.planes).toEqual([
        [-1, -1, -1, -1],
        [-1, -1, -1, -1],
        [-1, -1, -1, -1],
      ]);
      expect(started.state.takeoff).toEqual([6]);

      // Every seat owns one number: the platform's draw only decides who starts.
      expect(Object.values(started.state.seats).sort()).toEqual([0, 1, 2]);

      const mover = started.state.turnState.currentPlayerId!;

      expect((await view(room, mover)).state.you?.legalActions).toContain("roll");
    } finally {
      await post(room, "/end", {});
    }
  });

  it("offers the dice to one seat at a time", async () => {
    const { room } = await createStartedRoom();

    try {
      const started = await view(room, "p1");
      const first = started.state.turnState.currentPlayerId!;
      const second = first === "p1" ? "p2" : "p1";

      expect((await view(room, first)).state.you?.legalActions).toContain("roll");
      expect((await view(room, second)).state.you?.legalActions ?? []).not.toContain("roll");
    } finally {
      await post(room, "/end", {});
    }
  });

  it("rolls once per request and replays a repeated receipt instead of rolling again", async () => {
    const { room } = await createStartedRoom();

    // Rigged after the room is running: the opening seat is drawn from the same
    // CSPRNG and would otherwise spend the first face.
    rigDice([6, 2]);

    try {
      const started = await view(room, "p1");
      const first = started.state.turnState.currentPlayerId!;

      const firstRoll = await post(room, "/agent/action", {
        playerId: first,
        actionType: "roll",
        requestId: "roll-one",
      });

      expect(firstRoll.status).toBe(200);

      const afterFirst = await view(room, first);

      expect(afterFirst.state.roll).toBe(6);
      expect(afterFirst.state.sixes).toBe(1);
      expect(afterFirst.state.turnState.phase).toBe("choose");

      const replay = await post(room, "/agent/action", {
        playerId: first,
        actionType: "roll",
        requestId: "roll-one",
      });

      expect(replay.status).toBe(200);
      expect((await view(room, first)).state.roll).toBe(6);
      expect((await view(room, first)).state.sixes).toBe(1);

      expect(
        (
          await post(room, "/agent/action", {
            playerId: first,
            actionType: "launch_plane",
            data: { plane: 1 },
          })
        ).status,
      ).toBe(200);

      const afterLaunch = await view(room, first);

      expect(afterLaunch.state.planes[afterLaunch.state.seats[first]!]).toEqual([0, -1, -1, -1]);
      // A six keeps the dice in the same hands.
      expect(afterLaunch.state.turnState.currentPlayerId).toBe(first);
      expect(afterLaunch.state.turnState.phase).toBe("roll");
    } finally {
      await post(room, "/end", {});
    }
  });

  it("keeps an unresolved roll across a room restart", async () => {
    const { room, storage } = await createStartedRoom();

    rigDice([3]);

    try {
      const started = await view(room, "p1");
      const first = started.state.turnState.currentPlayerId!;

      // One plane already out, so the roll has somewhere to go and the turn
      // stops in `choose` where the die is still owed.
      room.snapshot().planes[started.state.seats[first]!]![0] = 5;

      expect((await post(room, "/agent/action", { playerId: first, actionType: "roll" })).status).toBe(200);

      const restored = createHarness(storage);
      await restored.initialized;
      const reloaded = await view(restored.room, first);

      // The die belongs to the state, not to a live object: nothing rolls twice.
      expect(reloaded.state.roll).toBe(3);
      expect(reloaded.state.sixes).toBe(0);
      expect(reloaded.state.turnState.phase).toBe("choose");
      expect((await view(restored.room, first)).state.you?.legalActions).toContain("move_plane");
    } finally {
      await post(room, "/end", {});
    }
  });

  it("refuses a launch once the roll cannot clear the hangar", async () => {
    const { room } = await createStartedRoom();

    rigDice([4]);

    try {
      const started = await view(room, "p1");
      const first = started.state.turnState.currentPlayerId!;

      room.snapshot().planes[started.state.seats[first]!]![0] = 5;

      expect((await post(room, "/agent/action", { playerId: first, actionType: "roll" })).status).toBe(200);

      const launch = await post(room, "/agent/action", {
        playerId: first,
        actionType: "launch_plane",
        data: { plane: 2 },
      });

      // A four cannot clear the hangar, so `launch_plane` is not on offer at
      // all and the platform refuses the intent before the rule module sees it.
      expect(launch.status).toBe(422);
      expect((await view(room, first)).state.you?.legalActions).toContain("move_plane");
      expect((await view(room, first)).state.you?.legalActions).not.toContain("launch_plane");
    } finally {
      await post(room, "/end", {});
    }
  });

  it("hides the decisions from spectators but shows them the board", async () => {
    const { room } = await createStartedRoom();

    try {
      // Spectators arrive over the socket in production; the fixture adds one
      // straight to the roster so the projection can be inspected.
      room.snapshot().spectators = [{ id: "watcher", name: "Watcher" }];

      const watched = await view(room, "watcher");

      expect((watched.state.you?.legalActions ?? [])).not.toContain("roll");
      expect(watched.state.colours).toEqual([0, 2]);
      expect(watched.state.planes).toHaveLength(2);
    } finally {
      await post(room, "/end", {});
    }
  });

  it("ends the room with four planes home", async () => {
    const { room } = await createStartedRoom();

    rigDice([4]);

    try {
      const started = await view(room, "p1");
      const first = started.state.turnState.currentPlayerId!;
      const seat = started.state.seats[first]!;

      // Three planes are already parked at the centre; the fourth needs a four.
      room.snapshot().planes[seat] = [59, 59, 59, 55];

      expect((await post(room, "/agent/action", { playerId: first, actionType: "roll" })).status).toBe(200);

      const home = await post(room, "/agent/action", {
        playerId: first,
        actionType: "move_plane",
        data: { plane: 4 },
      });

      expect(home.status).toBe(200);

      const ended = await view(room, first);

      expect(ended.state.status).toBe("ended");
      expect(ended.state.winner).toBe(first);
      expect(ended.state.turnState.phase).toBe("ended");
      expect(ended.state.planes[seat]).toEqual([59, 59, 59, 59]);
    } finally {
      await post(room, "/end", {});
    }
  });
});
