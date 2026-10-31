import { roomTestEnv } from "../../fixtures/room-env";
import { wireValueSchema, wireObjectSchema } from "@llmgames/game-catalog";
import { compactState } from "../../../games/agent-decision";
import { parseJevView } from "../../../agents/jev";

import { z } from "zod";
import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { compactAgentDecisionState, getGameToolSchema } from "@llmgames/game-catalog";
import { jevDecision } from "../../../agents/jev";
import { describe, expect, it, vi } from "vitest";

import { BattleshipRoom } from "../../../durable-objects/BattleshipRoom";
import {
  BATTLESHIP_FALLBACK_FLEET,
  BATTLESHIP_FLEET,
  BATTLESHIP_WEAPON_COSTS,
  type BattleshipGameState,
} from "../../../durable-objects/types";

class TestBattleshipRoom extends BattleshipRoom {
  project(id: string, state: BattleshipGameState) {
    const scans = z.array(
      z.object({ row: z.number(), col: z.number(), shipCells: z.number() }).passthrough(),
    );

    return z
      .object({
        radarScans: scans.optional(),
        opponent: z
          .object({ radarScans: scans.optional(), triggeredMines: wireValueSchema.optional() })
          .passthrough()
          .nullable()
          .optional(),
        yourBoard: z
          .object({ radarScans: scans.optional(), mines: wireValueSchema.optional() })
          .passthrough()
          .nullable()
          .optional(),
        spectatorBoards: z
          .array(
            z
              .object({ playerId: z.string().optional(), radarScans: scans.optional() })
              .passthrough(),
          )
          .optional(),
        stats: z.object({ yourScore: z.number().optional() }).passthrough(),
      })
      .parse(this.projectStateFor(id, state));
  }
  legal(id: string) {
    return this.getLegalActions(id);
  }

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

  return {
    room: new TestBattleshipRoom(state, roomTestEnv()),
    storage,
    durableState: state,
  };
}

