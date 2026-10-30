import type { WireValue } from "@llmgames/game-catalog";
import { z } from "zod";

import {
  fleetFor,
  post,
  step,
  transcriptRoom,
  type Side,
  type Transcript,
  type TranscriptRejection,
  type TranscriptRoom,
} from "./battleshipTranscript";
import type { RoomRuntime } from "../../../durable-objects/runtime";
import type { Env } from "../../../types";
import type { BattleshipRoom } from "../../../durable-objects/BattleshipRoom";

/**
 * The M3.5 scenario.
 *
 * One script, run twice: once against the pre-plugin room to freeze a golden
 * transcript, then against the migrated room. It walks every situation the old
 * room could reach — placement, deployment, hits, misses, all four weapons, a
 * mine retaliation, both timeout policies, a fleet sunk — and records what each
 * seat sees, because a rule change that only moves private state would otherwise
 * pass unnoticed.
 */

export interface ScenarioHooks {
  Room: new (state: RoomRuntime, env: Env) => BattleshipRoom;
  runtime: () => RoomRuntime;
  env: Env;
}

/** Rejection envelope: the English message is part of the public contract. */
const errorBody = z
  .object({
    ok: z.boolean().optional(),
    error: z.object({ message: z.string() }).optional(),
    message: z.string().optional(),
  })
  .passthrough();

interface Cell {
  row: number;
  col: number;
}

