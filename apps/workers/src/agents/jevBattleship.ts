import { z } from "zod";
import { BATTLESHIP_FLEET_FORMAT } from "@llmgames/game-catalog";
import {
  BATTLESHIP_FALLBACK_FLEET,
  BATTLESHIP_FLEET,
  BATTLESHIP_WEAPON_COSTS,
  cellsForShipSilhouette,
  TORPEDO_DELTAS,
  type ShipId,
  type ShipRotation,
  type TorpedoDirection,
} from "../durable-objects/types";
import { randomInt } from "../lib/csprng";
import type { JevDecision } from "./jev";

export type JevFleet = { id: ShipId; row: number; col: number; rotation: ShipRotation }[];

const rotations: ShipRotation[] = [0, 90, 180, 270];

const cell = z.object({ row: z.number().int().min(0).max(9), col: z.number().int().min(0).max(9) });

const radarScanSchema = cell.extend({ shipCells: z.number().int().min(0).max(9) });

export type JevRadarScan = z.infer<typeof radarScanSchema>;

const battleViewSchema = z.object({
  phase: z.enum(["placement", "battle"]),
  fleetReady: z.boolean(),
  legalActions: z.array(z.string()),
  turnNumber: z.number().optional(),
  boardSize: z.literal(10).default(10),
  gameTimeRemaining: z.number().nonnegative().optional(),
  turnTimeRemaining: z.number().nonnegative().optional(),
  targetGrid: z
    .array(z.string().regex(/^[.ox]{10}$/))
    .length(10)
    .optional(),
  targetGridFormat: z.string().optional(),
  ownGrid: z
    .array(z.string().regex(/^[.smox]{10}$/))
    .length(10)
    .optional(),
  ownGridFormat: z.string().optional(),
  munitionPoints: z.number().nonnegative().default(0),
  turnReward: z.number().optional(),
  damageReward: z.number().optional(),
  remainingShips: z.array(z.string()).optional(),
  sunkShips: z
    .array(
      z.object({
        id: z.string(),
        row: z.number().int(),
        col: z.number().int(),
        rotation: z.number(),
      }),
    )
    .optional(),
  radarScans: z.array(radarScanSchema).max(20).default([]),
});

/** Created once per hosted seat, then persisted. Rebuilding a decision is deterministic. */
export function generateJevFleets(): JevFleet[] {
  return Array.from({ length: 6 }, () => {
    for (let attempt = 0; attempt < 16; attempt++) {
      const fleet: JevFleet = [];
      const occupied = new Set<string>();

      for (const spec of BATTLESHIP_FLEET) {
        for (let placement = 0; placement < 100; placement++) {
          const row = randomInt(10),
            col = randomInt(10),
            rotation = rotations[randomInt(4)]!;

          const cells = cellsForShipSilhouette(row, col, spec.shape, rotation);

          if (
            !cells.every(
              (c) =>
                c.row >= 0 &&
                c.row < 10 &&
                c.col >= 0 &&
                c.col < 10 &&
                !occupied.has(`${c.row},${c.col}`),
            )
          )
            continue;
          cells.forEach((c) => occupied.add(`${c.row},${c.col}`));
          fleet.push({ id: spec.id, row, col, rotation });
          break;
        }

        if (fleet.length < BATTLESHIP_FLEET.indexOf(spec) + 1) break;
      }

      if (fleet.length === BATTLESHIP_FLEET.length) return fleet;
    }

    return BATTLESHIP_FALLBACK_FLEET.map((placement) => ({ ...placement }));
  });
}

export const parseJevBattleshipView = battleViewSchema.nullable().catch(null).parse;

export function jevBattleshipDecision(
  view: z.output<typeof battleViewSchema> | null,
  fleets: JevFleet[] = [],
): JevDecision | null {
  if (!view) return null;
  const options: JevDecision["options"] = {};

  const state: JevDecision["state"] = {
    ...view,
    game: "battleship",
    fleetFormat: BATTLESHIP_FLEET_FORMAT,
    fleet: BATTLESHIP_FLEET.map(({ id, "shape": silhouette }) => ({ id, "shape": silhouette })),
    weaponCosts: BATTLESHIP_WEAPON_COSTS,
  };

  if (view.phase === "placement") {
    if (view.fleetReady || !view.legalActions.includes("place_fleet")) return null;
    fleets.forEach((ships, index) => {
      options[`fleet_${index + 1}`] = {
        description: { ships: ships.map((ship) => ({ ...ship })) },
        action: { actionType: "place_fleet", data: { ships } },
      };
    });
  } else {
    const grid = view.targetGrid;

    if (!grid || !view.fleetReady) return null;

    const usable = (weapon: "cannon" | keyof typeof BATTLESHIP_WEAPON_COSTS) =>
      view.legalActions.includes(weapon) &&
      (weapon === "cannon" || view.munitionPoints >= BATTLESHIP_WEAPON_COSTS[weapon]);

    for (let row = 0; row < 10; row++)
      for (let col = 0; col < 10; col++) {
        for (const weapon of ["cannon", "bomb", "radar", "mine"] as const) {
          if (!usable(weapon)) continue;

          if (weapon === "cannon" && grid[row]![col] !== ".") continue;

          if (
            weapon === "bomb" &&
            (row > 8 ||
              col > 8 ||
              ![
                grid[row]![col],
                grid[row]![col + 1],
                grid[row + 1]![col],
                grid[row + 1]![col + 1],
              ].includes("."))
          )
            continue;

          if (weapon === "mine" && view.ownGrid?.[row]?.[col] !== ".") continue;
          options[`${weapon}_${row}_${col}`] = {
            description: { row, col },
            action: { actionType: weapon, data: { row, col } },
          };
        }
      }

    if (usable("torpedo"))
      for (let edge = 0; edge < 10; edge++) {
        const starts: { row: number; col: number; direction: TorpedoDirection }[] = [
          { row: 0, col: edge, direction: "s" },
          { row: 9, col: edge, direction: "n" },
          { row: edge, col: 0, direction: "e" },
          { row: edge, col: 9, direction: "w" },
        ];

        for (const start of starts) {
          const delta = TORPEDO_DELTAS[start.direction];
          let hasTarget = false;

          for (let i = 0; i < 10; i++) {
            const prior = grid[start.row + delta.dr * i]![start.col + delta.dc * i];

            if (prior === "x") break;

            if (prior === ".") {
              hasTarget = true;
              break;
            }
          }

          if (!hasTarget) continue;
          options[`torpedo_${start.row}_${start.col}_${start.direction}`] = {
            description: { ...start },
            action: { actionType: "torpedo", data: start },
          };
        }
      }
  }

  return Object.keys(options).length ? { state, options } : null;
}