async function post<T>(room: BattleshipRoom, path: string, body: T): Promise<Response> {
  return room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function fleet(rotation = 0) {
  return BATTLESHIP_FALLBACK_FLEET.map((placement) => ({
    ...placement,
    rotation,
  }));
}

async function startBattle() {
  const harness = createHarness();
  await post(harness.room, "/create", {
    hostId: "p1",
    hostName: "Player One",
    roomCode: "SEA234",
    turnTime: 30_000,
  });
  await post(harness.room, "/agent/join", {
    playerId: "p2",
    assignedCodename: "SwiftAnchor",
  });
  await post(harness.room, "/agent/start", { playerId: "p1" });

  return harness;
}

async function placeBoth(harness: Awaited<ReturnType<typeof startBattle>>) {
  expect(
    (
      await post(harness.room, "/agent/action", {
        playerId: "p1",
        actionType: "place_fleet",
        data: { ships: fleet() },
      })
    ).status,
  ).toBe(200);
  const rotatedFleet = fleet();
  rotatedFleet[0] = { ...rotatedFleet[0]!, row: 0, col: 9, rotation: 90 };
  expect(
    (
      await post(harness.room, "/agent/action", {
        playerId: "p2",
        actionType: "place_fleet",
        data: { ships: rotatedFleet },
      })
    ).status,
  ).toBe(200);
}

async function endRoom(room: BattleshipRoom) {
  await post(room, "/agent/action", {
    playerId: "p1",
    actionType: "end_game",
    data: {},
  });
}

describe("Battleship public rules", () => {
  it("preserves private mine knowledge across MCP reads and restarts without leaking enemy cells", async () => {
    const h = await startBattle();

    try {
      await placeBoth(h);
      const state = h.room.snapshot();
      const id = state.turnState.currentPlayerId!;
      const own = state.boards.find((board) => board.playerId === id)!;
      const opponent = state.boards.find((board) => board.playerId !== id)!;
      own.munitionPoints = 10;
      const cell = { row: 9, col: 9 };
      expect(
        (await post(h.room, "/agent/action", { playerId: id, actionType: "mine", data: cell }))
          .status,
      ).toBe(200);

      const read = async (room: BattleshipRoom) => {
        const response = await room.fetch(
          new Request(`https://room.test/agent/view?playerId=${id}`),
        );

        return z
          .object({ state: wireObjectSchema })
          .passthrough()
          .parse(await response.json()).state;
      };

      const rich = await read(h.room);
      const decision = compactState(rich)!;
      expect(rich.ownGrid).toEqual(decision.ownGrid);
      expect(z.array(z.string()).parse(rich.ownGrid)[9]![9]).toBe("m");
      expect(rich).not.toHaveProperty("yourBoard");
      expect(rich).not.toHaveProperty("munitionEconomy");
      expect(JSON.stringify(decision)).not.toContain('"name"');
      expect(jevDecision(parseJevView(decision))!.options).not.toHaveProperty("mine_9_9");
      expect(jevDecision(parseJevView(decision))!.state.ownGrid).toEqual(rich.ownGrid);
      expect(jevDecision(parseJevView(decision))!.state.radarScans).toEqual(rich.radarScans);
      // An unobserved opponent mine and unhit cell cannot change either agent view.
      opponent.mines = [{ row: 9, col: 8 }];
      const before = JSON.stringify({ ...decision, turnTimeRemaining: 0, gameTimeRemaining: 0 });
      const hidden = opponent.cells[0]![9];
      opponent.cells[0]![9] = opponent.cells[0]![0]!;
      opponent.cells[0]![0] = hidden!;
      const after = compactState(await read(h.room));
      expect(JSON.stringify({ ...after, turnTimeRemaining: 0, gameTimeRemaining: 0 })).toBe(before);
      const restored = new TestBattleshipRoom(h.durableState, roomTestEnv());
      await vi.waitFor(async () => expect((await read(restored))?.ownGrid).toEqual(rich.ownGrid));

      const reply = await post(restored, "/agent/action", {
        playerId: id,
        actionType: "mine",
        data: cell,
      });

      expect(reply.ok).toBe(false);
      expect(
        z
          .object({ state: z.object({ ownGrid: z.array(z.string()) }).passthrough() })
          .passthrough()
          .parse(await reply.json()).state.ownGrid[9]![9],
      ).toBe("m");
    } finally {
      await endRoom(h.room);
    }
  });

  it("accepts the torpedo example returned by get_tool_schema", async () => {
    const h = await startBattle();

    try {
      await placeBoth(h);
      const state = h.room.snapshot();
      const id = state.turnState.currentPlayerId!;
      state.boards.find((board) => board.playerId === id)!.munitionPoints = 7;
      const schema = getGameToolSchema("torpedo", "battleship");

      if (!("example" in schema) || !schema.example) throw new Error("Missing torpedo example");
      expect(
        (
          await post(h.room, "/agent/action", {
            playerId: id,
            actionType: schema.example.actionType,
            data: schema.example.data,
          })
        ).status,
      ).toBe(200);
    } finally {
      await endRoom(h.room);
    }
  });

  it.each([0, 90, 180, 270])(
    "accepts the larger fleet at %i degrees with exact occupancy",
    async (rotation) => {
      const harness = await startBattle();

      try {
        const ships = fleet().map((ship) => {
          const { row, col } = ship;

          const [r, c] =
            rotation === 90
              ? [col, 9 - row]
              : rotation === 180
                ? [9 - row, 9 - col]
                : rotation === 270
                  ? [9 - col, row]
                  : [row, col];

          return { ...ship, row: r, col: c, rotation };
        });

        const response = await post(harness.room, "/agent/action", {
          playerId: "p1",
          actionType: "place_fleet",
          data: { ships },
        });

        expect(response.status).toBe(200);
        const state = harness.room.snapshot();
        const board = state.boards.find((board) => board.playerId === "p1")!;
        expect(board.cells.flat().filter(Boolean)).toHaveLength(22);

        for (const spec of BATTLESHIP_FLEET) {
          expect(board.cells.flat().filter((id) => id === spec.id)).toHaveLength(spec.length);
        }
      } finally {
        await endRoom(harness.room);
      }
    },
  );

  it("requires a valid non-overlapping fleet and starts battle after both fleets are ready", async () => {
    const harness = await startBattle();

    try {
      const overlapping = fleet();
      overlapping[1] = { ...overlapping[1]!, row: 0, col: 0 };

      const invalid = await post(harness.room, "/agent/action", {
        playerId: "p1",
        actionType: "place_fleet",
        data: { ships: overlapping },
      });

      expect(invalid.status).toBe(400);

      await placeBoth(harness);
      const state = harness.room.snapshot();
      expect(state.turnState.phase).toBe("battle");
      expect(state.boards.every((board) => board.ready)).toBe(true);

      for (const board of state.boards) {
        expect(board.cells.flat().filter(Boolean)).toHaveLength(22);
      }

      expect(state.boards[1]!.ships[0]!.rotation).toBe(90);
    } finally {
      await endRoom(harness.room);
    }
  });

  it("awards points once per turn, not per hit, and passes after a miss", async () => {
    const harness = await startBattle();

    try {
      await placeBoth(harness);
      const state = harness.room.snapshot();
      const attacker = state.turnState.currentPlayerId!;

      const opponent = state.boards.find((board) => board.playerId !== attacker)!;

      const occupied = opponent.cells.flatMap((row, rowIndex) =>
        row.flatMap((cell, col) => (cell ? [{ row: rowIndex, col }] : [])),
      )[0]!;

      const water = opponent.cells.flatMap((row, rowIndex) =>
        row.flatMap((cell, col) => (cell === null ? [{ row: rowIndex, col }] : [])),
      )[0]!;

      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId: attacker,
            actionType: "cannon",
            data: occupied,
          })
        ).status,
      ).toBe(200);
      expect(state.turnState.currentPlayerId).toBe(attacker);
      expect(state.boards.find((board) => board.playerId === attacker)?.munitionPoints).toBe(2);

      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId: attacker,
            actionType: "cannon",
            data: water,
          })
        ).status,
      ).toBe(200);
      expect(state.turnState.currentPlayerId).toBe(opponent.playerId);
      expect(opponent.munitionPoints).toBe(3);
      expect(state.shots.slice(-2).map((shot) => shot.hit)).toEqual([true, false]);
    } finally {
      await endRoom(harness.room);
    }
  });

  it("spends the correct cost for radar, bomb, and torpedo", async () => {
    for (const [actionType, points, data, expectedShots] of [
      ["radar", 3, { row: 0, col: 0 }, 0],
      ["bomb", 5, { row: 0, col: 0 }, 4],
      ["torpedo", 7, { row: 0, col: 0, direction: "s" }, null],
    ] as const) {
      const harness = await startBattle();

      try {
        await placeBoth(harness);
        const state = harness.room.snapshot();
        const attacker = state.turnState.currentPlayerId!;

        const board = state.boards.find((entry) => entry.playerId === attacker)!;

        board.munitionPoints = points;
        const before = state.shots.length;

        const response = await post(harness.room, "/agent/action", {
          playerId: attacker,
          actionType,
          data,
        });

        expect(response.status).toBe(200);
        expect(board.munitionPoints).toBe(0);

        if (actionType === "bomb")
          expect(state.boards.find((entry) => entry.playerId !== attacker)?.bombedAreas).toEqual([
            { row: 0, col: 0 },
          ]);

        if (expectedShots === null) {
          expect(state.shots.length - before).toBeGreaterThan(0);
          expect(state.shots.at(-1)).toMatchObject({
            weapon: "torpedo",
            hit: true,
          });
          const stop = state.shots.at(-1)!;
          expect(state.boards.find((entry) => entry.playerId !== attacker)?.torpedoPaths).toEqual([
            {
              row: 0,
              col: 0,
              endRow: stop.row,
              endCol: stop.col,
              direction: "s",
            },
          ]);
        } else {
          expect(state.shots.length - before).toBe(expectedShots);
        }

        expect(state.turnState.currentPlayerId).toBe(attacker);
      } finally {
        await endRoom(harness.room);
      }
    }
  });

  it("projects radar history on the board that was scanned", async () => {
    const harness = await startBattle();

    try {
      await placeBoth(harness);
      const state = harness.room.snapshot();
      const attacker = state.turnState.currentPlayerId!;
      const defender = state.players.find((player) => player.id !== attacker)!;
      const board = state.boards.find((entry) => entry.playerId === attacker)!;

      const target = state.boards.find((entry) => entry.playerId === defender.id)!;

      board.munitionPoints = 3;
      const cell = { row: 0, col: 5 };

      const expected = target.cells
        .slice(0, 2)
        .reduce((count, row) => count + row.slice(4, 7).filter(Boolean).length, 0);

      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId: attacker,
            actionType: "radar",
            data: cell,
          })
        ).status,
      ).toBe(200);
      expect(board.radarScans).toEqual([{ ...cell, shipCells: expected, cellsScanned: 6 }]);
      expect(target.receivedRadarScans).toEqual(board.radarScans);

      const projector = harness.room;

      const attackerView = projector.project(attacker, state);
      expect(attackerView.radarScans).toEqual(board.radarScans);
      expect(attackerView.opponent?.radarScans).toEqual(board.radarScans);
      const defenderView = projector.project(defender.id, state);
      expect(defenderView.radarScans).toEqual([]);
      expect(defenderView.yourBoard?.radarScans).toEqual(board.radarScans);
      const spectatorView = projector.project("spectator", state);
      expect(spectatorView).not.toHaveProperty("radarScans");
      expect(
        spectatorView.spectatorBoards?.find((entry) => entry.playerId === defender.id)?.radarScans,
      ).toEqual(board.radarScans);
    } finally {
      await endRoom(harness.room);
    }
  });
});