export async function buildTranscript(hooks: ScenarioHooks): Promise<Transcript> {
  const steps: Transcript["steps"] = [];
  const rejections: TranscriptRejection[] = [];
  const rooms: TranscriptRoom[] = [];

  const open = () => {
    const room = transcriptRoom(hooks.Room, hooks.runtime(), hooks.env);

    rooms.push(room);

    return room;
  };

  const reject = async (
    room: TranscriptRoom,
    label: string,
    playerId: string,
    actionType: string,
    data: WireValue = {},
  ) => {
    const response = await post(room, "/agent/action", { playerId, actionType, data });
    const body = errorBody.parse(await response.json());

    rejections.push({
      label,
      status: response.status,
      message: body.error?.message ?? body.message ?? null,
    });
  };

  const act = async (
    room: TranscriptRoom,
    playerId: string,
    actionType: string,
    data: WireValue = {},
  ) => {
    const response = await post(room, "/agent/action", { playerId, actionType, data });

    if (!response.ok) throw new Error(`${actionType}: ${await response.text()}`);

    return response;
  };

  // ─── Room 1: the full battle path ──────────────────────────────
  const main = open();

  await post(main, "/create", {
    hostId: "p1",
    hostName: "Player One",
    roomCode: "BS2345",
    turnTime: 60_000,
    gameTotalTime: 1_800_000,
  });
  await post(main, "/agent/join", { playerId: "p2", assignedCodename: "SwiftAnchor" });
  await post(main, "/agent/start", { playerId: "p1" });
  steps.push(step(main, "placement:start"));

  await reject(main, "placement:missing-ships", "p1", "place_fleet", {
    ships: fleetFor(0).slice(0, 2),
  });
  await reject(main, "placement:overlap", "p1", "place_fleet", {
    ships: fleetFor(0).map((ship, index) => (index === 1 ? { ...ship, row: 0, col: 0 } : ship)),
  });
  await reject(main, "placement:bad-rotation", "p1", "place_fleet", {
    ships: fleetFor(0).map((ship, index) => (index === 0 ? { ...ship, rotation: 45 } : ship)),
  });

  await act(main, "p1", "place_fleet", { ships: fleetFor(0) });
  steps.push(step(main, "placement:p1-ready"));

  await reject(main, "placement:already-ready", "p1", "place_fleet", { ships: fleetFor(0) });

  await act(main, "p2", "place_ships", { ships: fleetFor(1) });
  steps.push(step(main, "battle:start"));

  const boardOf = (playerId: string) =>
    main.snapshot().boards.find((board) => board.playerId === playerId)!;

  /** Legal targets on `defender`'s board that `attacker` has not fired at yet. */
  const targets = (defender: Side, attacker: Side, kind: "ship" | "water"): Cell[] =>
    boardOf(defender).cells.flatMap((row, rowIndex) =>
      row.flatMap((cell, col) => {
        if ((kind === "ship") !== (cell !== null)) return [];

        const fired = main
          .snapshot()
          .shots.some(
            (shot) => shot.byPlayerId === attacker && shot.row === rowIndex && shot.col === col,
          );

        return fired ? [] : [{ row: rowIndex, col }];
      }),
    );

  /** Somewhere a 2×2 salvo fits, so a bomb cannot be refused for geometry. */
  const bombable = (cells: Cell[]): Cell | undefined =>
    cells.find((cell) => cell.row <= 8 && cell.col <= 8);

  const p2Ship = targets("p2", "p1", "ship")[0]!;
  const p2Water = targets("p2", "p1", "water")[0]!;

  await reject(main, "battle:out-of-turn", "p2", "cannon", { row: 0, col: 0 });
  await reject(main, "battle:out-of-bounds", "p1", "cannon", { row: 10, col: 0 });
  await reject(main, "battle:float-cell", "p1", "cannon", { row: 1.5, col: 2 });
  await reject(main, "battle:unknown-action", "p1", "teleport", {});

  await act(main, "p1", "cannon", { ...p2Ship });
  steps.push(step(main, "cannon:hit-keeps-turn"));

  await reject(main, "battle:already-fired", "p1", "cannon", { ...p2Ship });

  await act(main, "p1", "fire", { ...p2Water });
  steps.push(step(main, "cannon:miss-passes-turn"));

  await act(main, "p2", "shoot", { ...targets("p1", "p2", "ship")[0]! });
  steps.push(step(main, "cannon:p2-hit"));

  await act(main, "p2", "cannon", { ...targets("p1", "p2", "water")[0]! });
  steps.push(step(main, "cannon:p2-miss"));

  // Energy is granted directly so the weapon steps stay readable; the point
  // economy itself is exercised by the cannon and timeout steps.
  boardOf("p1").munitionPoints = 40;

  await act(main, "p1", "radar", { ...targets("p2", "p1", "ship")[2]! });
  steps.push(step(main, "weapon:radar"));

  await reject(main, "weapon:bomb-out-of-bounds", "p1", "bomb", { row: 9, col: 9 });

  await act(main, "p1", "bomb", { ...bombable(targets("p2", "p1", "ship"))! });
  steps.push(step(main, "weapon:bomb"));

  await reject(main, "weapon:torpedo-not-on-edge", "p1", "torpedo", { row: 5, col: 5 });
  await reject(main, "weapon:torpedo-corner-needs-direction", "p1", "torpedo", {
    row: 0,
    col: 9,
  });

  // Fire down a column that still holds a ship, so the path stops on a hit
  // instead of crossing ten empty cells.
  const occupiedCols = new Set(
    targets("p2", "p1", "ship").map((cell) => cell.col),
  );

  const edgeCell = Array.from({ length: 10 }, (_, col) => ({ row: 0, col })).find(
    (cell) =>
      occupiedCols.has(cell.col) &&
      !main
        .snapshot()
        .shots.some((shot) => shot.byPlayerId === "p1" && shot.row === 0 && shot.col === cell.col),
  )!;

  await act(main, "p1", "torpedo", { ...edgeCell });
  steps.push(step(main, "weapon:torpedo"));

  const mineCell = bombable(targets("p1", "p2", "water"))!;

  await act(main, "p1", "mine", { ...mineCell });
  steps.push(step(main, "weapon:mine"));

  await reject(main, "weapon:mine-twice", "p1", "mine", { ...mineCell });

  // Hand the turn over by missing, then let the opponent bomb the mined water:
  // three return shots fire back and the turn ends.
  await act(main, "p1", "cannon", { ...targets("p2", "p1", "water")[0]! });
  boardOf("p2").munitionPoints = 40;
  await act(main, "p2", "bomb", { ...mineCell });
  steps.push(step(main, "weapon:mine-triggered"));

  await main.expireTurn(main.snapshot().turnState.currentPlayerId);
  steps.push(step(main, "timeout:battle-turn"));

  boardOf("p2").munitionPoints = 1;
  await reject(main, "weapon:radar-insufficient-points", "p2", "radar", { row: 0, col: 0 });

  // ─── Room 2: placement expires, both fleets auto-deploy ───────
  const idle = open();

  await post(idle, "/create", {
    hostId: "p1",
    hostName: "Player One",
    roomCode: "BS2346",
    turnTime: 60_000,
    gameTotalTime: 1_800_000,
  });
  await post(idle, "/agent/join", { playerId: "p2", assignedCodename: "SwiftAnchor" });
  await post(idle, "/agent/start", { playerId: "p1" });
  steps.push(step(idle, "auto:placement-start"));

  await idle.expireTurn(null);
  steps.push(step(idle, "auto:fleets-deployed"));

  await idle.expireTurn(idle.snapshot().turnState.currentPlayerId);
  steps.push(step(idle, "auto:battle-timeout"));

  // ─── Room 3: sink the fleet, read the replay ──────────────────
  const final = open();

  await post(final, "/create", {
    hostId: "p1",
    hostName: "Player One",
    roomCode: "BS2347",
    turnTime: 60_000,
    gameTotalTime: 1_800_000,
  });
  await post(final, "/agent/join", { playerId: "p2", assignedCodename: "SwiftAnchor" });
  await post(final, "/agent/start", { playerId: "p1" });
  await act(final, "p1", "place_fleet", { ships: fleetFor(0) });
  await act(final, "p2", "place_fleet", { ships: fleetFor(1) });

  const loser = final.snapshot().boards.find((board) => board.playerId === "p2")!;

  const cellsOf = (id: string) =>
    loser.cells.flatMap((row, rowIndex) =>
      row.flatMap((cell, col) => (cell === id ? [{ row: rowIndex, col }] : [])),
    );

  // Only the destroyer survives: every other cell is cleared, so the shots below
  // are the only path to a decided match. Its cells come from the board itself,
  // never from guessed geometry — a rotated silhouette is not a straight line.
  const survivorCells = cellsOf("destroyer");

  for (const ship of loser.ships) {
    if (ship.id === "destroyer") continue;
    ship.hits = cellsOf(ship.id).length;
    ship.sunk = true;
  }

  loser.cells = loser.cells.map((row, rowIndex) =>
    row.map((cell, col) =>
      survivorCells.some((spot) => spot.row === rowIndex && spot.col === col) ? cell : null,
    ),
  );

  for (const cell of survivorCells) await act(final, "p1", "cannon", { ...cell });

  steps.push(step(final, "end:fleet-sunk"));

  await reject(final, "end:action-after-end", "p1", "cannon", { row: 5, col: 5 });

  return {
    steps,
    rejections,
    events: rooms.flatMap((room) => room.events),
    replay: final.replayView(),
  };
}
