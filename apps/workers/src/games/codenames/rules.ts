import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";

import { randomInt, shuffleInPlace } from "../../lib/csprng";
import { CODENAMES_WORDS } from "../../lib/codenamesWords";
import type { StartGameProblem } from "../../durable-objects/actionErrors";
import type {
  CodenamesAffiliation,
  CodenamesAssignment,
  CodenamesCard,
  CodenamesGameState,
  CodenamesLogEntry,
  CodenamesTeam,
} from "../../durable-objects/types";

/**
 * Codenames setup and key handling (M3.6).
 *
 * The board, the key and the role balance are pure functions of a shuffled deck,
 * so the whole game can be compared against a frozen transcript as long as the
 * CSPRNG is seeded. Lobby seat changes stay in the room adapter: promoting a
 * spectator is platform work, not a rule.
 */

export const BOARD_SIZE = 25;

export const MIN_PLAYERS = 4;

export const MAX_PLAYERS = 8;

export const DEFAULT_MATCH_MS = 30 * 60 * 1000;

export const DEFAULT_TURN_MS = 60 * 1000;

/** Turn time is never below thirty seconds, whatever the room asked for. */
export const MIN_TURN_MS = 30 * 1000;

/** The activity log is a readable window, not a full history. */
export const ACTIVITY_LOG_LIMIT = 80;

export interface CodenamesAssignments {
  [playerId: string]: CodenamesAssignment;
}

export function otherCodenamesTeam(team: CodenamesTeam): CodenamesTeam {
  return team === "red" ? "blue" : "red";
}

export function createCodenamesAffiliations(startingTeam: CodenamesTeam): CodenamesAffiliation[] {
  const otherTeam = otherCodenamesTeam(startingTeam);

  return shuffleInPlace([
    ...Array<CodenamesAffiliation>(9).fill(startingTeam),
    ...Array<CodenamesAffiliation>(8).fill(otherTeam),
    ...Array<CodenamesAffiliation>(7).fill("neutral"),
    "assassin",
  ]);
}

export function createCodenamesBoard(
  startingTeam: CodenamesTeam,
  wordPool: readonly string[] = CODENAMES_WORDS,
): CodenamesCard[] {
  const uniqueWords = new Map<string, string>();

  for (const rawWord of wordPool) {
    const word = rawWord.trim();

    if (!word) continue;
    const normalized = word.toLocaleLowerCase();

    if (!uniqueWords.has(normalized)) uniqueWords.set(normalized, word);
  }

  if (uniqueWords.size < BOARD_SIZE) {
    throw new Error("Codenames requires at least 25 unique words");
  }

  const words = shuffleInPlace([...uniqueWords.values()]).slice(0, BOARD_SIZE);
  const affiliations = createCodenamesAffiliations(startingTeam);

  return words.map((word, index) => ({
    index,
    word,
    affiliation: affiliations[index]!,
    revealed: false,
    revealedBy: null,
  }));
}