describe("Defensive mines", () => {
  it("charges for hidden placement, rejects invalid cells, and retaliates with three distinct shots", async () => {
    const harness = await startBattle();

    try {
      await placeBoth(harness);
      const state = harness.room.snapshot();
      const owner = state.turnState.currentPlayerId!;
      const board = state.boards.find((b) => b.playerId === owner)!;
      const enemy = state.boards.find((b) => b.playerId !== owner)!;
      const occupied = board.ships[0]!;
      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId: owner,
            actionType: "mine",
            data: { row: occupied.row, col: occupied.col },
          })
        ).status,
      ).toBe(422);
      expect(board.munitionPoints).toBe(2);
      const cell = { row: 9, col: 9 };
      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId: owner,
            actionType: "mine",
            data: cell,
          })
        ).status,
      ).toBe(200);
      expect(board.munitionPoints).toBe(0);
      expect(board.mines).toEqual([cell]);
      expect(state.turnState.currentPlayerId).toBe(owner);
      await post(harness.room, "/agent/action", {
        playerId: owner,
        actionType: "cannon",
        data: { row: 9, col: 8 },
      });

      const projector = harness.room;

      expect(projector.project(owner, state).yourBoard!.mines).toEqual([cell]);
      expect(projector.project(enemy.playerId, state).opponent).not.toHaveProperty("mines");
      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId: enemy.playerId,
            actionType: "cannon",
            data: cell,
          })
        ).status,
      ).toBe(200);
      expect(board.mines).toEqual([]);
      expect(board.triggeredMines).toEqual([cell]);
      expect(projector.project(enemy.playerId, state).opponent!.triggeredMines).toEqual([cell]);
      const returned = state.shots.filter((s) => s.weapon === "mine");
      expect(returned).toHaveLength(3);
      expect(new Set(returned.map((s) => `${s.row}:${s.col}`)).size).toBe(3);
      expect(returned.every((s) => s.byPlayerId === owner)).toBe(true);
      expect(enemy.mineShots).toEqual(returned.map(({ row, col }) => ({ row, col })));
      expect(enemy.mineHits ?? []).toEqual(
        returned.filter((s) => s.hit).map(({ row, col }) => ({ row, col })),
      );
      expect(board.munitionPoints).toBe(2);
      expect(enemy.munitionPoints).toBe(2 + returned.filter((shot) => shot.hit).length);
      expect(state.turnState.currentPlayerId).toBe(owner);
      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId: owner,
            actionType: "mine",
            data: cell,
          })
        ).status,
      ).toBe(422);
      expect(board.munitionPoints).toBe(2);
    } finally {
      await endRoom(harness.room);
    }
  });

  it("ends the attacker's turn when a bomb triggers a mine", async () => {
    const harness = await startBattle();

    try {
      await placeBoth(harness);
      const state = harness.room.snapshot();
      const owner = state.turnState.currentPlayerId!;
      const ownerBoard = state.boards.find((b) => b.playerId === owner)!;
      const attackerBoard = state.boards.find((b) => b.playerId !== owner)!;

      const mineCell = ownerBoard.cells.flatMap((line, row) =>
        line.flatMap((ship, col) => (ship === null ? [{ row, col }] : [])),
      )[0]!;

      const passCell = attackerBoard.cells.flatMap((line, row) =>
        line.flatMap((ship, col) => (ship === null ? [{ row, col }] : [])),
      )[0]!;

      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId: owner,
            actionType: "mine",
            data: mineCell,
          })
        ).status,
      ).toBe(200);
      await post(harness.room, "/agent/action", {
        playerId: owner,
        actionType: "cannon",
        data: passCell,
      });
      expect(state.turnState.currentPlayerId).toBe(attackerBoard.playerId);

      attackerBoard.munitionPoints = 5;
      const turn = state.turnState.turnNumber;

      const returnShotsBefore = state.shots.filter((shot) => shot.weapon === "mine").length;

      const response = await post(harness.room, "/agent/action", {
        playerId: attackerBoard.playerId,
        actionType: "bomb",
        data: {
          row: Math.min(mineCell.row, 8),
          col: Math.min(mineCell.col, 8),
        },
      });

      expect(response.status).toBe(200);
      expect(ownerBoard.triggeredMines).toContainEqual(mineCell);

      const returned = state.shots
        .filter((shot) => shot.weapon === "mine")
        .slice(returnShotsBefore);

      expect(returned).toHaveLength(3);
      expect(returned.every((shot) => shot.byPlayerId === owner)).toBe(true);
      expect(attackerBoard.mineShots).toEqual(returned.map(({ row, col }) => ({ row, col })));
      expect(state.turnState.currentPlayerId).toBe(owner);
      expect(state.turnState.turnNumber).toBe(turn + 1);
      expect(state.lastAnnouncement).toContain("Mine triggered. Turn over.");
    } finally {
      await endRoom(harness.room);
    }
  });
});

