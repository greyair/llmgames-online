import { isNumber, isWireObject, type WireValue } from "@llmgames/game-catalog";
import { z } from "zod";

import {
  BATTLESHIP_FLEET,
  BATTLESHIP_FALLBACK_FLEET,
  BATTLESHIP_STARTING_MUNITION_POINTS,
  BATTLESHIP_WEAPON_COSTS,
  cellsForShipSilhouette,
  parseShipRotation,
} from "../../durable-objects/types";
import type {
  BattleshipGameState,
  BattleshipPlayerBoard,
  BattleShot,
  PlacedShip,
  ShipId,
  ShipRotation,
  WeaponId,
} from "../../durable-objects/types";
import { randomInt } from "../../lib/csprng";

/**
 * Battleship board mechanics (M3.5).
 *
 * Everything here is a pure function of the state it is given. The room keeps
 * the lifecycle; this module only knows fleets, cells, damage and scores, which
 * is why the migration could be checked against a frozen transcript.
 */

export const BATTLESHIP_SIZE = 10;

const SHIP_ROTATIONS: readonly ShipRotation[] = [0, 90, 180, 270];

export interface FleetPlacementInput {
  id: ShipId;
  row: number;
  col: number;
  orientation?: WireValue;
  rotation?: WireValue;
}

/** One ship placement from a client payload, or null when it is malformed. */
export function parseFleetPlacement(value: WireValue): FleetPlacementInput | null {
  if (!isWireObject(value)) return null;

  const id = value.id;
  const row = value.row;
  const col = value.col;

  if (!BATTLESHIP_FLEET.some((ship) => ship.id === id) || !isNumber(row) || !isNumber(col))
    return null;

  return {
    id: z.enum(["carrier", "dreadnought", "cruiser", "submarine", "destroyer"]).parse(id),
    row,
    col,
    orientation: value.orientation,
    rotation: value.rotation,
  };
}

/** Accepts `ships` or the legacy `fleet` key; both must describe a full fleet. */
export function parseFleetPayload(data: WireValue): FleetPlacementInput[] | null {
  if (!isWireObject(data)) return null;

  const value = data.ships ?? data.fleet;

  if (!Array.isArray(value)) return null;

  const parsed = value.map(parseFleetPlacement);

  return parsed.every((placement): placement is FleetPlacementInput => placement !== null)
    ? parsed
    : null;
}

export function emptyCells(): (ShipId | null)[][] {
  return Array.from({ length: BATTLESHIP_SIZE }, () =>
    Array.from({ length: BATTLESHIP_SIZE }, () => null),
  );
}

/**
 * Max uses left if the remaining points were spent only on that weapon.
 *
 * The arsenal shown to clients is always derived from points, never stored
 * separately, so spending and refunding cannot drift apart.
 */
export function maxUsesFromPoints(points: number): Record<WeaponId, number> {
  return {
    mine: Math.floor(points / BATTLESHIP_WEAPON_COSTS.mine),
    radar: Math.floor(points / BATTLESHIP_WEAPON_COSTS.radar),
    bomb: Math.floor(points / BATTLESHIP_WEAPON_COSTS.bomb),
    torpedo: Math.floor(points / BATTLESHIP_WEAPON_COSTS.torpedo),
  };
}

export function emptyBoard(playerId: string): BattleshipPlayerBoard {
  const munitionPoints = BATTLESHIP_STARTING_MUNITION_POINTS;

  return {
    playerId,
    mines: [],
    mineShots: [],
    radarScans: [],
    ships: [],
    cells: emptyCells(),
    ready: false,
    munitionPoints,
    weapons: maxUsesFromPoints(munitionPoints),
    shotsFired: 0,
    hitsScored: 0,
  };
}

export function shipLength(id: ShipId): number {
  return BATTLESHIP_FLEET.find((f) => f.id === id)!.length;
}

export function shipName(id: ShipId): string {
  return BATTLESHIP_FLEET.find((f) => f.id === id)?.name ?? id;
}

