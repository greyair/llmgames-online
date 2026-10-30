import {
  BATTLESHIP_CANNON_POINT_REWARD,
  BATTLESHIP_DAMAGE_POINT_REWARD,
  BATTLESHIP_FLEET,
  BATTLESHIP_STARTING_MUNITION_POINTS,
  BATTLESHIP_TURN_POINT_REWARD,
  BATTLESHIP_WEAPON_COSTS,
  BATTLESHIP_WEAPONS_CATALOG,
  cellsForShipSilhouette,
} from "../../durable-objects/types";
import type { BattleshipGameState, BattleshipPlayerBoard } from "../../durable-objects/types";
import {
  BATTLESHIP_SIZE,
  maxUsesFromPoints,
  normalizeBoard,
  projectShotWindow,
  scoreShotsForPlayer,
  shipLength,
  shipName,
  shipSpec,
} from "./rules";

/**
 * Battleship fog of war (M3.5).
 *
 * Three audiences, one set of rules: a captain sees their own fleet and only the
 * pegs they fired, a watcher sees both fleets hidden, and a replay reveals the
 * opponent's fleet once the match is over. The migration moved these functions
 * verbatim so the frozen transcript could prove nothing leaked.
 */

/** Per-player view: own fleet fully visible, opponent ships hidden behind pegs. */
export function projectState(state: BattleshipGameState, playerId: string) {
  const seated = state.players.some((p) => p.id === playerId);

  if (!seated) return projectSpectatorState(state);

  const myBoard = state.boards.find((b) => b.playerId === playerId);
  const oppBoard = state.boards.find((b) => b.playerId !== playerId);
  const opponentId = oppBoard?.playerId;

  if (myBoard) normalizeBoard(myBoard);

  if (oppBoard) normalizeBoard(oppBoard);

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
            // Only damage known from pegs is public: sunk is visible, partial
            // hit counts are not, because that would reveal ship placement.
            sunk: ship?.sunk ?? false,
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

/**
 * Replay document: the host's perspective with the opponent's fleet revealed.
 *
 * Fog existed during play only; the archive has to show what happened, while
 * still using the same public shapes so old readers keep working.
 */
export function rewatchView(state: BattleshipGameState) {
  const perspectiveId = state.hostId;
  const view = projectState(state, perspectiveId);
  const opponentBoard = state.boards.find((board) => board.playerId !== perspectiveId);
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
export function projectSpectatorState(state: BattleshipGameState) {
  for (const b of state.boards) normalizeBoard(b);

  const publicBoard = (board: BattleshipPlayerBoard | undefined) => {
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

/** Board size the projections advertise; kept next to them for readability. */
export const PROJECTED_BOARD_SIZE = BATTLESHIP_SIZE;
