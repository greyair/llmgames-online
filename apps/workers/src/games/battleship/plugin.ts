import { battleshipAgentState, ROOM_LIFETIME_MS, type WireObject } from "@llmgames/game-catalog";

import {
  BATTLESHIP_STARTING_MUNITION_POINTS,
  BATTLESHIP_WEAPON_COSTS,
} from "../../durable-objects/types";
import type { BattleshipGameState, GameRoomConfig } from "../../durable-objects/types";
import { randomId } from "../../lib/csprng";
import type {
  GameActionResult,
  GameEffect,
  GameIntent,
  GamePlugin,
  GameSeatIdentity,
  GameViewerContext,
} from "../contract";
import { applyAction, onTurnTimeout } from "./actions";
import { projectState, rewatchView } from "./projection";
import { BATTLESHIP_SIZE, maxUsesFromPoints, normalizeBoard } from "./rules";

/**
 * Battleship as a game plugin (M3.5).
 *
 * The first migrated game with hidden information and simultaneous decisions:
 * both captains place at once (`mayActNow`), each sees only their own fleet
 * (`projectState`), and the MCP decision state is a pair of ASCII grids
 * (`agentFields`). Rotation happens during a normal action rather than at start,
 * which is why the first player is drawn when the battle begins.
 */

/** Placement gets a fixed five minutes; the battle uses the room's turn time. */
export const BATTLESHIP_PLACEMENT_TIME_MS = 5 * 60 * 1000;

const DEFAULT_MATCH_MS = 30 * 60 * 1000;

const DEFAULT_TURN_MS = 90 * 1000;

export const battleshipPlugin: GamePlugin<BattleshipGameState, "battleship"> = {
  id: "battleship",
  minPlayersToStart: 2,
  initialTurnPhase: "placement",

  createInitialState(config: GameRoomConfig, roomCode: string, now: number) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = config.turnTime ?? DEFAULT_TURN_MS;

    return {
      id: randomId(),
      roomCode,
      type: "battleship",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: 2,
      timerConfig: { gameTotalTime, turnTime },
      gameTimeRemaining: gameTotalTime,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: turnTime,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ROOM_LIFETIME_MS,
      boards: [],
      shots: [],
      winner: null,
      boardSize: BATTLESHIP_SIZE,
      lastAnnouncement: null,
    };
  },

  start(state, context) {
    const munitionPoints = BATTLESHIP_STARTING_MUNITION_POINTS;

    state.boards = state.players.map((player) => ({
      playerId: player.id,
      mines: [],
      mineShots: [],
      radarScans: [],
      ships: [],
      cells: Array.from({ length: BATTLESHIP_SIZE }, () =>
        Array.from({ length: BATTLESHIP_SIZE }, () => null),
      ),
      ready: false,
      munitionPoints,
      weapons: maxUsesFromPoints(munitionPoints),
      shotsFired: 0,
      hitsScored: 0,
    }));
    state.shots = [];
    state.winner = null;
    state.lastAnnouncement = "Place your fleet — ships cannot overlap.";
    state.turnState.phase = "placement";
    state.turnState.currentPlayerId = null;
    state.turnState.turnNumber = 0;
    state.turnState.turnTimeRemaining = BATTLESHIP_PLACEMENT_TIME_MS;
    state.turnState.startedAt = context.now;
  },

  /** Both captains may place at once, so the platform must not gate on turn order. */
  mayActNow(state, playerId) {
    if (state.status !== "playing") return false;

    const board = state.boards.find((b) => b.playerId === playerId);

    if (!board) return false;

    if (state.turnState.phase === "placement") return !board.ready;

    if (state.turnState.phase === "battle")
      return state.turnState.currentPlayerId === playerId;

    return false;
  },

  turnActions(state, playerId, viewer: GameViewerContext) {
    if (viewer.isSpectator) return [];

    if (state.status !== "playing") return [];

    const board = state.boards.find((b) => b.playerId === playerId);

    if (!board) return [];

    normalizeBoard(board);

    const actions: string[] = [];

    if (state.turnState.phase === "placement" && !board.ready) {
      actions.push("place_fleet", "place_ships");
    }

    if (
      state.turnState.phase === "battle" &&
      state.turnState.currentPlayerId === playerId
    ) {
      actions.push("cannon", "fire", "shoot");

      const pts = board.munitionPoints ?? 0;

      if (pts >= BATTLESHIP_WEAPON_COSTS.mine) actions.push("mine");

      if (pts >= BATTLESHIP_WEAPON_COSTS.bomb) actions.push("bomb");

      if (pts >= BATTLESHIP_WEAPON_COSTS.radar) actions.push("radar");

      if (pts >= BATTLESHIP_WEAPON_COSTS.torpedo) actions.push("torpedo");
    }

    return actions;
  },

  /**
   * Battleship exposes no numeric seat: the client reads `role` and the munition
   * wallet instead, so this returns only the role and leaves `seat` absent.
   */
  seatIdentity(_state, _playerId, viewer: GameViewerContext): GameSeatIdentity {
    return viewer.isSpectator ? { role: "spectator" } : { role: "captain" };
  },

  /** Munition wallet shown in `you`; spectators get none, matching the old room. */
  youFields(state, playerId, viewer: GameViewerContext): WireObject {
    if (viewer.isSpectator) return {};

    const board = state.boards.find((b) => b.playerId === playerId);

    if (!board) return {};

    const munitionPoints = board.munitionPoints ?? BATTLESHIP_STARTING_MUNITION_POINTS;

    return {
      ready: board.ready,
      munitionPoints,
      weaponCosts: { ...BATTLESHIP_WEAPON_COSTS },
      weapons: maxUsesFromPoints(munitionPoints),
    };
  },

  applyAction(state, playerId, intent: GameIntent, now: number): GameActionResult {
    return applyAction(state, playerId, intent, now);
  },

  onTurnTimeout(state, _playerId, now: number): readonly GameEffect[] {
    return onTurnTimeout(state, now);
  },

  projectState(state, playerId) {
    return projectState(state, playerId);
  },

  rewatchView(state) {
    return rewatchView(state);
  },

  /** The MCP decision state is generated from the recipient's own projection. */
  agentFields(projection) {
    // SAFETY: battleshipAgentState builds a flat JSON record from this projection
    // and drops undefined entries, so every value is a WireValue.
    return battleshipAgentState(projection) as WireObject;
  },
};