describe("Mine retaliation victory", () => {
  it("awards the mine owner victory when return fire sinks the attacking fleet", async () => {
    const harness = await startBattle();

    try {
      await placeBoth(harness);
      const state = harness.room.snapshot();
      const owner = state.turnState.currentPlayerId!;
      const enemy = state.boards.find((b) => b.playerId !== owner)!;
      await post(harness.room, "/agent/action", {
        playerId: owner,
        actionType: "mine",
        data: { row: 9, col: 9 },
      });
      await post(harness.room, "/agent/action", {
        playerId: owner,
        actionType: "cannon",
        data: { row: 9, col: 8 },
      });
      // Leave exactly one ship cell unhit and one return-fire target available.
      const last = enemy.ships[0]!;

      for (const ship of enemy.ships) {
        ship.sunk = ship !== last;
        ship.hits =
          BATTLESHIP_FLEET.find((f) => f.id === ship.id)!.length - (ship === last ? 1 : 0);
      }

      for (let row = 0; row < 10; row++)
        for (let col = 0; col < 10; col++) {
          if (row === last.row && col === last.col) continue;
          state.shots.push({
            row,
            col,
            hit: enemy.cells[row]![col] !== null,
            byPlayerId: owner,
            weapon: "cannon",
          });
        }

      const response = await post(harness.room, "/agent/action", {
        playerId: enemy.playerId,
        actionType: "cannon",
        data: { row: 9, col: 9 },
      });

      expect(response.status).toBe(200);
      expect(state.status).toBe("ended");
      expect(state.winner).toBe(owner);
      expect(state.shots.at(-1)).toMatchObject({
        weapon: "mine",
        hit: true,
        byPlayerId: owner,
      });
      expect(enemy.munitionPoints).toBe(3);
    } finally {
      await endRoom(harness.room);
    }
  });
});

