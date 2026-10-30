import { roomTestEnv } from "../../fixtures/room-env";

import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { describe, expect, it } from "vitest";

import { generateCodename } from "../../../lib/codenames";
import type { CodenamesCard } from "../../../durable-objects/types";
import {
  CodenamesGameRoom,
  createCodenamesAffiliations,
  createCodenamesAssignments,
  createCodenamesBoard,
  normalizeCodenamesAssignments,
  projectCodenamesBoard,
  validateCodenamesAssignments,
} from "../../../durable-objects/CodenamesGameRoom";

describe("official Codenames setup", () => {
  it.each(["red", "blue"] as const)(
    "gives the starting %s team 9 agents and the other team 8",
    (startingTeam) => {
      const key = createCodenamesAffiliations(startingTeam);

      const counts = key.reduce(
        (result, affiliation) => {
          result[affiliation] += 1;

          return result;
        },
        { red: 0, blue: 0, neutral: 0, assassin: 0 },
      );

      expect(key).toHaveLength(25);
      expect(counts[startingTeam]).toBe(9);
      expect(counts[startingTeam === "red" ? "blue" : "red"]).toBe(8);
      expect(counts.neutral).toBe(7);
      expect(counts.assassin).toBe(1);
    },
  );

  it("deals 25 unique visible codenames", () => {
    const pool = Array.from({ length: 30 }, (_, index) => `word${index}`);
    const board = createCodenamesBoard("red", pool);

    expect(board).toHaveLength(25);
    expect(new Set(board.map((card) => card.word)).size).toBe(25);
    expect(board.every((card) => !card.revealed && card.revealedBy === null)).toBe(true);
  });

  it("deduplicates custom word pools case-insensitively", () => {
    const pool = [
      "Anchor",
      " anchor ",
      ...Array.from({ length: 24 }, (_, index) => `word${index}`),
    ];

    const board = createCodenamesBoard("red", pool);
    const normalized = board.map((card) => card.word.toLocaleLowerCase());

    expect(board).toHaveLength(25);
    expect(new Set(normalized).size).toBe(25);
    expect(normalized.filter((word) => word === "anchor")).toHaveLength(1);
  });

  it.each([4, 5, 6, 7, 8])(
    "balances %i players with one spymaster and at least one operative per team",
    (playerCount) => {
      const assignments = createCodenamesAssignments(
        Array.from({ length: playerCount }, (_, index) => `p${index + 1}`),
      );

      const seats = Object.values(assignments);
      const red = seats.filter((seat) => seat.team === "red");
      const blue = seats.filter((seat) => seat.team === "blue");

      expect(seats).toHaveLength(playerCount);
      expect(Math.abs(red.length - blue.length)).toBeLessThanOrEqual(1);
      expect(red.filter((seat) => seat.role === "spymaster")).toHaveLength(1);
      expect(blue.filter((seat) => seat.role === "spymaster")).toHaveLength(1);
      expect(red.some((seat) => seat.role === "operative")).toBe(true);
      expect(blue.some((seat) => seat.role === "operative")).toBe(true);
    },
  );

  it("rejects unsupported or duplicate player lists", () => {
    expect(() => createCodenamesAssignments(["p1", "p2", "p3"])).toThrow("4–8");
    expect(() =>
      createCodenamesAssignments(Array.from({ length: 9 }, (_, index) => `p${index + 1}`)),
    ).toThrow("4–8");
    expect(() => createCodenamesAssignments(["p1", "p2", "p3", "p3"])).toThrow("unique");
  });

  it("rejects incomplete, unbalanced, or roleless lobby arrangements", () => {
    const valid = {
      p1: { team: "red", role: "spymaster" },
      p2: { team: "blue", role: "spymaster" },
      p3: { team: "red", role: "operative" },
      p4: { team: "blue", role: "operative" },
    } as const;

    expect(validateCodenamesAssignments(["p1", "p2", "p3", "p4"], valid)).toBeNull();
    expect(
      validateCodenamesAssignments(["p1", "p2", "p3", "p4"], {
        p1: valid.p1,
        p2: valid.p2,
        p3: valid.p3,
      }),
    ).toMatchObject({
      message: "Assign every player to a Codenames role before starting",
      code: "CODENAMES_ROLES_INCOMPLETE",
    });
    expect(
      validateCodenamesAssignments(["p1", "p2", "p3", "p4"], {
        ...valid,
        p2: { team: "blue", role: "operative" },
      }),
    ).toMatchObject({ code: "CODENAMES_SPYMASTER_COUNT" });
    expect(
      validateCodenamesAssignments(["p1", "p2", "p3", "p4", "p5", "p6"], {
        ...valid,
        p5: { team: "red", role: "operative" },
        p6: { team: "red", role: "operative" },
      }),
    ).toMatchObject({ code: "CODENAMES_TEAMS_UNBALANCED" });
  });

  it("fills defaults without replacing explicit roles", () => {
    const assignments = normalizeCodenamesAssignments(["p1", "p2", "p3", "p4"], {
      p1: { team: "blue", role: "operative" },
      p2: { team: "red", role: "spymaster" },
    });

    expect(assignments.p1).toEqual({ team: "blue", role: "operative" });
    expect(assignments.p2).toEqual({ team: "red", role: "spymaster" });
    expect(validateCodenamesAssignments(["p1", "p2", "p3", "p4"], assignments)).toBeNull();
  });
});