/** Assign one spymaster per team, then balance all remaining operatives. */
export function createCodenamesAssignments(playerIds: readonly string[]): CodenamesAssignments {
  if (playerIds.length < MIN_PLAYERS || playerIds.length > MAX_PLAYERS) {
    throw new Error(`Codenames requires ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
  }

  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error("Codenames player IDs must be unique");
  }

  const order = shuffleInPlace([...playerIds]);

  const assignments: CodenamesAssignments = {
    [order[0]!]: { team: "red", role: "spymaster" },
    [order[1]!]: { team: "blue", role: "spymaster" },
  };

  for (let index = 2; index < order.length; index++) {
    assignments[order[index]!] = {
      team: index % 2 === 0 ? "red" : "blue",
      role: "operative",
    };
  }

  return assignments;
}

/** Fill missing lobby roles while retaining valid explicit choices. */
export function normalizeCodenamesAssignments(
  playerIds: readonly string[],
  existing: Readonly<CodenamesAssignments> = {},
): CodenamesAssignments {
  const ids = [...new Set(playerIds)];
  const assignments: CodenamesAssignments = {};

  for (const id of ids) {
    const assignment = existing[id];

    if (
      assignment &&
      (assignment.team === "red" || assignment.team === "blue") &&
      (assignment.role === "spymaster" || assignment.role === "operative")
    ) {
      assignments[id] = { ...assignment };
    }
  }

  for (const team of ["red", "blue"] as const) {
    if (ids.some((id) => assignments[id]?.team === team && assignments[id]?.role === "spymaster"))
      continue;
    const candidate = ids.find((id) => !assignments[id]);

    if (candidate) assignments[candidate] = { team, role: "spymaster" };
  }

  for (const id of ids) {
    if (assignments[id]) continue;
    const red = ids.filter((candidate) => assignments[candidate]?.team === "red").length;
    const blue = ids.filter((candidate) => assignments[candidate]?.team === "blue").length;
    assignments[id] = { team: red <= blue ? "red" : "blue", role: "operative" };
  }

  return assignments;
}

export function validateCodenamesAssignments(
  playerIds: readonly string[],
  assignments: Readonly<CodenamesAssignments>,
): StartGameProblem | null {
  const current = playerIds.map((playerId) => assignments[playerId]);

  if (current.some((assignment) => !assignment)) {
    return {
      message: "Assign every player to a Codenames role before starting",
      code: "CODENAMES_ROLES_INCOMPLETE",
    };
  }

  for (const team of ["red", "blue"] as const) {
    const teamAssignments = current.filter((assignment) => assignment?.team === team);

    if (teamAssignments.filter((assignment) => assignment?.role === "spymaster").length !== 1) {
      return { message: `Assign exactly one ${team} spymaster`, code: "CODENAMES_SPYMASTER_COUNT" };
    }

    if (!teamAssignments.some((assignment) => assignment?.role === "operative")) {
      return {
        message: `Assign at least one ${team} operative`,
        code: "CODENAMES_OPERATIVE_MISSING",
      };
    }
  }

  const redCount = current.filter((assignment) => assignment?.team === "red").length;
  const blueCount = current.length - redCount;

  if (Math.abs(redCount - blueCount) > 1) {
    return {
      message: "Red and blue teams must be balanced within one player",
      code: "CODENAMES_TEAMS_UNBALANCED",
    };
  }

  return null;
}

/** Hide every affiliation from players who are not entitled to the key. */
export function projectCodenamesBoard(
  board: readonly CodenamesCard[],
  revealKey: boolean,
): Array<
  Omit<CodenamesCard, "affiliation"> & {
    affiliation: CodenamesAffiliation | null;
  }
> {
  return board.map((card) => ({
    ...card,
    affiliation: revealKey || card.revealed ? card.affiliation : null,
  }));
}

/** Whether this viewer may read the key: spymasters, and everyone once ended. */
export function canSeeKey(state: CodenamesGameState, playerId: string): boolean {
  return state.status === "ended" || state.assignments[playerId]?.role === "spymaster";
}

export function spymasterFor(state: CodenamesGameState, team: CodenamesTeam) {
  return state.players.find((player) => {
    const assignment = state.assignments[player.id];

    return assignment?.team === team && assignment.role === "spymaster";
  });
}

/** Append one activity entry, trimming the log to its readable window. */
export function appendActivity(
  state: CodenamesGameState,
  entry: Omit<CodenamesLogEntry, "at">,
  now: number,
): void {
  const activityLog = (state.activityLog ??= []);

  activityLog.push({ ...entry, at: now });

  if (activityLog.length > ACTIVITY_LOG_LIMIT) {
    activityLog.splice(0, activityLog.length - ACTIVITY_LOG_LIMIT);
  }
}

/** Milliseconds until the room's expiry, matching the platform lifetime rule. */
export function expiresAt(now: number): number {
  return now + ROOM_LIFETIME_MS;
}

/** Draw the starting team; the 9/8 agent split follows from it. */
export function drawStartingTeam(): CodenamesTeam {
  return randomInt(2) === 0 ? "red" : "blue";
}
