import { roomTestEnv } from "../fixtures/room-env";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";

import { wireValueSchema, wireObjectSchema } from "@llmgames/game-catalog";
import type { WireObject, WireValue } from "@llmgames/game-catalog";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";

import { BaseGameRoom } from "../../durable-objects/BaseGameRoom";
import type { BaseGameState, Player } from "../../durable-objects/types";

type ProjectionState = BaseGameState & WireObject;

class ProjectionRoom extends BaseGameRoom<ProjectionState> {
  protected readonly roomLabel = "ProjectionRoom";
  setState(state: ProjectionState) {
    this.gameState = state;
  }
  agent() {
    return wireObjectSchema.parse(this.buildAgentView("p1"));
  }
  browser() {
    return wireObjectSchema.parse(this.buildClientView("p1"));
  }

  protected createDefaultState(): ProjectionState {
    throw new Error("not used");
  }

  protected async handleGameAction(
    _player: Player,
    _payload: { actionType: string; data: WireValue },
  ): Promise<void> {}
}

function stateFor(type: string, extra: WireObject): ProjectionState {
  return {
    id: "internal-room-id",
    roomCode: "ABC234",
    type,
    status: "playing",
    players: [
      {
        id: "p1",
        name: "Player One",
        isAgent: true,
        codename: "SwiftAnchor",
        ownerGamertag: "owner",
        environmentLabel: "Codex",
      },
      { id: "p2", name: "Player Two" },
    ],
    spectators: [{ id: "s1", name: "Watcher" }],
    hostId: "p1",
    maxPlayers: 2,
    timerConfig: { gameTotalTime: 60_000, turnTime: 30_000 },
    gameTimeRemaining: 50_000,
    turnState: {
      currentPlayerId: "p1",
      turnNumber: 3,
      phase: "play",
      startedAt: 123,
      turnTimeRemaining: 20_000,
    },
    createdAt: 1,
    updatedAt: 2,
    expiresAt: ROOM_LIFETIME_MS,
    ...extra,
  };
}

async function views(state: ProjectionState) {
  const runtime = new MemoryRoomRuntime();
  const room = new ProjectionRoom(runtime, roomTestEnv());
  await runtime.initialized;
  room.setState(state);

  return { agent: room.agent(), browser: room.browser() };
}