describe("Complete ship damage", () => {
  it("sinks each ship only on its last occupied cell, ignoring a stale hit counter", async () => {
    const harness = await startBattle();

    try {
      await placeBoth(harness);
      const state = harness.room.snapshot();
      const attacker = state.turnState.currentPlayerId!;
      const target = state.boards.find((board) => board.playerId !== attacker)!;

      for (const ship of target.ships) {
        const cells = target.cells.flatMap((line, row) =>
          line.flatMap((id, col) => (id === ship.id ? [{ row, col }] : [])),
        );

        ship.hits = 99;

        for (const [index, cell] of cells.entries()) {
          const response = await post(harness.room, "/agent/action", {
            playerId: attacker,
            actionType: "cannon",
            data: cell,
          });

          expect(response.status).toBe(200);
          expect(ship.hits).toBe(index + 1);
          expect(ship.sunk).toBe(index === cells.length - 1);
          expect(state.shots.at(-1)?.sunkShipId).toBe(
            index === cells.length - 1 ? ship.id : undefined,
          );

          if (index === 0) {
            const duplicate = await post(harness.room, "/agent/action", {
              playerId: attacker,
              actionType: "cannon",
              data: cell,
            });

            expect(duplicate.status).toBe(409);
            expect(ship.hits).toBe(1);
            expect(ship.sunk).toBe(false);
          }
        }
      }

      expect(state.status).toBe("ended");
      expect(state.winner).toBe(attacker);
      expect(target.munitionPoints).toBe(22);

      const projector = harness.room;

      expect(projector.project(attacker, state).stats.yourScore).toBe(455);
    } finally {
      await endRoom(harness.room);
    }
  });
});

