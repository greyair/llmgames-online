import { z } from "zod";
import {
  agentFields,
  BATTLESHIP_FLEET,
  BATTLESHIP_FLEET_FORMAT,
  defined,
  isNumber,
  type ProjectionPart,
  type WireObject,
} from "@llmgames/game-catalog";

const object = z
  .object({
    yourBoard: z.unknown().optional(),
    opponent: z.unknown().optional(),
    munitionEconomy: z.unknown().optional(),
    turnState: z.unknown().optional(),
    you: z.unknown().optional(),
    phase: z.unknown().optional(),
    boardSize: z.unknown().optional(),
    sunkShips: z.unknown().optional(),
    radarScans: z.unknown().optional(),
    ownGrid: z.unknown().optional(),
    targetGrid: z.unknown().optional(),
    ready: z.unknown().optional(),
    cells: z.unknown().optional(),
    mines: z.unknown().optional(),
    incomingHits: z.unknown().optional(),
    incomingMisses: z.unknown().optional(),
    hits: z.unknown().optional(),
    misses: z.unknown().optional(),
    row: z.unknown().optional(),
    col: z.unknown().optional(),
    id: z.unknown().optional(),
    rotation: z.unknown().optional(),
    shipCells: z.unknown().optional(),
    fleetReady: z.unknown().optional(),
    munitionPoints: z.unknown().optional(),
    yourPoints: z.unknown().optional(),
    costs: z.unknown().optional(),
    weaponCosts: z.unknown().optional(),
    turnReward: z.unknown().optional(),
    damageReward: z.unknown().optional(),
    winner: z.unknown().optional(),
  })
  .optional()
  .catch(undefined).parse;

const rows = z.array(z.unknown()).catch([]).parse;

const pointSchema = z.object({ row: z.number().int(), col: z.number().int() });

const points = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const result = pointSchema.safeParse(entry);

      return result.success ? [result.data] : [];
    }),
  ).parse;

function grid(
  size: number,
  hits: Array<{ row: number; col: number }>,
  misses: Array<{ row: number; col: number }>,
  cells?: unknown[][],
  mines?: Array<{ row: number; col: number }>,
): string[] {
  const board: string[][] = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => (rows(rows(cells)[row])[col] ? "s" : ".")),
  );

  for (const [entries, marker] of [
    [mines, "m"],
    [misses, "o"],
    [hits, "x"],
  ] as const) {
    for (const { row, col } of entries ?? [])
      if (board[row]?.[col] !== undefined) board[row]![col] = marker;
  }

  return board.map((row) => row.join(""));
}

/**
 * Shrink a seat-projected battleship view to grids and counters.
 *
 * Only accepts an already seat-projected view. Never pass authoritative boards
 * here: a grid built from the real fleet would hand the rival the layout.
 */
export function battleshipAgentDecision(view: ProjectionPart): WireObject {
  const own = object(view.yourBoard);
  const opponent = object(view.opponent);
  const economy = object(view.munitionEconomy);
  const phase = object(view.turnState)?.phase ?? object(view.you)?.phase ?? view.phase;
  const size = isNumber(view.boardSize) ? view.boardSize : 10;

  const sunkShips = rows(opponent?.sunkShips ?? view.sunkShips).flatMap((entry) => {
    const ship = object(entry);

    return ship
      ? [defined({ id: ship.id, row: ship.row, col: ship.col, rotation: ship.rotation })]
      : [];
  });

  const sunk = new Set(sunkShips.map((ship) => ship.id));

  const scans = rows(opponent?.radarScans ?? view.radarScans)
    .slice(-20)
    .flatMap((entry) => {
      const scan = object(entry);

      return scan ? [defined({ row: scan.row, col: scan.col, shipCells: scan.shipCells })] : [];
    });

  return agentFields({
    boardSize: size,
    // One shape definition per ship. IDs are needed for placement and sunk-ship identity.
    fleet: BATTLESHIP_FLEET.map(({ id, "shape": silhouette }) => ({ id, "shape": silhouette })),
    fleetFormat: BATTLESHIP_FLEET_FORMAT,
    fleetReady: own?.ready ?? view.fleetReady,
    ownGrid: own?.cells
      ? grid(
          size,
          points(own.incomingHits),
          points(own.incomingMisses),
          rows(own.cells).map((row) => rows(row)),
          points(own.mines),
        )
      : view.ownGrid,
    ownGridFormat:
      own?.cells || view.ownGrid
        ? ". empty water, s ship, m armed mine, x hit ship, o attacked water"
        : undefined,
    targetGrid: opponent
      ? grid(size, points(opponent.hits), points(opponent.misses))
      : view.targetGrid,
    targetGridFormat: opponent || view.targetGrid ? ". unknown, o miss, x hit" : undefined,
    remainingShips:
      phase !== "placement" && (opponent || view.targetGrid)
        ? BATTLESHIP_FLEET.filter((ship) => !sunk.has(ship.id)).map((ship) => ship.id)
        : undefined,
    sunkShips: phase !== "placement" && (opponent || view.targetGrid) ? sunkShips : undefined,
    radarScans: phase !== "placement" && (opponent || view.targetGrid) ? scans : undefined,
    munitionPoints: own?.munitionPoints ?? economy?.yourPoints ?? view.munitionPoints,
    weaponCosts: economy?.costs ?? view.weaponCosts,
    turnReward: economy?.turnReward ?? view.turnReward,
    damageReward: economy?.damageReward ?? view.damageReward,
    winner: view.winner,
  });
}