describe("compact MCP state projection", async () => {
  it("keeps the browser projection full and removes common UI metadata from MCP", async () => {
    const { agent, browser } = await views(
      stateFor("connect4", {
        board: [[0, 1, 2]],
        seats: { p1: 1, p2: 2 },
        winner: null,
        lastMove: { col: 2, row: 0, seat: 2 },
      }),
    );

    expect(browser).toMatchObject({
      id: "internal-room-id",
      roomCode: "ABC234",
      hostId: "p1",
      timerConfig: { turnTime: 30_000 },
      spectatorCount: 1,
    });
    expect(agent).toMatchObject({
      type: "connect4",
      board: [[0, 1, 2]],
      players: [
        { id: "p1", name: "Player One" },
        { id: "p2", name: "Player Two" },
      ],
      you: { playerId: "p1", isYourTurn: true },
    });
    expect(
      z
        .object({ legalActions: z.array(z.string()) })
        .passthrough()
        .parse(agent.you).legalActions,
    ).not.toContain("set_host_spectating");

    for (const field of [
      "id",
      "roomCode",
      "hostId",
      "maxPlayers",
      "timerConfig",
      "createdAt",
      "updatedAt",
      "expiresAt",
      "spectators",
      "spectatorCount",
    ]) {
      expect(agent).not.toHaveProperty(field);
    }

    expect(agent.you).not.toHaveProperty("ownerGamertag");
    expect(agent.you).not.toHaveProperty("environmentLabel");
  });

  it("keeps Reversi board analysis and server-computed legal moves", async () => {
    const { agent } = await views(
      stateFor("reversi", {
        board: [[0, 1, 2]],
        seats: { p1: 1, p2: 2 },
        scores: { 1: 4, 2: 1 },
        legalMoves: [{ row: 2, col: 3, flipCount: 1 }],
        lastMove: null,
        lastPass: null,
      }),
    );

    expect(agent).toMatchObject({
      board: [[0, 1, 2]],
      scores: { 1: 4, 2: 1 },
      legalMoves: [{ row: 2, col: 3, flipCount: 1 }],
    });
  });

  it("keeps Codenames team decisions and the already role-projected key", async () => {
    const codenames = stateFor("codenames", {
      board: [
        { index: 0, word: "anchor", affiliation: "red", revealed: true },
        { index: 1, word: "moon", affiliation: null, revealed: false },
      ],
      assignments: {
        p1: { team: "red", role: "operative" },
        p2: { team: "blue", role: "spymaster" },
      },
      startingTeam: "red",
      activeTeam: "red",
      clue: { word: "harbor", count: 1 },
      guessesRemaining: 2,
      guessesMade: 0,
      remaining: { red: 8, blue: 8 },
      winnerTeam: null,
      lastReveal: null,
    });

    const { agent } = await views(codenames);
    expect(agent).toMatchObject({
      activeTeam: "red",
      clue: { word: "harbor", count: 1 },
      guessesRemaining: 2,
      remaining: { red: 8, blue: 8 },
      board: [
        { word: "anchor", affiliation: "red" },
        { word: "moon", affiliation: null },
      ],
    });
  });

  it("limits poker history to the current hand", async () => {
    const { agent } = await views(
      stateFor("poker", {
        seats: [],
        community: [],
        pot: 30,
        currentBet: 10,
        minRaise: 10,
        handNumber: 2,
        actionPlayerId: "p1",
        toCall: 10,
        canCheck: false,
        blinds: { sb: 5, bb: 10 },
        actionLog: [
          { playerId: "p1", action: "fold", handNumber: 1 },
          { playerId: "p2", action: "raise", amount: 20, handNumber: 2 },
        ],
      }),
    );

    expect(agent.actionLog).toEqual([
      { playerId: "p2", action: "raise", amount: 20, handNumber: 2 },
    ]);
  });

  it("retains mine knowledge while removing duplicated Battleship display catalogs", async () => {
    const state = stateFor("battleship", {
      boardSize: 10,
      fleet: [{ id: "carrier", "shape": [[0, 0]] }],
      munitionEconomy: {
        cannonReward: 0,
        turnReward: 2,
        damageReward: 1,
        costs: { bomb: 5 },
        yourPoints: 5,
      },
      weaponsCatalog: [{ id: "bomb", description: "display copy" }],
      yourBoard: {
        ships: [],
        cells: Array.from({ length: 10 }, () => Array(10).fill(null)),
        mines: [{ row: 0, col: 0 }],
        ready: false,
        munitionPoints: 3,
        fleetStatus: [],
        incomingHits: [],
        incomingMisses: [],
      },
      opponent: {
        playerId: "p2",
        hits: [],
        misses: [],
        radarScans: Array.from({ length: 22 }, (_, index) => ({
          row: index % 10,
          col: 6,
          shipCells: 3,
        })),
        shipsRemaining: 5,
      },
      shotLog: [],
    });

    state.turnState.phase = "placement";
    const { agent } = await views(state);
    expect(agent).toHaveProperty("fleet");
    expect(agent).not.toHaveProperty("weaponsCatalog");
    expect(agent).not.toHaveProperty("shotLog");
    expect(agent).toMatchObject({
      munitionPoints: 3,
      turnReward: 2,
      damageReward: 1,
      weaponCosts: { bomb: 5 },
    });
    expect(agent).not.toHaveProperty("yourBoard");
    expect(agent.ownGrid).toEqual(["m.........", ...Array(9).fill("..........")]);
    state.turnState.phase = "battle";
    const scans = z.array(wireValueSchema).parse((await views(state)).agent.radarScans);
    expect(scans).toHaveLength(20);
    expect(scans[0]).toEqual({ row: 2, col: 6, shipCells: 3 });
  });
});