describe("Ability turn economy", () => {
  it("allows repeated specials while energy remains, including after reload", async () => {
    const harness = await startBattle();
    let room = harness.room;

    try {
      await placeBoth(harness);
      const state = harness.room.snapshot();
      const attacker = state.turnState.currentPlayerId!;
      const own = state.boards.find((board) => board.playerId === attacker)!;
      const enemy = state.boards.find((board) => board.playerId !== attacker)!;
      own.munitionPoints = 50;
      const turn = state.turnState.turnNumber;
      const startedAt = state.turnState.startedAt;

      for (const [actionType, firstData, secondData] of [
        ["mine", { row: 9, col: 9 }, { row: 9, col: 8 }],
        ["radar", { row: 0, col: 0 }, { row: 5, col: 5 }],
        ["bomb", { row: 0, col: 0 }, { row: 3, col: 3 }],
        ["torpedo", { row: 9, col: 8, direction: "n" }, { row: 9, col: 9, direction: "n" }],
      ] as const) {
        for (const data of [firstData, secondData]) {
          expect(
            (
              await post(room, "/agent/action", {
                playerId: attacker,
                actionType,
                data,
              })
            ).status,
          ).toBe(200);
          expect(state.turnState.currentPlayerId).toBe(attacker);
          expect(state.turnState.turnNumber).toBe(turn);
          expect(state.turnState.startedAt).toBe(startedAt);
        }
      }

      const expectedRemaining =
        50 -
        2 *
          (BATTLESHIP_WEAPON_COSTS.mine +
            BATTLESHIP_WEAPON_COSTS.radar +
            BATTLESHIP_WEAPON_COSTS.bomb +
            BATTLESHIP_WEAPON_COSTS.torpedo);

      expect(own.munitionPoints).toBe(expectedRemaining);
      expect(enemy.munitionPoints).toBe(
        state.shots.filter((shot) => shot.byPlayerId === attacker && shot.hit).length,
      );
      // Reload the serialized room to prove reuse is not an in-memory exception.
      harness.storage.set("gameState", structuredClone(state));
      room = new TestBattleshipRoom(harness.durableState, roomTestEnv());
      expect(
        (
          await post(room, "/agent/action", {
            playerId: attacker,
            actionType: "radar",
            data: { row: 8, col: 5 },
          })
        ).status,
      ).toBe(200);

      const projector = room;

      expect(projector.legal(attacker)).toContain("cannon");
      expect(projector.legal(attacker)).toContain("radar");
      expect(
        room.snapshot().boards.find((board) => board.playerId === attacker)?.munitionPoints,
      ).toBe(expectedRemaining - BATTLESHIP_WEAPON_COSTS.radar);
    } finally {
      await endRoom(room);
    }
  });

  it("refunds invalid specials without reducing energy", async () => {
    const harness = await startBattle();

    try {
      await placeBoth(harness);
      const state = harness.room.snapshot();
      const playerId = state.turnState.currentPlayerId!;
      const board = state.boards.find((board) => board.playerId === playerId)!;
      board.munitionPoints = 5;
      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId,
            actionType: "bomb",
            data: { row: 9, col: 9 },
          })
        ).status,
      ).not.toBe(200);
      expect(board.munitionPoints).toBe(5);
      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId,
            actionType: "bomb",
            data: { row: 7, col: 7 },
          })
        ).status,
      ).toBe(200);
      expect(board.munitionPoints).toBe(0);
    } finally {
      await endRoom(harness.room);
    }
  });
});

