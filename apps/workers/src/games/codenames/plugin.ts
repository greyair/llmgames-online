import { ROOM_LIFETIME_MS, type WireObject } from "@llmgames/game-catalog";

import type { CodenamesGameState, GameRoomConfig } from "../../durable-objects/types";
import type { StartGameProblem } from "../../durable-objects/actionErrors";
import { randomId } from "../../lib/csprng";
import type {
  GameActionResult,
  GameEffect,
  GameIntent,
  GamePlugin,
  GameSeatIdentity,
  GameViewerContext,
} from "../contract";
import { applyAction, onMatchTimeout, onTurnTimeout, playActions } from "./actions";
import {
  BOARD_SIZE,
  DEFAULT_MATCH_MS,
  DEFAULT_TURN_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MIN_TURN_MS,
  canSeeKey,
  createCodenamesBoard,
  drawStartingTeam,
  projectCodenamesBoard,
  spymasterFor,
  validateCodenamesAssignments,
} from "./rules";

/**
 * Codenames as a game plugin (M3.6).
 *
 * The first role-based game: the key is visible to two seats and hidden from
 * everyone else, several players act on the same team decision, and the lobby
 * refuses to start an unbalanced table. Lobby seat changes (assign, promote,
 * reset, randomize) stay in the room adapter because they move players between
 * seats — platform work — while every play rule lives here.
 */

export const codenamesPlugin: GamePlugin<CodenamesGameState, "codenames"> = {
  id: "codenames",
  minPlayersToStart: MIN_PLAYERS,
  initialTurnPhase: "clue",

  createInitialState(config: GameRoomConfig, roomCode: string, now: number) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;
    const turnTime = Math.max(config.turnTime ?? DEFAULT_TURN_MS, MIN_TURN_MS);

    return {
      id: randomId(),
      roomCode,
      type: "codenames",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: Math.min(Math.max(config.maxPlayers ?? MAX_PLAYERS, MIN_PLAYERS), MAX_PLAYERS),
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
      board: [],
      assignments: { [config.hostId]: { team: "red", role: "spymaster" } },
      startingTeam: "red",
      activeTeam: "red",
      clue: null,
      guessesRemaining: 0,
      guessesMade: 0,
      remaining: { red: 0, blue: 0 },
      winner: null,
      winnerTeam: null,
      activityLog: [],
      lastReveal: null,
    };
  },

  start(state) {
    const startingTeam = drawStartingTeam();

    const assignments = Object.fromEntries(
      state.players.map((player) => [player.id, state.assignments[player.id]!]),
    );

    state.startingTeam = startingTeam;
    state.activeTeam = startingTeam;
    state.assignments = assignments;
    state.board = createCodenamesBoard(startingTeam);
    state.remaining = {
      red: startingTeam === "red" ? 9 : 8,
      blue: startingTeam === "blue" ? 9 : 8,
    };
    state.clue = null;
    state.guessesRemaining = 0;
    state.guessesMade = 0;
    state.winner = null;
    state.winnerTeam = null;
    state.activityLog = [];
    state.lastReveal = null;
    state.turnState.phase = "clue";
    state.turnState.currentPlayerId = spymasterFor(state, startingTeam)?.id ?? null;
    state.turnState.turnNumber = 1;
  },

  validateStart(state): StartGameProblem | null {
    return validateCodenamesAssignments(
      state.players.map((player) => player.id),
      state.assignments,
    );
  },

  /** A player who starts watching loses the team role that could reveal the key. */
  onMemberRoleChanged(state, playerId, role) {
    if (role === "spectator") delete state.assignments[playerId];
  },

  /** Clue and guess decisions belong to a role on the active team, not a seat. */
  mayActNow(state, playerId) {
    if (state.status !== "playing") return false;

    const assignment = state.assignments[playerId];

    if (!assignment || assignment.team !== state.activeTeam) return false;

    return state.turnState.phase === "clue"
      ? assignment.role === "spymaster"
      : state.turnState.phase === "guess" && assignment.role === "operative";
  },

  turnActions(state, playerId, viewer: GameViewerContext) {
    const actions: string[] = [];

    if (state.status === "waiting") {
      actions.push("assign_codenames_role");

      if (state.hostId === playerId) actions.push("reset_codenames_roles", "randomize_codenames_roles");
    }

    if (viewer.isSpectator) return actions;

    return [...actions, ...playActions(state, playerId)];
  },

  /** Codenames seats are teams, not numbers: the client reads `team` and `role`. */
  seatIdentity(state, playerId, viewer: GameViewerContext): GameSeatIdentity {
    return { role: viewer.isSpectator ? "spectator" : (state.assignments[playerId]?.role ?? null) };
  },

  /** Team and key visibility for the browser `you` block. */
  youFields(state, playerId): WireObject {
    return {
      team: state.assignments[playerId]?.team ?? null,
      canSeeKey: canSeeKey(state, playerId),
    };
  },

  applyAction(state, playerId, intent: GameIntent, now: number): GameActionResult {
    return applyAction(state, playerId, intent, now);
  },

  onTurnTimeout(state, playerId, now: number): readonly GameEffect[] {
    return onTurnTimeout(state, playerId, now);
  },

  onMatchTimeout(state, now: number): void {
    onMatchTimeout(state, now);
  },

  /** Only the two spymasters (and everyone after the match) may read the key. */
  projectState(state, playerId) {
    return {
      ...state,
      board: projectCodenamesBoard(state.board, canSeeKey(state, playerId)),
    };
  },

  /** Decision state mirrors the legacy MCP branch, generated from the projection. */
  agentFields(projection): WireObject {
    return {
      board: projection.board,
      assignments: projection.assignments,
      startingTeam: projection.startingTeam,
      activeTeam: projection.activeTeam,
      clue: projection.clue,
      guessesRemaining: projection.guessesRemaining,
      guessesMade: projection.guessesMade,
      remaining: projection.remaining,
      winnerTeam: projection.winnerTeam,
      lastReveal: projection.lastReveal,
    };
  },
};

/** Board size the lobby advertises; kept next to the plugin for readability. */
export const CODENAMES_BOARD_SIZE = BOARD_SIZE;