describe("Codenames fog of war", () => {
  const board: CodenamesCard[] = [
    { index: 0, word: "anchor", affiliation: "red", revealed: false, revealedBy: null },
    { index: 1, word: "moon", affiliation: "assassin", revealed: false, revealedBy: null },
    { index: 2, word: "river", affiliation: "neutral", revealed: true, revealedBy: "p1" },
  ];

  it("hides unrevealed identities from operatives", () => {
    expect(projectCodenamesBoard(board, false).map((card) => card.affiliation)).toEqual([
      null,
      null,
      "neutral",
    ]);
  });

  it("shows the complete key to spymasters and full-reveal replays", () => {
    expect(projectCodenamesBoard(board, true).map((card) => card.affiliation)).toEqual([
      "red",
      "assassin",
      "neutral",
    ]);
  });
});

type AgentActionResponse = {
  ok?: boolean;
  state?: {
    status?: string;
    players?: Array<{ id: string }>;
    spectators?: Array<{ id: string }>;
    board?: Array<{
      index: number;
      word: string;
      affiliation: string | null;
      revealed: boolean;
    }>;
    assignments?: Record<string, { team: "red" | "blue"; role: "spymaster" | "operative" }>;
    activeTeam?: "red" | "blue";
    guessesRemaining?: number | null;
    remaining?: Record<"red" | "blue", number>;
    turnState?: {
      phase?: string;
      currentPlayerId?: string | null;
      turnTimeRemaining?: number;
    };
    winnerTeam?: "red" | "blue" | null;
    you?: {
      team?: "red" | "blue" | null;
      role?: string | null;
      canSeeKey?: boolean;
      isHost?: boolean;
      isSpectator?: boolean;
      isYourTurn?: boolean;
      legalActions?: string[];
    };
  };
};

class TestCodenamesRoom extends CodenamesGameRoom {
  snapshot() {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }
}

function createRoomHarness() {
  const storage = new Map<string, unknown>();
  let alarmAt: number | null = null;

  const state = new MemoryRoomRuntime(storage, (at) => {
    alarmAt = at;
  });

  return {
    room: new TestCodenamesRoom(state, roomTestEnv()),
    storage,
  };
}

async function postJson<T>(
  room: CodenamesGameRoom,
  path: string,
  body: T,
): Promise<AgentActionResponse> {
  const response = await room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

  expect(response.ok).toBe(true);

  return response.json<AgentActionResponse>();
}

async function getState(room: CodenamesGameRoom, playerId: string) {
  const response = await room.fetch(
    new Request(`https://room.test/agent/view?playerId=${encodeURIComponent(playerId)}`),
  );

  expect(response.ok).toBe(true);

  return (await response.json<AgentActionResponse>()).state!;
}

async function rejectedAction<T>(
  room: CodenamesGameRoom,
  playerId: string,
  actionType: string,
  data: T,
) {
  const response = await room.fetch(
    new Request("https://room.test/agent/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId, actionType, data }),
    }),
  );

  expect(response.ok).toBe(false);

  return response;
}