export function shipSpec(id: ShipId) {
  return BATTLESHIP_FLEET.find((f) => f.id === id)!;
}

export function scoreShotsForPlayer(shots: BattleShot[], playerId: string): number {
  return shots.reduce((score, shot) => {
    if (shot.byPlayerId !== playerId || !shot.hit) return score;

    const sinkBonus = shot.sunkShipId ? 25 + shipLength(shot.sunkShipId) * 5 : 0;

    return score + 10 + sinkBonus;
  }, 0);
}

/** Newest 40 shots, the window every client view and replay carries. */
export function projectShotWindow(shots: BattleShot[]) {
  const start = Math.max(0, shots.length - 40);

  return shots.slice(start).map((shot, offset) => ({
    sequence: start + offset + 1,
    row: shot.row,
    col: shot.col,
    hit: shot.hit,
    sunkShipId: shot.sunkShipId,
    byPlayerId: shot.byPlayerId,
    weapon: shot.weapon === "fire" ? "cannon" : (shot.weapon ?? "cannon"),
    salvoId: shot.salvoId,
  }));
}

export function orientationAlias(rotation: ShipRotation): "h" | "v" {
  return rotation === 0 || rotation === 180 ? "h" : "v";
}

export function validateFleet(
  placements: FleetPlacementInput[],
): { ok: true; ships: PlacedShip[]; cells: (ShipId | null)[][] } | { ok: false; error: string } {
  if (placements.length !== BATTLESHIP_FLEET.length) {
    return {
      ok: false,
      error: `Need exactly ${BATTLESHIP_FLEET.length} ships: ${BATTLESHIP_FLEET.map((s) => s.id).join(", ")}`,
    };
  }

  const seen = new Set<string>();
  const cells = emptyCells();
  const ships: PlacedShip[] = [];

  for (const spec of BATTLESHIP_FLEET) {
    const p = placements.find((x) => x.id === spec.id);

    if (!p) return { ok: false, error: `Missing ship: ${spec.id}` };

    if (seen.has(p.id)) return { ok: false, error: `Duplicate ship: ${p.id}` };
    seen.add(p.id);

    const rotation = parseShipRotation(p.rotation !== undefined ? p.rotation : p.orientation);

    if (rotation === null) {
      return {
        ok: false,
        error: `${spec.id}: rotation must be 0|90|180|270 (or orientation h|v)`,
      };
    }

    if (!Number.isInteger(p.row) || !Number.isInteger(p.col) || p.row < 0 || p.col < 0) {
      return { ok: false, error: "Invalid row/col" };
    }

    const coords = cellsForShipSilhouette(p.row, p.col, spec.shape, rotation);

    for (const { row, col } of coords) {
      if (row < 0 || row >= BATTLESHIP_SIZE || col < 0 || col >= BATTLESHIP_SIZE) {
        return { ok: false, error: `${spec.id} out of bounds` };
      }

      if (cells[row]![col]) {
        return { ok: false, error: `${spec.id} overlaps another ship` };
      }

      cells[row]![col] = spec.id;
    }

    ships.push({
      id: spec.id,
      row: p.row,
      col: p.col,
      rotation,
      orientation: orientationAlias(rotation),
      hits: 0,
      sunk: false,
    });
  }

  return { ok: true, ships, cells };
}

/**
 * Server-owned fleet for a captain who misses placement time.
 *
 * Random placement stays random in production: this is the only caller of the
 * CSPRNG in the rule module, and a test seeds it to zero instead of replacing it.
 */
