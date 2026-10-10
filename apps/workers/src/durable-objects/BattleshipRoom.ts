import { isWireObject, type WireValue } from "@llmgames/game-catalog";
import { z } from "zod";
import type { RoomRuntime } from "./runtime";
import { isNumber, isString } from "@llmgames/game-catalog";

import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";
import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type {
  BattleshipGameState,
  BattleshipPlayerBoard,
  BattleShot,
  PlacedShip,
  Player,
  ShipId,
  ShipRotation,
  ShotWeapon,
  WeaponId,
} from "./types";
import {
  BATTLESHIP_CANNON_POINT_REWARD,
  BATTLESHIP_TURN_POINT_REWARD,
  BATTLESHIP_DAMAGE_POINT_REWARD,
  BATTLESHIP_FALLBACK_FLEET,
  BATTLESHIP_FLEET,
  BATTLESHIP_STARTING_MUNITION_POINTS,
  BATTLESHIP_WEAPON_COSTS,
  BATTLESHIP_WEAPONS_CATALOG,
  cellsForShipSilhouette,
  parseShipRotation,
  resolveTorpedoDirection,
  TORPEDO_DELTAS,
} from "./types";
import { randomId, randomInt } from "../lib/csprng";

const SIZE = 10;

export const BATTLESHIP_PLACEMENT_TIME_MS = 5 * 60 * 1000;

const SHIP_ROTATIONS: readonly ShipRotation[] = [0, 90, 180, 270];

type FleetPlacementInput = {
  id: ShipId;
  row: number;
  col: number;
  orientation?: WireValue;
  rotation?: WireValue;
};

function parseFleetPlacement(value: WireValue): FleetPlacementInput | null {
  if (!isWireObject(value)) {
    return null;
  }

  const id = value.id;
  const row = value.row;
  const col = value.col;

  if (!BATTLESHIP_FLEET.some((ship) => ship.id === id) || !isNumber(row) || !isNumber(col)) {
    return null;
  }

  return {
    id: z.enum(["carrier", "dreadnought", "cruiser", "submarine", "destroyer"]).parse(id),
    row,
    col,
    orientation: value.orientation,
    rotation: value.rotation,
  };
}

function parseFleetPayload(data: WireValue): FleetPlacementInput[] | null {
  if (!isWireObject(data)) {
    return null;
  }

  const value = data.ships ?? data.fleet;

  if (!Array.isArray(value)) return null;
  const parsed = value.map(parseFleetPlacement);

  return parsed.every((placement): placement is FleetPlacementInput => placement !== null)
    ? parsed
    : null;
}

function emptyCells(): (ShipId | null)[][] {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
}

/** Max uses left if remaining points were spent only on that weapon. */
function maxUsesFromPoints(points: number): Record<WeaponId, number> {
  return {
    mine: Math.floor(points / BATTLESHIP_WEAPON_COSTS.mine),
    radar: Math.floor(points / BATTLESHIP_WEAPON_COSTS.radar),
    bomb: Math.floor(points / BATTLESHIP_WEAPON_COSTS.bomb),
    torpedo: Math.floor(points / BATTLESHIP_WEAPON_COSTS.torpedo),
  };
}