async function startPlayerRoom(playerCount = 4, turnTime = 60_000) {
  const { room, storage } = createRoomHarness();
  await postJson(room, "/create", {
    hostId: "p1",
    hostName: "Host",
    roomCode: "ABC234",
    maxPlayers: 8,
    turnTime,
  });

  for (let index = 2; index <= playerCount; index++) {
    const playerId = `p${index}`;
    await postJson(room, "/agent/join", {
      playerId: playerId,
      assignedCodename: generateCodename(),
      ownerGamertag: playerId,
      environmentLabel: "Vitest",
    });
  }

  for (let index = 1; index <= playerCount; index++) {
    const assignment =
      index === 1
        ? { team: "red", role: "spymaster" }
        : index === 2
          ? { team: "blue", role: "spymaster" }
          : {
              team: index % 2 === 1 ? "red" : "blue",
              role: "operative",
            };

    await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "assign_codenames_role",
      data: { playerId: `p${index}`, ...assignment },
    });
  }

  const started = await postJson(room, "/agent/start", { playerId: "p1" });
  expect(started.state?.status).toBe("playing");

  return { room, storage, state: started.state! };
}

describe("Codenames lobby roles", () => {
  it("enforces a 30-second minimum turn timer", async () => {
    const { room, storage } = createRoomHarness();
    await postJson(room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "ABC234",
      maxPlayers: 8,
      turnTime: 10_000,
    });

    const stored = room.snapshot();
    expect(stored.timerConfig.turnTime).toBe(30_000);
    expect(stored.turnState.turnTimeRemaining).toBe(30_000);
  });

  it("lets the host organize from spectators without taking a player role", async () => {
    const { room, storage } = createRoomHarness();
    await postJson(room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "ABC234",
      maxPlayers: 8,
    });

    for (let index = 2; index <= 5; index++) {
      await postJson(room, "/agent/join", {
        playerId: `p${index}`,
        assignedCodename: generateCodename(),
        ownerGamertag: `p${index}`,
        environmentLabel: "Vitest",
      });
    }

    const hosting = await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "set_host_spectating",
      data: { spectating: true },
    });

    expect(hosting.state?.players?.map((player) => player.id)).toEqual(["p2", "p3", "p4", "p5"]);
    const storedLobby = room.snapshot();
    expect(storedLobby.spectators?.map((player) => player.id)).toContain("p1");
    expect(hosting.state?.you).toMatchObject({
      isHost: true,
      isSpectator: true,
      team: null,
      role: "spectator",
    });
    expect(hosting.state?.you?.legalActions).toEqual(
      expect.arrayContaining(["start_game", "assign_codenames_role", "set_host_spectating"]),
    );

    const roles = [
      ["p2", "red", "spymaster"],
      ["p3", "blue", "spymaster"],
      ["p4", "red", "operative"],
      ["p5", "blue", "operative"],
    ] as const;

    for (const [playerId, team, role] of roles) {
      await postJson(room, "/agent/action", {
        playerId: "p1",
        actionType: "assign_codenames_role",
        data: { playerId, team, role },
      });
    }

    const started = await postJson(room, "/agent/start", { playerId: "p1" });
    expect(started.state).toMatchObject({
      status: "playing",
      you: { isHost: true, isSpectator: true, role: "spectator" },
    });
    expect(started.state?.assignments).not.toHaveProperty("p1");
  });

  it("lets a spectator-host reclaim an available player seat without restoring a stale role", async () => {
    const { room, storage } = createRoomHarness();
    await postJson(room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "ABC234",
      maxPlayers: 8,
    });
    await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "assign_codenames_role",
      data: { playerId: "p1", team: "red", role: "spymaster" },
    });
    await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "set_host_spectating",
      data: { spectating: true },
    });

    const storedAsSpectator = room.snapshot();
    expect(storedAsSpectator.assignments).not.toHaveProperty("p1");

    const returned = await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "set_host_spectating",
      data: { spectating: false },
    });

    expect(returned.state?.players?.map((player) => player.id)).toEqual(["p1"]);
    expect(returned.state?.you).toMatchObject({
      isHost: true,
      isSpectator: false,
      team: "red",
      role: "spymaster",
    });
  });

  it("rejects reclaiming a player seat when other players filled the table", async () => {
    const { room } = createRoomHarness();
    await postJson(room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "ABC234",
      maxPlayers: 4,
    });

    for (let index = 2; index <= 4; index++) {
      await postJson(room, "/agent/join", {
        playerId: `p${index}`,
        assignedCodename: generateCodename(),
        ownerGamertag: `p${index}`,
        environmentLabel: "Vitest",
      });
    }

    await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "set_host_spectating",
      data: { spectating: true },
    });
    await postJson(room, "/agent/join", {
      playerId: "p5",
      assignedCodename: generateCodename(),
      ownerGamertag: "p5",
      environmentLabel: "Vitest",
    });

    const rejected = await rejectedAction(room, "p1", "set_host_spectating", {
      spectating: false,
    });

    expect(await rejected.text()).toContain("No player seat is available for the host");
    expect((await getState(room, "p1")).you).toMatchObject({
      isHost: true,
      isSpectator: true,
    });
  });

  it("keeps a spectator-host watch-only during bulk player-seat changes", async () => {
    const { room, storage } = createRoomHarness();
    await postJson(room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "ABC234",
      maxPlayers: 8,
    });

    for (let index = 2; index <= 4; index++) {
      await postJson(room, "/agent/join", {
        playerId: `p${index}`,
        assignedCodename: generateCodename(),
        ownerGamertag: `p${index}`,
        environmentLabel: "Vitest",
      });
    }

    await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "set_host_spectating",
      data: { spectating: true },
    });

    const changed = await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "set_player_seats",
      data: { playerIds: ["p2", "p3"] },
    });

    expect(changed.state?.players?.map((player) => player.id)).toEqual(["p2", "p3"]);
    expect(changed.state?.you).toMatchObject({ isHost: true, isSpectator: true });
    const stored = room.snapshot();
    expect(stored.spectators?.map((player) => player.id)).toEqual(
      expect.arrayContaining(["p1", "p4"]),
    );
  });

  it("keeps a host-only empty lobby alive and transfers host when the organizer leaves", async () => {
    const first = createRoomHarness();
    await postJson(first.room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "ABC234",
      maxPlayers: 8,
    });
    await postJson(first.room, "/agent/join", {
      playerId: "p2",
      assignedCodename: generateCodename(),
      ownerGamertag: "p2",
      environmentLabel: "Vitest",
    });
    await postJson(first.room, "/agent/action", {
      playerId: "p1",
      actionType: "set_host_spectating",
      data: { spectating: true },
    });
    await postJson(first.room, "/agent/action", {
      playerId: "p2",
      actionType: "leave",
      data: {},
    });
    expect(await getState(first.room, "p1")).toMatchObject({
      status: "waiting",
      players: [],
      you: { isHost: true, isSpectator: true },
    });

    const second = createRoomHarness();
    await postJson(second.room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "DEF567",
      maxPlayers: 8,
    });
    await postJson(second.room, "/agent/join", {
      playerId: "p2",
      assignedCodename: generateCodename(),
      ownerGamertag: "p2",
      environmentLabel: "Vitest",
    });
    await postJson(second.room, "/agent/action", {
      playerId: "p1",
      actionType: "set_host_spectating",
      data: { spectating: true },
    });
    await postJson(second.room, "/agent/action", {
      playerId: "p1",
      actionType: "leave",
      data: {},
    });
    expect((await getState(second.room, "p2")).you).toMatchObject({
      isHost: true,
      isSpectator: false,
    });
  });

  it("starts with valid automatic roles after four players join", async () => {
    const { room } = createRoomHarness();
    await postJson(room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "ABC234",
      maxPlayers: 8,
    });

    for (let index = 2; index <= 4; index++) {
      await postJson(room, "/agent/join", {
        playerId: `p${index}`,
        assignedCodename: generateCodename(),
        ownerGamertag: `p${index}`,
        environmentLabel: "Vitest",
      });
    }

    const response = await room.fetch(
      new Request("https://room.test/agent/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: "p1" }),
      }),
    );

    expect(response.ok).toBe(true);

    const started = await response.json<AgentActionResponse>();
    expect(started.state?.status).toBe("playing");
    expect(
      validateCodenamesAssignments(
        started.state?.players?.map((candidate) => candidate.id) ?? [],
        started.state?.assignments ?? {},
      ),
    ).toBeNull();
  });

  it("lets players choose their own role while only the host can arrange others", async () => {
    const { room } = createRoomHarness();
    await postJson(room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "ABC234",
      maxPlayers: 8,
    });
    await postJson(room, "/agent/join", {
      playerId: "p2",
      assignedCodename: generateCodename(),
      ownerGamertag: "p2",
      environmentLabel: "Vitest",
    });

    const chosen = await postJson(room, "/agent/action", {
      playerId: "p2",
      actionType: "assign_codenames_role",
      data: {
        playerId: "p2",
        team: "blue",
        role: "operative",
      },
    });

    expect(chosen.state?.assignments).toMatchObject({
      p2: { team: "blue", role: "operative" },
    });
    await rejectedAction(room, "p2", "assign_codenames_role", {
      playerId: "p1",
      team: "red",
      role: "spymaster",
    });
    await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "assign_codenames_role",
      data: { playerId: "p1", team: "red", role: "spymaster" },
    });

    const replaced = await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "assign_codenames_role",
      data: { playerId: "p2", team: "red", role: "spymaster" },
    });

    expect(replaced.state?.assignments).toMatchObject({
      p1: { team: "red", role: "operative" },
      p2: { team: "red", role: "spymaster" },
    });
  });

  it("lets a spectator claim an open seat by joining a team role", async () => {
    const { room } = createRoomHarness();
    await postJson(room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "ABC234",
      maxPlayers: 4,
    });
    await postJson(room, "/agent/join", {
      playerId: "p2",
      assignedCodename: generateCodename(),
      ownerGamertag: "p2",
      environmentLabel: "Vitest",
    });
    await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "move_player_to_spectator",
      data: { playerId: "p2" },
    });

    const joined = await postJson(room, "/agent/action", {
      playerId: "p2",
      actionType: "assign_codenames_role",
      data: { playerId: "p2", team: "blue", role: "operative" },
    });

    expect(joined.state?.players?.map((candidate) => candidate.id)).toContain("p2");
    expect(joined.state?.spectators?.map((candidate) => candidate.id) ?? []).not.toContain("p2");
    expect(joined.state?.you).toMatchObject({
      isSpectator: false,
      team: "blue",
      role: "operative",
    });
    expect(joined.state?.assignments).toMatchObject({
      p2: { team: "blue", role: "operative" },
    });
  });

  it("lets the host move a spectator into an open team seat", async () => {
    const { room } = createRoomHarness();
    await postJson(room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "ABC234",
      maxPlayers: 4,
    });
    await postJson(room, "/agent/join", {
      playerId: "p2",
      assignedCodename: generateCodename(),
      ownerGamertag: "p2",
      environmentLabel: "Vitest",
    });
    await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "move_player_to_spectator",
      data: { playerId: "p2" },
    });

    const moved = await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "assign_codenames_role",
      data: { playerId: "p2", team: "red", role: "operative" },
    });

    expect(moved.state?.players?.map((candidate) => candidate.id)).toContain("p2");
    expect(moved.state?.spectators?.map((candidate) => candidate.id) ?? []).not.toContain("p2");
    expect(moved.state?.assignments).toMatchObject({
      p2: { team: "red", role: "operative" },
    });
  });

  it("keeps spectator self-selection capacity-safe", async () => {
    const { room } = createRoomHarness();
    await postJson(room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "ABC234",
      maxPlayers: 4,
    });

    for (let index = 2; index <= 4; index++) {
      await postJson(room, "/agent/join", {
        playerId: `p${index}`,
        assignedCodename: generateCodename(),
        ownerGamertag: `p${index}`,
        environmentLabel: "Vitest",
      });
    }

    await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "move_player_to_spectator",
      data: { playerId: "p2" },
    });
    await postJson(room, "/agent/join", {
      playerId: "p5",
      assignedCodename: generateCodename(),
      ownerGamertag: "p5",
      environmentLabel: "Vitest",
    });

    const rejected = await rejectedAction(room, "p2", "assign_codenames_role", {
      playerId: "p2",
      team: "blue",
      role: "operative",
    });

    expect(await rejected.text()).toContain("No player seat is available");
    expect((await getState(room, "p2")).you).toMatchObject({ isSpectator: true });
  });

  it("protects occupied spymasters from self-selection races", async () => {
    const { room } = createRoomHarness();
    await postJson(room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "ABC234",
      maxPlayers: 8,
    });
    await postJson(room, "/agent/join", {
      playerId: "p2",
      assignedCodename: generateCodename(),
      ownerGamertag: "p2",
      environmentLabel: "Vitest",
    });
    await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "assign_codenames_role",
      data: { playerId: "p1", team: "red", role: "spymaster" },
    });

    const rejected = await rejectedAction(room, "p2", "assign_codenames_role", {
      playerId: "p2",
      team: "red",
      role: "spymaster",
    });

    expect(await rejected.text()).toContain("already taken");
    expect((await getState(room, "p2")).assignments).toMatchObject({
      p1: { team: "red", role: "spymaster" },
    });

    await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "move_player_to_spectator",
      data: { playerId: "p2" },
    });
    await rejectedAction(room, "p2", "assign_codenames_role", {
      playerId: "p2",
      team: "red",
      role: "spymaster",
    });
    const stillWatching = await getState(room, "p2");
    expect(stillWatching.you).toMatchObject({ isSpectator: true });
    expect(stillWatching.players?.map((candidate) => candidate.id)).not.toContain("p2");
  });

  it("lets only the host reset and randomize valid teams", async () => {
    const { room } = createRoomHarness();
    await postJson(room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode: "ABC234",
      maxPlayers: 8,
    });

    for (let index = 2; index <= 4; index++) {
      await postJson(room, "/agent/join", {
        playerId: `p${index}`,
        assignedCodename: generateCodename(),
        ownerGamertag: `p${index}`,
        environmentLabel: "Vitest",
      });
    }

    await rejectedAction(room, "p2", "randomize_codenames_roles", {});

    const randomized = await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "randomize_codenames_roles",
      data: {},
    });

    expect(
      validateCodenamesAssignments(
        randomized.state?.players?.map((candidate) => candidate.id) ?? [],
        randomized.state?.assignments ?? {},
      ),
    ).toBeNull();

    await rejectedAction(room, "p2", "reset_codenames_roles", {});

    const reset = await postJson(room, "/agent/action", {
      playerId: "p1",
      actionType: "reset_codenames_roles",
      data: {},
    });

    expect(
      validateCodenamesAssignments(
        reset.state?.players?.map((candidate) => candidate.id) ?? [],
        reset.state?.assignments ?? {},
      ),
    ).toBeNull();
  });
});