describe("Ability damage rewards the defender", () => {
  it.each(["bomb", "torpedo"] as const)("%s grants one energy per hit", async (actionType) => {
    const harness = await startBattle();

    try {
      await placeBoth(harness);
      const state = harness.room.snapshot();
      const playerId = state.turnState.currentPlayerId!;

      const attacker = state.boards.find((board) => board.playerId === playerId)!;

      const defender = state.boards.find((board) => board.playerId !== playerId)!;

      const col = defender.cells[0]!.findIndex(Boolean);
      attacker.munitionPoints = 10;
      defender.munitionPoints = 7;

      const data = actionType === "bomb" ? { row: 0, col } : { row: 0, col, direction: "s" };

      expect(
        (
          await post(harness.room, "/agent/action", {
            playerId,
            actionType,
            data,
          })
        ).status,
      ).toBe(200);

      const hits = state.shots.filter((shot) => shot.weapon === actionType && shot.hit).length;

      expect(hits).toBeGreaterThan(0);
      expect(defender.munitionPoints).toBe(7 + hits);
      expect(attacker.munitionPoints).toBe(10 - BATTLESHIP_WEAPON_COSTS[actionType]);
      expect(state.turnState.currentPlayerId).toBe(playerId);
    } finally {
      await endRoom(harness.room);
    }
  });
});