function emptyBoard(playerId: string): BattleshipPlayerBoard {
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

function shipLength(id: ShipId): number {
  return BATTLESHIP_FLEET.find((f) => f.id === id)!.length;
}

function shipName(id: ShipId): string {
  return BATTLESHIP_FLEET.find((f) => f.id === id)?.name ?? id;
}

function shipSpec(id: ShipId) {
  return BATTLESHIP_FLEET.find((f) => f.id === id)!;
}

function scoreShotsForPlayer(shots: BattleShot[], playerId: string): number {
  return shots.reduce((score, shot) => {
    if (shot.byPlayerId !== playerId || !shot.hit) return score;

    const sinkBonus = shot.sunkShipId ? 25 + shipLength(shot.sunkShipId) * 5 : 0;

    return score + 10 + sinkBonus;
  }, 0);
}

function projectShotWindow(shots: BattleShot[]) {
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

function orientationAlias(rotation: ShipRotation): "h" | "v" {
  return rotation === 0 || rotation === 180 ? "h" : "v";
}

function validateFleet(
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
      if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) {
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

/** Build a server-owned valid fleet for a captain who misses placement time. */
function randomFleet(): {
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
        const row = randomInt(SIZE);
        const col = randomInt(SIZE);
        const coords = cellsForShipSilhouette(row, col, spec.shape, rotation);

        if (
          coords.every(
            (cell) =>
              cell.row >= 0 &&
              cell.row < SIZE &&
              cell.col >= 0 &&
              cell.col < SIZE &&
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

function parseCell(data: WireValue): { row: number; col: number } | string {
  if (!isWireObject(data)) {
    return `row and col must be integers 0–${SIZE - 1}`;
  }

  const row = data.row ?? data.y;
  const col = data.col ?? data.x;

  if (
    !isNumber(row) ||
    !isNumber(col) ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= SIZE ||
    col < 0 ||
    col >= SIZE
  ) {
    return `row and col must be integers 0–${SIZE - 1}`;
  }

  return { row, col };
}

/**
 * Battleship 1v1 with fog of war + energy munitions.
 * Phases: placement → battle → ended
 * Actions: place_fleet, cannon (fire), bomb, radar, torpedo
 */
export class BattleshipRoom extends BaseGameRoom<BattleshipGameState> {
  protected readonly roomLabel = "BattleshipRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected async onTurnTimeout(_playerId: string | null): Promise<void> {
    if (!this.gameState) return;

    if (this.gameState.turnState.phase === "battle") {
      const next = this.gameState.boards.find(
        (b) => b.playerId !== this.gameState!.turnState.currentPlayerId,
      );

      if (next) this.awardTurnPoints(next.playerId);
      await this.nextTurn();

      return;
    }

    if (this.gameState.turnState.phase !== "placement") return;

    const autoPlacedPlayerIds: string[] = [];

    for (const board of this.gameState.boards) {
      if (board.ready) continue;
      const fleet = randomFleet();
      board.ships = fleet.ships;
      board.cells = fleet.cells;
      board.ready = true;
      board.munitionPoints = BATTLESHIP_STARTING_MUNITION_POINTS;
      board.weapons = maxUsesFromPoints(board.munitionPoints);
      autoPlacedPlayerIds.push(board.playerId);
      this.recordEvent("fleet_auto_placed", { playerId: board.playerId });
    }

    this.beginBattle("Placement time expired — missing fleets auto-deployed.");
    this.recordEvent("placement_timeout", { autoPlacedPlayerIds });
    await this.saveState();
    this.broadcastState();
  }

  protected get minPlayersToStart(): number {
    return 2;
  }

  protected get initialTurnPhase(): string {
    return "placement";
  }

  protected createDefaultState(
    config: {
      hostId: string;
      hostName: string;
      maxPlayers?: number;
      gameTotalTime?: number;
      turnTime?: number;
      roomCode?: string;
    },
    roomCode: string,
  ): BattleshipGameState {
    const createdAt = Date.now();

    return {
      id: randomId(),
      roomCode,
      type: "battleship",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: 2,
      timerConfig: {
        gameTotalTime: config.gameTotalTime ?? 30 * 60 * 1000,
        turnTime: config.turnTime ?? 90 * 1000,
      },
      gameTimeRemaining: config.gameTotalTime ?? 30 * 60 * 1000,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: config.turnTime ?? 90 * 1000,
      },
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + ROOM_LIFETIME_MS,
      boards: [],
      shots: [],
      winner: null,
      boardSize: SIZE,
      lastAnnouncement: null,
    };
  }

  protected onStartGame(): void {
    if (!this.gameState) return;
    this.gameState.boards = this.gameState.players.map((p) => emptyBoard(p.id));
    this.gameState.shots = [];
    this.gameState.winner = null;
    this.gameState.lastAnnouncement = "Place your fleet — ships cannot overlap.";
    this.gameState.turnState.phase = "placement";
    this.gameState.turnState.currentPlayerId = null;
    this.gameState.turnState.turnNumber = 0;
    this.gameState.turnState.turnTimeRemaining = BATTLESHIP_PLACEMENT_TIME_MS;
    this.gameState.turnState.startedAt = Date.now();
  }

  /**
   * Fog of war: hide opponent ships; show own board fully; show all shot results.
   * Spectators get a dual public view (both fleets hidden; hit/miss pegs only).
   */
  protected projectStateFor(playerId: string, state: BattleshipGameState) {
    const seated = state.players.some((p) => p.id === playerId);

    if (!seated) {
      return this.projectSpectatorState(state);
    }

    const myBoard = state.boards.find((b) => b.playerId === playerId);
    const oppBoard = state.boards.find((b) => b.playerId !== playerId);
    const opponentId = oppBoard?.playerId;

    if (myBoard) this.normalizeBoard(myBoard);

    if (oppBoard) this.normalizeBoard(oppBoard);

    const myShots = state.shots.filter((s) => s.byPlayerId === playerId);
    const oppShots = state.shots.filter((s) => s.byPlayerId !== playerId);

    const myShipsAlive = myBoard?.ships.filter((s) => !s.sunk).length ?? 0;
    const oppShipsAlive = oppBoard?.ships.filter((s) => !s.sunk).length ?? 0;

    const opponentView = oppBoard
      ? {
          playerId: oppBoard.playerId,
          ready: oppBoard.ready,
          hits: myShots
            .filter((s) => s.hit)
            .map((s) => ({
              row: s.row,
              col: s.col,
              sunkShipId: s.sunkShipId,
              weapon: s.weapon ?? "fire",
            })),
          misses: myShots
            .filter((s) => !s.hit)
            .map((s) => ({
              row: s.row,
              col: s.col,
              weapon: s.weapon ?? "fire",
            })),
          shipsRemaining: oppShipsAlive,
          radarScans: oppBoard.receivedRadarScans ?? [],
          bombedAreas: oppBoard.bombedAreas ?? [],
          triggeredMines: oppBoard.triggeredMines ?? [],
          torpedoPaths: oppBoard.torpedoPaths ?? [],
          mineShots: oppBoard.mineShots ?? oppBoard.mineHits ?? [],
          mineHits: oppBoard.mineHits ?? [],
          fleetStatus: BATTLESHIP_FLEET.map((spec) => {
            const ship = oppBoard.ships.find((s) => s.id === spec.id);

            return {
              id: spec.id,
              name: spec.name,
              shortName: spec.shortName,
              length: spec.length,
              "shape": spec.shape,
              // Only reveal damage/sunk after hits are known via shots;
              // sunk is public; hit count only when fully sunk or partial hits
              // known from hit pegs on that ship.
              sunk: ship?.sunk ?? false,
              // Partial: count known hits on cells of this ship only if sunk
              // (fog) — if not sunk, report null for hits
              hits: ship?.sunk ? spec.length : undefined,
            };
          }),
          sunkShips: oppBoard.ships
            .filter((s) => s.sunk)
            .map((s) => ({
              id: s.id,
              name: shipName(s.id),
              length: shipLength(s.id),
              row: s.row,
              col: s.col,
              rotation: s.rotation,
              orientation: s.orientation,
              "shape": shipSpec(s.id).shape,
            })),
          shotsFired: oppBoard.shotsFired,
          hitsScored: oppBoard.hitsScored,
        }
      : null;

    const munitionPoints = myBoard?.munitionPoints ?? BATTLESHIP_STARTING_MUNITION_POINTS;

    return {
      id: state.id,
      roomCode: state.roomCode,
      type: state.type,
      status: state.status,
      players: state.players,
      hostId: state.hostId,
      maxPlayers: state.maxPlayers,
      timerConfig: state.timerConfig,
      gameTimeRemaining: state.gameTimeRemaining,
      turnState: state.turnState,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      expiresAt: state.expiresAt,
      boardSize: state.boardSize,
      winner: state.winner,
      lastAnnouncement: state.lastAnnouncement,
      radarScans: myBoard?.radarScans ?? [],
      fleet: BATTLESHIP_FLEET.map((s) => ({
        id: s.id,
        length: s.length,
        name: s.name,
        shortName: s.shortName,
        "shape": s.shape,
      })),
      /** Explicit munition economy: gain points at turn start, spend on specials. */
      munitionEconomy: {
        startingPoints: BATTLESHIP_STARTING_MUNITION_POINTS,
        cannonReward: BATTLESHIP_CANNON_POINT_REWARD,
        turnReward: BATTLESHIP_TURN_POINT_REWARD,
        damageReward: BATTLESHIP_DAMAGE_POINT_REWARD,
        costs: { ...BATTLESHIP_WEAPON_COSTS },
        yourPoints: munitionPoints,
        note:
          "Gain 2 energy at turn start and 1 energy per new hit your fleet takes, including ability hits. Normal shots are free; hits keep your turn. " +
          "Specials may be reused while you have enough energy. They do not end or refresh the turn unless a bomb triggers a mine; after its three random return shots, the bombing player's turn ends. Mines cost 2 energy and are placed on your own empty water. Specials: " +
          `bomb ${BATTLESHIP_WEAPON_COSTS.bomb} (2×2) · ` +
          `radar ${BATTLESHIP_WEAPON_COSTS.radar} (3×3 info) · ` +
          `torpedo ${BATTLESHIP_WEAPON_COSTS.torpedo} (edge → stop on first hit).`,
      },
      weaponsCatalog: BATTLESHIP_WEAPONS_CATALOG,
      yourBoard: myBoard
        ? {
            ships: myBoard.ships.map((s) => ({
              ...s,
              name: shipName(s.id),
              length: shipLength(s.id),
              "shape": shipSpec(s.id).shape,
              cells: cellsForShipSilhouette(s.row, s.col, shipSpec(s.id).shape, s.rotation),
            })),
            mines: myBoard.mines ?? [],
            cells: myBoard.cells,
            ready: myBoard.ready,
            munitionPoints: myBoard.munitionPoints,
            weapons: maxUsesFromPoints(myBoard.munitionPoints),
            weaponCosts: { ...BATTLESHIP_WEAPON_COSTS },
            shotsFired: myBoard.shotsFired,
            hitsScored: myBoard.hitsScored,
            shipsRemaining: myShipsAlive,
            radarScans: myBoard.receivedRadarScans ?? [],
            bombedAreas: myBoard.bombedAreas ?? [],
            triggeredMines: myBoard.triggeredMines ?? [],
            torpedoPaths: myBoard.torpedoPaths ?? [],
            mineShots: myBoard.mineShots ?? myBoard.mineHits ?? [],
            mineHits: myBoard.mineHits ?? [],
            fleetStatus: BATTLESHIP_FLEET.map((spec) => {
              const ship = myBoard.ships.find((s) => s.id === spec.id);

              return {
                id: spec.id,
                name: spec.name,
                shortName: spec.shortName,
                length: spec.length,
                "shape": spec.shape,
                hits: ship?.hits ?? 0,
                sunk: ship?.sunk ?? false,
                placed: Boolean(ship),
                row: ship?.row,
                col: ship?.col,
                rotation: ship?.rotation,
                orientation: ship?.orientation,
              };
            }),
            incomingHits: oppShots
              .filter((s) => s.hit)
              .map((s) => ({
                row: s.row,
                col: s.col,
                weapon: s.weapon ?? "fire",
              })),
            incomingMisses: oppShots
              .filter((s) => !s.hit)
              .map((s) => ({
                row: s.row,
                col: s.col,
                weapon: s.weapon === "fire" ? "cannon" : (s.weapon ?? "cannon"),
              })),
          }
        : null,
      opponent: opponentView,
      stats: {
        turnNumber: state.turnState.turnNumber,
        yourShipsRemaining: myShipsAlive,
        opponentShipsRemaining: oppShipsAlive,
        yourShotsFired: myBoard?.shotsFired ?? 0,
        yourHits: myBoard?.hitsScored ?? 0,
        opponentShotsFired: oppBoard?.shotsFired ?? 0,
        yourScore: scoreShotsForPlayer(state.shots, playerId),
        opponentScore: opponentId ? scoreShotsForPlayer(state.shots, opponentId) : 0,
        totalShipCells: BATTLESHIP_FLEET.reduce((n, s) => n + s.length, 0),
        munitionPoints,
        weaponCosts: { ...BATTLESHIP_WEAPON_COSTS },
        cannonReward: BATTLESHIP_CANNON_POINT_REWARD,
        turnReward: BATTLESHIP_TURN_POINT_REWARD,
        damageReward: BATTLESHIP_DAMAGE_POINT_REWARD,
      },
      shotLog: projectShotWindow(state.shots),
      spectators: state.spectators ?? [],
    };
  }

  /** Reveal both placed fleets while preserving only attacks that actually occurred. */
  protected buildRewatchView() {
    if (!this.gameState) return null;
    const perspectiveId = this.gameState.hostId;
    const view = this.projectStateFor(perspectiveId, this.gameState);

    const opponentBoard = this.gameState.boards.find((board) => board.playerId !== perspectiveId);

    const opponent = "opponent" in view ? view.opponent : null;

    const revealedShips =
      opponentBoard?.ships.map((ship) => ({
        ...ship,
        name: shipName(ship.id),
        length: shipLength(ship.id),
        "shape": shipSpec(ship.id).shape,
        cells: cellsForShipSilhouette(ship.row, ship.col, shipSpec(ship.id).shape, ship.rotation),
      })) ?? [];

    return {
      ...view,
      replayPerspectivePlayerId: perspectiveId,
      opponent: opponent
        ? {
            ...opponent,
            revealedShips,
            revealedMines: opponentBoard?.mines ?? [],
            fleetStatus: BATTLESHIP_FLEET.map((spec) => {
              const ship = opponentBoard?.ships.find((item) => item.id === spec.id);

              return {
                id: spec.id,
                name: spec.name,
                shortName: spec.shortName,
                length: spec.length,
                "shape": spec.shape,
                hits: ship?.hits ?? 0,
                sunk: ship?.sunk ?? false,
                placed: Boolean(ship),
                row: ship?.row,
                col: ship?.col,
                rotation: ship?.rotation,
              };
            }),
          }
        : null,
    };
  }

  /**
   * Public dual-board view for watch-only connections.
   * Both fleets stay hidden; only hit/miss pegs, sunk ships, and shot log are shown.
   */
  private projectSpectatorState(state: BattleshipGameState) {
    for (const b of state.boards) this.normalizeBoard(b);

    const publicBoard = (board: (typeof state.boards)[0] | undefined) => {
      if (!board) return null;

      const againstShots = state.shots.filter((s) => s.byPlayerId !== board.playerId);

      const shipsAlive = board.ships.filter((s) => !s.sunk).length;

      return {
        playerId: board.playerId,
        ready: board.ready,
        hits: againstShots
          .filter((s) => s.hit)
          .map((s) => ({
            row: s.row,
            col: s.col,
            sunkShipId: s.sunkShipId,
            weapon: s.weapon ?? "fire",
          })),
        misses: againstShots
          .filter((s) => !s.hit)
          .map((s) => ({
            row: s.row,
            col: s.col,
            weapon: s.weapon ?? "fire",
          })),
        shipsRemaining: shipsAlive,
        radarScans: board.receivedRadarScans ?? [],
        bombedAreas: board.bombedAreas ?? [],
        triggeredMines: board.triggeredMines ?? [],
        torpedoPaths: board.torpedoPaths ?? [],
        mineShots: board.mineShots ?? board.mineHits ?? [],
        mineHits: board.mineHits ?? [],
        fleetStatus: BATTLESHIP_FLEET.map((spec) => {
          const ship = board.ships.find((s) => s.id === spec.id);

          return {
            id: spec.id,
            name: spec.name,
            shortName: spec.shortName,
            length: spec.length,
            "shape": spec.shape,
            sunk: ship?.sunk ?? false,
            hits: ship?.sunk ? spec.length : undefined,
          };
        }),
        sunkShips: board.ships
          .filter((s) => s.sunk)
          .map((s) => ({
            id: s.id,
            name: shipName(s.id),
            length: shipLength(s.id),
            row: s.row,
            col: s.col,
            rotation: s.rotation,
            orientation: s.orientation,
            "shape": shipSpec(s.id).shape,
          })),
        shotsFired: board.shotsFired,
        hitsScored: board.hitsScored,
        munitionPoints: board.munitionPoints,
      };
    };

    const boards = state.boards.map((b) => publicBoard(b));

    return {
      id: state.id,
      roomCode: state.roomCode,
      type: state.type,
      status: state.status,
      players: state.players,
      spectators: state.spectators ?? [],
      hostId: state.hostId,
      maxPlayers: state.maxPlayers,
      timerConfig: state.timerConfig,
      gameTimeRemaining: state.gameTimeRemaining,
      turnState: state.turnState,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      expiresAt: state.expiresAt,
      boardSize: state.boardSize,
      winner: state.winner,
      lastAnnouncement: state.lastAnnouncement,
      fleet: BATTLESHIP_FLEET.map((s) => ({
        id: s.id,
        length: s.length,
        name: s.name,
        shortName: s.shortName,
        "shape": s.shape,
      })),
      munitionEconomy: {
        startingPoints: BATTLESHIP_STARTING_MUNITION_POINTS,
        cannonReward: BATTLESHIP_CANNON_POINT_REWARD,
        turnReward: BATTLESHIP_TURN_POINT_REWARD,
        damageReward: BATTLESHIP_DAMAGE_POINT_REWARD,
        costs: { ...BATTLESHIP_WEAPON_COSTS },
        note: "Spectator view — fleets hidden; hit/miss pegs and sunk ships only.",
      },
      weaponsCatalog: BATTLESHIP_WEAPONS_CATALOG,
      /** Both boards as public attack views (no own-ship cells). */
      spectatorBoards: boards,
      yourBoard: null,
      opponent: boards[1] ?? boards[0] ?? null,
      stats: {
        turnNumber: state.turnState.turnNumber,
        spectator: true,
        scores: Object.fromEntries(
          state.players.map((player) => [player.id, scoreShotsForPlayer(state.shots, player.id)]),
        ),
        totalShipCells: BATTLESHIP_FLEET.reduce((n, s) => n + s.length, 0),
        weaponCosts: { ...BATTLESHIP_WEAPON_COSTS },
        cannonReward: BATTLESHIP_CANNON_POINT_REWARD,
        turnReward: BATTLESHIP_TURN_POINT_REWARD,
        damageReward: BATTLESHIP_DAMAGE_POINT_REWARD,
      },
      shotLog: projectShotWindow(state.shots),
    };
  }

  protected isYourTurn(playerId: string): boolean {
    if (!this.gameState || this.gameState.status !== "playing") return false;
    const board = this.gameState.boards.find((b) => b.playerId === playerId);

    if (!board) return false;

    if (this.gameState.turnState.phase === "placement") {
      return !board.ready;
    }

    if (this.gameState.turnState.phase === "battle") {
      return this.gameState.turnState.currentPlayerId === playerId;
    }

    return false;
  }

  /** Migrate boards saved before munition-points / polyomino rotations. */
  private normalizeBoard(board: BattleshipPlayerBoard): void {
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

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    if (this.isSpectator(playerId)) return actions;

    if (this.gameState.status !== "playing") return actions;

    const board = this.gameState.boards.find((b) => b.playerId === playerId);

    if (!board) return actions;
    this.normalizeBoard(board);

    if (this.gameState.turnState.phase === "placement" && !board.ready) {
      actions.push("place_fleet", "place_ships");
    }

    if (
      this.gameState.turnState.phase === "battle" &&
      this.gameState.turnState.currentPlayerId === playerId
    ) {
      actions.push("cannon", "fire", "shoot");
      const pts = board.munitionPoints ?? 0;

      if (pts >= BATTLESHIP_WEAPON_COSTS.mine) actions.push("mine");

      if (pts >= BATTLESHIP_WEAPON_COSTS.bomb) actions.push("bomb");

      if (pts >= BATTLESHIP_WEAPON_COSTS.radar) actions.push("radar");

      if (pts >= BATTLESHIP_WEAPON_COSTS.torpedo) actions.push("torpedo");
    }

    return actions;
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (base.isSpectator) {
      return {
        ...base,
        isYourTurn: false,
        ready: false,
        role: "spectator",
        legalActions: ["leave"],
      };
    }

    const board = this.gameState?.boards.find((b) => b.playerId === playerId);
    const phase = this.gameState?.turnState.phase;

    const isYourTurn =
      this.gameState?.status === "playing" &&
      ((phase === "placement" && board && !board.ready) ||
        (phase === "battle" && this.gameState.turnState.currentPlayerId === playerId));

    const munitionPoints = board?.munitionPoints ?? BATTLESHIP_STARTING_MUNITION_POINTS;

    return {
      ...base,
      isYourTurn,
      ready: board?.ready ?? false,
      role: "captain",
      munitionPoints,
      weaponCosts: { ...BATTLESHIP_WEAPON_COSTS },
      weapons: maxUsesFromPoints(munitionPoints),
      legalActions: this.getLegalActions(playerId),
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    switch (payload.actionType) {
      case "place_fleet":
      case "place_ships":
        return this.handlePlace(player, payload.data);
      case "cannon":
      case "fire":
      case "shoot":
        return this.handleCannon(player, payload.data);
      case "mine":
        return this.handleMine(player, payload.data);
      case "radar":
        return this.handleRadar(player, payload.data);
      case "bomb":
        return this.handleBomb(player, payload.data);
      case "torpedo":
        return this.handleTorpedo(player, payload.data);
      default:
        return `Unknown action: ${payload.actionType}`;
    }
  }

  private handlePlace(player: Player, data: WireValue): string | void {
    if (!this.gameState || this.gameState.status !== "playing") {
      return "Game is not playing";
    }

    if (this.gameState.turnState.phase !== "placement") {
      return "Not placement phase";
    }

    const board = this.gameState.boards.find((b) => b.playerId === player.id);

    if (!board) return "No board";

    if (board.ready) return "Fleet already placed";

    const placements = parseFleetPayload(data);

    if (!placements) return "ships must be a valid fleet placement array";

    const result = validateFleet(placements);

    if (!result.ok) return result.error;

    board.ships = result.ships;
    board.cells = result.cells;
    board.ready = true;
    board.munitionPoints = BATTLESHIP_STARTING_MUNITION_POINTS;
    board.weapons = maxUsesFromPoints(board.munitionPoints);

    this.gameState.lastAnnouncement = `${player.name} locked fleet.`;
    this.recordEvent("place_fleet", {
      playerId: player.id,
      ready: true,
    });

    if (this.gameState.boards.every((b) => b.ready)) {
      this.beginBattle();
    } else {
      this.gameState.lastAnnouncement = `${player.name} ready — waiting for opponent fleet.`;
    }
  }

  private awardTurnPoints(playerId: string): void {
    const board = this.gameState?.boards.find((b) => b.playerId === playerId);

    if (!board) return;
    board.munitionPoints = (board.munitionPoints ?? 0) + BATTLESHIP_TURN_POINT_REWARD;
    board.weapons = maxUsesFromPoints(board.munitionPoints);
  }

  private handleMine(player: Player, data: WireValue): string | void {
    const gate = this.assertBattleTurn(player);

    if (!gate.ok) return gate.error;
    const cell = parseCell(data);

    if (isString(cell)) return cell;

    if (
      gate.board.cells[cell.row]![cell.col] !== null ||
      this.alreadyShot(gate.opp.playerId, cell.row, cell.col)
    )
      return "Place mines on empty, unattacked water on your own board";

    if (gate.board.mines?.some((m) => m.row === cell.row && m.col === cell.col))
      return "There is already a mine here";
    const error = this.spendMunitions(gate.board, "mine");

    if (error) return error;
    (gate.board.mines ??= []).push(cell);
    // Do not include hidden mine coordinates in public events or announcements.
    this.finishAbility(
      player,
      gate.opp,
      [],
      `${player.name} placed a mine. Cannon still available.`,
    );
  }

  private beginBattle(prefix?: string): void {
    if (!this.gameState) return;

    const first = this.gameState.players[this.startingPlayerIndex()]!;

    this.gameState.turnState.phase = "battle";
    this.gameState.turnState.currentPlayerId = first.id;
    this.awardTurnPoints(first.id);
    this.gameState.turnState.turnNumber = 1;
    this.gameState.turnState.turnTimeRemaining = this.gameState.timerConfig.turnTime;
    this.gameState.turnState.startedAt = Date.now();
    this.gameState.lastAnnouncement = `${prefix ? `${prefix} ` : ""}Battle stations! ${first.name} fires first.`;
    this.recordEvent("battle_start", {
      firstPlayerId: first.id,
    });
  }

  private assertBattleTurn(
    player: Player,
  ):
    | { ok: true; board: BattleshipPlayerBoard; opp: BattleshipPlayerBoard }
    | { ok: false; error: string } {
    if (!this.gameState || this.gameState.status !== "playing") {
      return { ok: false, error: "Game is not playing" };
    }

    if (this.gameState.turnState.phase !== "battle") {
      return { ok: false, error: "Not battle phase" };
    }

    if (this.gameState.turnState.currentPlayerId !== player.id) {
      return { ok: false, error: "Not your turn" };
    }

    const board = this.gameState.boards.find((b) => b.playerId === player.id);
    const opp = this.gameState.boards.find((b) => b.playerId !== player.id);

    if (!board || !opp) return { ok: false, error: "No board" };

    return { ok: true, board, opp };
  }

  private alreadyShot(byPlayerId: string, row: number, col: number): boolean {
    return (
      this.gameState?.shots.some(
        (s) => s.byPlayerId === byPlayerId && s.row === row && s.col === col,
      ) ?? false
    );
  }

  /** Apply damage to a cell; returns shot record or null if already fired. */
  private applyAttack(
    attacker: BattleshipPlayerBoard,
    opp: BattleshipPlayerBoard,
    row: number,
    col: number,
    weapon: ShotWeapon,
    salvoId?: string,
  ): BattleShot | null {
    if (!this.gameState) return null;

    if (this.alreadyShot(attacker.playerId, row, col)) return null;

    const shipId = opp.cells[row]![col];
    const hit = shipId !== null;
    let sunkShipId: ShipId | undefined;

    if (hit && shipId) {
      const ship = opp.ships.find((s) => s.id === shipId)!;

      if (!ship.sunk) {
        const hitCells = new Set(
          this.gameState.shots
            .filter((shot) => shot.byPlayerId === attacker.playerId && shot.hit)
            .map((shot) => `${shot.row}:${shot.col}`),
        );

        hitCells.add(`${row}:${col}`);

        const occupiedCells = opp.cells.flatMap((line, r) =>
          line.flatMap((id, c) => (id === shipId ? [`${r}:${c}`] : [])),
        );

        ship.hits = occupiedCells.filter((cell) => hitCells.has(cell)).length;

        if (occupiedCells.length > 0 && occupiedCells.every((cell) => hitCells.has(cell))) {
          ship.sunk = true;
          sunkShipId = shipId;
        }
      }
    }

    attacker.shotsFired++;

    if (weapon === "mine") (opp.mineShots ??= []).push({ row, col });

    if (hit) {
      if (weapon === "mine") (opp.mineHits ??= []).push({ row, col });
      attacker.hitsScored++;
      opp.munitionPoints += BATTLESHIP_DAMAGE_POINT_REWARD;
      opp.weapons = maxUsesFromPoints(opp.munitionPoints);
    }

    const shot: BattleShot = {
      row,
      col,
      hit,
      sunkShipId,
      byPlayerId: attacker.playerId,
      weapon,
      salvoId,
    };

    this.gameState.shots.push(shot);

    const mineIndex = opp.mines?.findIndex((m) => m.row === row && m.col === col) ?? -1;

    if (mineIndex >= 0) {
      opp.mines!.splice(mineIndex, 1);
      (opp.triggeredMines ??= []).push({ row, col });
      const retaliation: BattleShot[] = [];

      for (let i = 0; i < 3; i++) {
        const targets = Array.from({ length: SIZE * SIZE }, (_, index) => ({
          row: Math.floor(index / SIZE),
          col: index % SIZE,
        })).filter((cell) => !this.alreadyShot(opp.playerId, cell.row, cell.col));

        if (!targets.length) break;
        const target = targets[randomInt(targets.length)]!;

        const returned = this.applyAttack(opp, attacker, target.row, target.col, "mine");

        if (returned) retaliation.push(returned);
      }

      this.recordEvent("mine_triggered", {
        playerId: opp.playerId,
        row,
        col,
        shots: retaliation,
      });
    }

    return shot;
  }

  /**
   * Finish an attack action.
   * - `keepTurn: true` → same player continues (cannon hit streak)
   * - `keepTurn: false` → pass to opponent after a cannon miss
   * - Abilities keep the turn without refreshing its timer
   */
  private finishAttackTurn(
    player: Player,
    opp: BattleshipPlayerBoard,
    shots: BattleShot[],
    announcement: string,
    keepTurn = false,
    refreshTimer = true,
  ): void {
    if (!this.gameState) return;

    const firstShotIndex = shots.length ? this.gameState.shots.indexOf(shots[0]!) : -1;

    const returnedShots =
      firstShotIndex >= 0
        ? this.gameState.shots.slice(firstShotIndex).filter((s) => s.weapon === "mine")
        : [];

    if (returnedShots.length)
      announcement += ` Mines triggered: ${returnedShots.length} return shots, ${returnedShots.filter((s) => s.hit).length} hits.`;
    this.gameState.lastAnnouncement = announcement;
    this.recordEvent("attack", {
      playerId: player.id,
      shots: shots.map((s) => ({
        row: s.row,
        col: s.col,
        hit: s.hit,
        sunkShipId: s.sunkShipId,
        weapon: s.weapon,
      })),
      announcement,
      keepTurn,
    });

    const own = this.gameState.boards.find((b) => b.playerId === player.id)!;

    const ownSunk = own.ships.every((s) => s.sunk),
      opponentSunk = opp.ships.every((s) => s.sunk);

    if (ownSunk || opponentSunk) {
      const winner = ownSunk && opponentSunk ? null : ownSunk ? opp.playerId : player.id;

      this.gameState.winner = winner;
      this.gameState.status = "ended";
      this.gameState.turnState.phase = "ended";
      this.gameState.lastAnnouncement = winner
        ? `${this.gameState.players.find((p) => p.id === winner)?.name} wins. Enemy fleet sunk!`
        : "Both fleets sunk. Draw.";
      this.stopTimers();
      this.recordEvent("game_ended", {
        reason: "fleet_sunk",
        winner: this.gameState.winner,
      });
      void this.saveState().then(() => {
        this.broadcastProjected("game_ended", { reason: "fleet_sunk" });
      });

      return;
    }

    if (keepTurn) {
      if (!refreshTimer) return;
      // Cannon hit streak: refresh turn timer, stay on this player
      this.gameState.turnState.turnTimeRemaining = this.gameState.timerConfig.turnTime;
      this.gameState.turnState.startedAt = Date.now();
      this.recordEvent("extra_shot", {
        currentPlayerId: player.id,
        phase: "battle",
        turnNumber: this.gameState.turnState.turnNumber,
        reason: "cannon_hit",
      });

      return;
    }

    this.gameState.turnState.currentPlayerId = opp.playerId;
    this.awardTurnPoints(opp.playerId);
    this.gameState.turnState.turnNumber++;
    this.gameState.turnState.turnTimeRemaining = this.gameState.timerConfig.turnTime;
    this.gameState.turnState.startedAt = Date.now();
    this.recordEvent("turn_changed", {
      currentPlayerId: opp.playerId,
      phase: "battle",
      turnNumber: this.gameState.turnState.turnNumber,
    });
  }

  /**
   * Free 1-cell shot. Points are awarded only at turn start.
   * Hit → keep firing; miss → turn ends.
   */
  private handleCannon(player: Player, data: WireValue): string | void {
    const gate = this.assertBattleTurn(player);

    if (!gate.ok) return gate.error;

    const cell = parseCell(data);

    if (isString(cell)) return cell;

    if (this.alreadyShot(player.id, cell.row, cell.col)) {
      return "Already fired at that cell";
    }

    const shot = this.applyAttack(gate.board, gate.opp, cell.row, cell.col, "cannon");

    if (!shot) return "Already fired at that cell";

    const reward = BATTLESHIP_CANNON_POINT_REWARD;
    gate.board.munitionPoints = (gate.board.munitionPoints ?? 0) + reward;
    gate.board.weapons = maxUsesFromPoints(gate.board.munitionPoints);
    const pts = gate.board.munitionPoints;

    let announcement: string;

    if (shot.sunkShipId) {
      announcement = `Shot: you sunk their ${shipName(shot.sunkShipId)}! (${pts} pts) — fire again!`;
    } else if (shot.hit) {
      announcement = `Hit! (${pts} pts) — fire again!`;
    } else {
      announcement = `Miss. (${pts} pts) Turn over.`;
    }

    this.recordEvent("cannon", {
      playerId: player.id,
      row: cell.row,
      col: cell.col,
      hit: shot.hit,
      sunkShipId: shot.sunkShipId,
      reward,
      munitionPoints: pts,
      keepTurn: shot.hit,
    });

    this.finishAttackTurn(player, gate.opp, [shot], announcement, shot.hit);
  }

  private finishAbility(
    player: Player,
    opponent: BattleshipPlayerBoard,
    shots: BattleShot[],
    announcement: string,
  ): void {
    const state = this.gameState;
    const board = state?.boards.find((board) => board.playerId === player.id);

    if (!state || !board) return;
    this.finishAttackTurn(player, opponent, shots, announcement, true, false);
  }

  private spendMunitions(board: BattleshipPlayerBoard, weapon: WeaponId): string | void {
    const cost = BATTLESHIP_WEAPON_COSTS[weapon];
    const pts = board.munitionPoints ?? 0;

    if (pts < cost) {
      return `Need ${cost} munition pt(s) for ${weapon} (you have ${pts})`;
    }

    board.munitionPoints = pts - cost;
    board.weapons = maxUsesFromPoints(board.munitionPoints);
  }

  private refundMunitions(board: BattleshipPlayerBoard, weapon: WeaponId): void {
    board.munitionPoints = (board.munitionPoints ?? 0) + BATTLESHIP_WEAPON_COSTS[weapon];
    board.weapons = maxUsesFromPoints(board.munitionPoints);
  }

  /**
   * Radar: 3×3 info-only scan. Does not hit or place pegs.
   * Reports how many ship cells are in the zone. Cost: 3 pts.
   */
  private handleRadar(player: Player, data: WireValue): string | void {
    const gate = this.assertBattleTurn(player);

    if (!gate.ok) return gate.error;
    const err = this.spendMunitions(gate.board, "radar");

    if (err) return err;

    const cell = parseCell(data);

    if (isString(cell)) {
      this.refundMunitions(gate.board, "radar");

      return cell;
    }

    let shipCells = 0;
    let cellsScanned = 0;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const row = cell.row + dr;
        const col = cell.col + dc;

        if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) continue;
        cellsScanned++;

        if (gate.opp.cells[row]![col] !== null) shipCells++;
      }
    }

    const remaining = gate.board.munitionPoints;
    const cost = BATTLESHIP_WEAPON_COSTS.radar;

    const announcement =
      shipCells > 0
        ? `Radar contact: ${shipCells} ship cell(s) in the 3×3. (−${cost} pt · ${remaining} left)`
        : `Radar clear — no ships in the 3×3. (−${cost} pt · ${remaining} left)`;

    const scan = {
      row: cell.row,
      col: cell.col,
      shipCells,
      cellsScanned,
    };

    (gate.board.radarScans ??= []).push(scan);
    (gate.opp.receivedRadarScans ??= []).push(scan);

    this.recordEvent("radar", {
      playerId: player.id,
      row: cell.row,
      col: cell.col,
      shipCells,
      cellsScanned,
      contact: shipCells > 0,
      cost,
      munitionPoints: remaining,
    });

    // Info-only: no shot pegs; the normal shot remains available.
    this.finishAbility(player, gate.opp, [], announcement);
  }

  /** Bomb: attack 2×2 with click cell as top-left. Cost: 5 pts. */
  private handleBomb(player: Player, data: WireValue): string | void {
    const gate = this.assertBattleTurn(player);

    if (!gate.ok) return gate.error;
    const err = this.spendMunitions(gate.board, "bomb");

    if (err) return err;

    const cell = parseCell(data);

    if (isString(cell)) {
      this.refundMunitions(gate.board, "bomb");

      return cell;
    }

    // 2×2 with (row,col) as top-left
    if (cell.row > SIZE - 2 || cell.col > SIZE - 2) {
      this.refundMunitions(gate.board, "bomb");

      return "Bomb needs a 2×2 zone; row and col must each be 0–8";
    }

    const salvoId = randomId();
    const triggeredMinesBefore = gate.opp.triggeredMines?.length ?? 0;
    const shots: BattleShot[] = [];
    const sunk: ShipId[] = [];
    let hits = 0;
    let misses = 0;

    for (let dr = 0; dr <= 1; dr++) {
      for (let dc = 0; dc <= 1; dc++) {
        const row = cell.row + dr;
        const col = cell.col + dc;

        const shot = this.applyAttack(gate.board, gate.opp, row, col, "bomb", salvoId);

        if (!shot) continue;
        shots.push(shot);

        if (shot.hit) hits++;
        else misses++;

        if (shot.sunkShipId) sunk.push(shot.sunkShipId);
      }
    }

    if (shots.length === 0) {
      this.refundMunitions(gate.board, "bomb");

      return "All cells in that 2×2 already attacked";
    }

    const remaining = gate.board.munitionPoints;

    const minesTriggered = (gate.opp.triggeredMines?.length ?? 0) - triggeredMinesBefore;

    (gate.opp.bombedAreas ??= []).push({ row: cell.row, col: cell.col });
    const cost = BATTLESHIP_WEAPON_COSTS.bomb;
    let announcement = `Bomb (−${cost} pt): ${hits} hit(s), ${misses} miss(es). ${remaining} pts left.`;

    if (sunk.length) {
      announcement += ` Sunk: ${sunk.map(shipName).join(", ")}!`;
    }

    if (minesTriggered > 0) announcement += " Mine triggered. Turn over.";

    this.recordEvent("bomb", {
      playerId: player.id,
      row: cell.row,
      col: cell.col,
      hits,
      misses,
      sunk,
      minesTriggered,
      cost,
      munitionPoints: remaining,
    });

    if (minesTriggered > 0) this.finishAttackTurn(player, gate.opp, shots, announcement);
    else this.finishAbility(player, gate.opp, shots, announcement);
  }

  /**
   * Torpedo: launch from a board edge; travels inward along the row/column
   * until the first ship is hit, then stops. Cost: 7 pts.
   */
  private handleTorpedo(player: Player, data: WireValue): string | void {
    const gate = this.assertBattleTurn(player);

    if (!gate.ok) return gate.error;
    const err = this.spendMunitions(gate.board, "torpedo");

    if (err) return err;

    const cell = parseCell(data);

    if (isString(cell)) {
      this.refundMunitions(gate.board, "torpedo");

      return cell;
    }

    const requestedDirection = isWireObject(data) ? (data.direction ?? data.dir) : undefined;

    const resolved = resolveTorpedoDirection(
      cell.row,
      cell.col,
      isString(requestedDirection) ? requestedDirection : null,
      SIZE,
    );

    if ("error" in resolved) {
      this.refundMunitions(gate.board, "torpedo");

      return resolved.error;
    }

    const direction = resolved.direction;
    const delta = TORPEDO_DELTAS[direction];

    const salvoId = randomId();
    const shots: BattleShot[] = [];
    const sunk: ShipId[] = [];
    let hits = 0;
    let misses = 0;

    let endRow = cell.row,
      endCol = cell.col;

    // Travel the full line until first ship hit (or board edge)
    for (let i = 0; i < SIZE; i++) {
      const row = cell.row + delta.dr * i;
      const col = cell.col + delta.dc * i;

      if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) break;
      endRow = row;
      endCol = col;

      const occupied = gate.opp.cells[row]![col] !== null;

      if (this.alreadyShot(player.id, row, col)) {
        // Past water already marked; stop if this was already a hit on a ship
        if (occupied) {
          const prior = this.gameState!.shots.find(
            (s) => s.byPlayerId === player.id && s.row === row && s.col === col && s.hit,
          );

          if (prior) break;
        }

        continue;
      }

      const shot = this.applyAttack(gate.board, gate.opp, row, col, "torpedo", salvoId);

      if (!shot) continue;
      shots.push(shot);

      if (shot.hit) {
        hits++;

        if (shot.sunkShipId) sunk.push(shot.sunkShipId);
        break; // stop on first ship hit
      }

      misses++;
    }

    if (shots.length === 0) {
      this.refundMunitions(gate.board, "torpedo");

      return "Torpedo path already fully attacked or out of bounds";
    }

    const remaining = gate.board.munitionPoints;
    (gate.opp.torpedoPaths ??= []).push({ ...cell, endRow, endCol, direction });
    const cost = BATTLESHIP_WEAPON_COSTS.torpedo;
    let announcement = `Torpedo (−${cost} pt): ${hits} hit(s), ${misses} miss(es). ${remaining} pts left.`;

    if (sunk.length) {
      announcement += ` Sunk: ${sunk.map(shipName).join(", ")}!`;
    }

    this.recordEvent("torpedo", {
      playerId: player.id,
      row: cell.row,
      col: cell.col,
      direction,
      hits,
      misses,
      sunk,
      cost,
      munitionPoints: remaining,
    });

    this.finishAbility(player, gate.opp, shots, announcement);
  }
}