function playerWithRole(
  state: NonNullable<AgentActionResponse["state"]>,
  team: "red" | "blue",
  role: "spymaster" | "operative",
): string {
  const found = Object.entries(state.assignments ?? {}).find(
    ([, assignment]) => assignment.team === team && assignment.role === role,
  );

  if (!found) throw new Error(`Missing ${team} ${role}`);

  return found[0];
}

describe("official Codenames turn flow", () => {
  it("keeps a compact public activity log for the in-room game rail", async () => {
    const { room, storage, state } = await startPlayerRoom();
    const team = state.activeTeam!;
    const spymaster = playerWithRole(state, team, "spymaster");
    const operative = playerWithRole(state, team, "operative");

    const clue = await postJson(room, "/agent/action", {
      playerId: spymaster,
      actionType: "give_clue",
      data: { word: "signal", count: 1 },
    });

    const ownCard = clue.state?.board?.find((card) => card.affiliation === team && !card.revealed);

    expect(ownCard).toBeTruthy();
    await postJson(room, "/agent/action", {
      playerId: operative,
      actionType: "guess_word",
      data: { index: ownCard!.index },
    });
    await postJson(room, "/agent/action", {
      playerId: operative,
      actionType: "end_turn",
      data: {},
    });

    const stored = room.snapshot();
    expect(stored.activityLog).toMatchObject([
      { type: "clue", team, playerId: spymaster, word: "signal", count: 1 },
      { type: "guess", team, playerId: operative, word: ownCard!.word, affiliation: team },
      { type: "turn_end", team, playerId: operative, reason: "stopped" },
    ]);
    expect(stored.activityLog?.every((entry) => Number.isFinite(entry.at))).toBe(true);
  });

  it("allows clue number plus one, requires a guess before stopping, and supports zero clues", async () => {
    const { room, state } = await startPlayerRoom();
    const team = state.activeTeam!;
    const spymaster = playerWithRole(state, team, "spymaster");
    const operative = playerWithRole(state, team, "operative");

    const spyView = await postJson(room, "/agent/action", {
      playerId: spymaster,
      actionType: "give_clue",
      data: { word: "signal", count: 1 },
    });

    expect(spyView.state?.turnState?.phase).toBe("guess");
    expect(spyView.state?.guessesRemaining).toBe(2);
    expect(spyView.state?.you).toMatchObject({
      team,
      role: "spymaster",
      canSeeKey: true,
    });

    await rejectedAction(room, operative, "end_turn", {});

    const ownCard = spyView.state?.board?.find(
      (card) => card.affiliation === team && !card.revealed,
    );

    expect(ownCard).toBeTruthy();

    const guessed = await postJson(room, "/agent/action", {
      playerId: operative,
      actionType: "guess_word",
      data: { index: ownCard!.index },
    });

    expect(guessed.state?.activeTeam).toBe(team);
    expect(guessed.state?.guessesRemaining).toBe(1);
    expect(guessed.state?.you).toMatchObject({
      team,
      role: "operative",
      canSeeKey: false,
    });

    const stopped = await postJson(room, "/agent/action", {
      playerId: operative,
      actionType: "end_turn",
      data: {},
    });

    const otherTeam = team === "red" ? "blue" : "red";
    expect(stopped.state?.activeTeam).toBe(otherTeam);
    expect(stopped.state?.turnState?.phase).toBe("clue");

    const otherSpymaster = playerWithRole(stopped.state!, otherTeam, "spymaster");

    const zeroClue = await postJson(room, "/agent/action", {
      playerId: otherSpymaster,
      actionType: "give_clue",
      data: { word: "feathers", count: 0 },
    });

    expect(zeroClue.state?.guessesRemaining).toBeNull();
  });

  it("awards the game immediately to the opposing team when the assassin is guessed", async () => {
    const { room, state } = await startPlayerRoom();
    const team = state.activeTeam!;
    const otherTeam = team === "red" ? "blue" : "red";
    const spymaster = playerWithRole(state, team, "spymaster");
    const operative = playerWithRole(state, team, "operative");

    const clue = await postJson(room, "/agent/action", {
      playerId: spymaster,
      actionType: "give_clue",
      data: { word: "danger", count: "unlimited" },
    });

    const assassin = clue.state?.board?.find((card) => card.affiliation === "assassin");
    expect(assassin).toBeTruthy();

    const ended = await postJson(room, "/agent/action", {
      playerId: operative,
      actionType: "guess_word",
      data: { index: assassin!.index },
    });

    expect(ended.state?.status).toBe("ended");
    expect(ended.state?.winnerTeam).toBe(otherTeam);
  });

  it("rejects malformed clues and accepts a trimmed expert unlimited clue", async () => {
    const { room, state } = await startPlayerRoom();
    const team = state.activeTeam!;
    const spymaster = playerWithRole(state, team, "spymaster");
    const spyState = await getState(room, spymaster);
    const visibleWord = spyState.board?.find((card) => !card.revealed)?.word;
    expect(visibleWord).toBeTruthy();

    await rejectedAction(room, spymaster, "give_clue", { word: "two words", count: 2 });
    await rejectedAction(room, spymaster, "give_clue", {
      word: visibleWord!.toUpperCase(),
      count: 1,
    });
    await rejectedAction(room, spymaster, "give_clue", { word: "signal", count: 10 });
    await rejectedAction(room, spymaster, "give_clue", { word: "signal", count: "3" });

    const accepted = await postJson(room, "/agent/action", {
      playerId: spymaster,
      actionType: "give_clue",
      data: { word: "signal", count: " UnLiMiTeD " },
    });

    expect(accepted.state?.guessesRemaining).toBeNull();
    expect(accepted.state?.turnState?.currentPlayerId).toBeNull();
  });

  it("exposes the guess action to every active-team operative in a six-player room", async () => {
    const { room, state } = await startPlayerRoom(6);
    const team = state.activeTeam!;
    const spymaster = playerWithRole(state, team, "spymaster");
    await postJson(room, "/agent/action", {
      playerId: spymaster,
      actionType: "give_clue",
      data: { word: "signal", count: 2 },
    });

    const operatives = Object.entries(state.assignments ?? {})
      .filter(([, assignment]) => assignment.team === team && assignment.role === "operative")
      .map(([playerId]) => playerId);

    expect(operatives).toHaveLength(2);

    for (const playerId of operatives) {
      const view = await getState(room, playerId);
      expect(view.you).toMatchObject({ isYourTurn: true });
      expect(view.you?.legalActions).toContain("guess_word");
    }
  });

  it("ends a positive clue after the number plus one correct guesses", async () => {
    const { room, state } = await startPlayerRoom();
    const team = state.activeTeam!;
    const otherTeam = team === "red" ? "blue" : "red";
    const spymaster = playerWithRole(state, team, "spymaster");
    const operative = playerWithRole(state, team, "operative");

    const clue = await postJson(room, "/agent/action", {
      playerId: spymaster,
      actionType: "give_clue",
      data: { word: "signal", count: 1 },
    });

    const ownCards =
      clue.state?.board?.filter((card) => card.affiliation === team && !card.revealed) ?? [];

    const first = await postJson(room, "/agent/action", {
      playerId: operative,
      actionType: "guess_word",
      data: { index: ownCards[0]!.index },
    });

    expect(first.state?.activeTeam).toBe(team);
    expect(first.state?.guessesRemaining).toBe(1);

    const second = await postJson(room, "/agent/action", {
      playerId: operative,
      actionType: "guess_word",
      data: { index: ownCards[1]!.index },
    });

    expect(second.state?.activeTeam).toBe(otherTeam);
    expect(second.state?.turnState?.phase).toBe("clue");
  });

  it("keeps one shared timer across correct operative guesses", async () => {
    const { room, storage, state } = await startPlayerRoom(4, 60_000);
    const team = state.activeTeam!;
    const spymaster = playerWithRole(state, team, "spymaster");
    const operative = playerWithRole(state, team, "operative");

    const clue = await postJson(room, "/agent/action", {
      playerId: spymaster,
      actionType: "give_clue",
      data: { word: "signal", count: 2 },
    });

    const stored = room.snapshot();
    stored.turnState.turnTimeRemaining = 12_000;

    const ownCard = clue.state?.board?.find((card) => card.affiliation === team && !card.revealed);

    const guessed = await postJson(room, "/agent/action", {
      playerId: operative,
      actionType: "guess_word",
      data: { index: ownCard!.index },
    });

    expect(guessed.state?.turnState?.turnTimeRemaining).toBeLessThanOrEqual(12_000);
  });

  it("awards a team when the opponent reveals its final agent", async () => {
    const { room, state } = await startPlayerRoom();
    const firstTeam = state.activeTeam!;
    const secondTeam = firstTeam === "red" ? "blue" : "red";
    const firstSpy = playerWithRole(state, firstTeam, "spymaster");
    const firstOp = playerWithRole(state, firstTeam, "operative");

    const firstClue = await postJson(room, "/agent/action", {
      playerId: firstSpy,
      actionType: "give_clue",
      data: { word: "signal", count: "unlimited" },
    });

    const secondCard = firstClue.state?.board?.find(
      (card) => card.affiliation === secondTeam && !card.revealed,
    );

    await postJson(room, "/agent/action", {
      playerId: firstOp,
      actionType: "guess_word",
      data: { index: secondCard!.index },
    });

    const secondSpy = playerWithRole(state, secondTeam, "spymaster");
    const secondOp = playerWithRole(state, secondTeam, "operative");

    const secondClue = await postJson(room, "/agent/action", {
      playerId: secondSpy,
      actionType: "give_clue",
      data: { word: "feathers", count: "unlimited" },
    });

    const secondTeamCards =
      secondClue.state?.board?.filter(
        (card) => card.affiliation === secondTeam && !card.revealed,
      ) ?? [];

    for (const card of secondTeamCards.slice(0, -1)) {
      await postJson(room, "/agent/action", {
        playerId: secondOp,
        actionType: "guess_word",
        data: { index: card.index },
      });
    }

    await postJson(room, "/agent/action", {
      playerId: secondOp,
      actionType: "end_turn",
      data: {},
    });

    const finalFirstClue = await postJson(room, "/agent/action", {
      playerId: firstSpy,
      actionType: "give_clue",
      data: { word: "cosmic", count: "unlimited" },
    });

    const finalSecondCard = finalFirstClue.state?.board?.find(
      (card) => card.affiliation === secondTeam && !card.revealed,
    );

    const ended = await postJson(room, "/agent/action", {
      playerId: firstOp,
      actionType: "guess_word",
      data: { index: finalSecondCard!.index },
    });

    expect(ended.state?.status).toBe("ended");
    expect(ended.state?.winnerTeam).toBe(secondTeam);
  });
});