export function randomFleet(): {
  ships: PlacedShip[];
  cells: (ShipId | null)[][];
} {
  for (let fleetAttempt = 0; fleetAttempt < 100; fleetAttempt++) {
    const placements: FleetPlacementInput[] = [];
    const occupied = new Set<string>();
    let complete = true;

    for (const spec of BATTLESHIP_FLEET) {
      let placed: FleetPlacementInput | null = null;

      for (let shipAttempt = 0; shipAttempt < 100; shipAttempt++) {
        const rotation = SHIP_ROTATIONS[randomInt(SHIP_ROTATIONS.length)]!;
        const row = randomInt(BATTLESHIP_SIZE);
        const col = randomInt(BATTLESHIP_SIZE);
        const coords = cellsForShipSilhouette(row, col, spec.shape, rotation);

        if (
          coords.every(
            (cell) =>
              cell.row >= 0 &&
              cell.row < BATTLESHIP_SIZE &&
              cell.col >= 0 &&
              cell.col < BATTLESHIP_SIZE &&
              !occupied.has(`${cell.row},${cell.col}`),
          )
        ) {
          placed = { id: spec.id, row, col, rotation };

          for (const cell of coords) occupied.add(`${cell.row},${cell.col}`);
          break;
        }
      }

      if (!placed) {
        complete = false;
        break;
      }

      placements.push(placed);
    }

    if (complete) {
      const result = validateFleet(placements);

      if (result.ok) return result;
    }
  }

  // Guaranteed non-overlapping fallback shared with tests and hosted agents.
  const fallback = validateFleet(BATTLESHIP_FALLBACK_FLEET.map((placement) => ({ ...placement })));

  if (!fallback.ok) throw new Error(`Invalid fallback fleet: ${fallback.error}`);

  return fallback;
}

export function parseCell(data: WireValue): { row: number; col: number } | string {
  if (!isWireObject(data)) return `row and col must be integers 0–${BATTLESHIP_SIZE - 1}`;

  const row = data.row ?? data.y;
  const col = data.col ?? data.x;

  if (
    !isNumber(row) ||
    !isNumber(col) ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= BATTLESHIP_SIZE ||
    col < 0 ||
    col >= BATTLESHIP_SIZE
  ) {
    return `row and col must be integers 0–${BATTLESHIP_SIZE - 1}`;
  }

  return { row, col };
}

/** Whether `byPlayerId` already fired at this cell. */
export function shotAt(
  state: BattleshipGameState,
  byPlayerId: string,
  row: number,
  col: number,
): boolean {
  return state.shots.some((s) => s.byPlayerId === byPlayerId && s.row === row && s.col === col);
}

/**
 * Migrate boards saved before munition-points / polyomino rotations.
 *
 * Projections run this on every read, so a room persisted by an older build
 * repairs itself the first time somebody looks at it. It mutates the state on
 * purpose: the repaired fields are persisted by the next write.
 */
export function normalizeBoard(board: BattleshipPlayerBoard): void {
  if (!isNumber(board.munitionPoints)) {
    // Old charge-based arsenal → convert remaining charges into points
    const w = board.weapons ?? { radar: 0, bomb: 0, torpedo: 0 };

    board.munitionPoints =
      (w.radar ?? 0) * BATTLESHIP_WEAPON_COSTS.radar +
      (w.torpedo ?? 0) * BATTLESHIP_WEAPON_COSTS.torpedo +
      (w.bomb ?? 0) * BATTLESHIP_WEAPON_COSTS.bomb;
  }

  board.radarScans ??= [];
  board.receivedRadarScans ??= [];
  board.triggeredMines ??= [];
  board.mineShots ??= [...(board.mineHits ?? [])];
  board.weapons = maxUsesFromPoints(board.munitionPoints);

  for (const ship of board.ships) {
    if (ship.rotation === undefined || ship.rotation === null) {
      const r = parseShipRotation(ship.orientation) ?? 0;

      ship.rotation = r;
    }

    ship.orientation = orientationAlias(ship.rotation);
  }
}

export function boardOf(state: BattleshipGameState, playerId: string) {
  return state.boards.find((board) => board.playerId === playerId);
}

export function opponentBoard(state: BattleshipGameState, playerId: string) {
  return state.boards.find((board) => board.playerId !== playerId);
}
