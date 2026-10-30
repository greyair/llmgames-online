import {
  isWireObject,
  wireObjectSchema,
  wireValueSchema,
  type WireObject,
  type WireValue,
} from "@llmgames/game-catalog";
import { vi } from "vitest";
import { z } from "zod";

import { CodenamesGameRoom } from "../../../durable-objects/CodenamesGameRoom";
import type { RoomRuntime } from "../../../durable-objects/runtime";
import type { Env } from "../../../types";
import type { CodenamesGameState, CodenamesLogEntry } from "../../../durable-objects/types";

/**
 * Deterministic driver for the Codenames transcript.
 *
 * One script captures the pre-plugin transcript and replays it against the
 * migrated room, so an equivalence failure always means a rule changed. Codenames
 * hides the key from everyone but the two spymasters, so every step records what
 * each of the four seats can read — a leak would otherwise look like a normal
 * board.
 */

export type CardView = {
  index: WireValue;
  word: WireValue;
  affiliation: WireValue;
  revealed: WireValue;
  revealedBy: WireValue;
};

interface SeatView {
  you: WireObject;
  board: CardView[];
  /** Full MCP decision state for this seat. */
  agent: WireObject;
}

export interface TranscriptStep {
  label: string;
  status: string;
  phase: string;
  turn: number;
  activeTeam: WireValue;
  currentSpymaster: string | null;
  clue: WireValue;
  guessesRemaining: WireValue;
  guessesMade: WireValue;
  remaining: WireValue;
  winner: WireValue;
  lastAnnouncement: string | null;
  activity: WireValue[];
  seats: Record<string, SeatView>;
  spectator: SeatView;
}

export interface TranscriptRejection {
  label: string;
  status: number;
  message: string | null;
  code: string | null;
}

export interface Transcript {
  steps: TranscriptStep[];
  rejections: TranscriptRejection[];
  events: Array<{ type: string; summary: WireValue }>;
  replay: WireObject | null;
}

/**
 * Fields the platform owns rather than the rules.
 *
 * `at` is a wall-clock stamp on every activity entry and the current clue, so it
 * is dropped recursively; ids and lifetime stamps are dropped at the top level
 * only, because card ids and player ids carry rule meaning.
 */
const TOP_VOLATILE: ReadonlySet<string> = new Set([
  "id",
  "roomCode",
  "createdAt",
  "updatedAt",
  "expiresAt",
  "playStartedAt",
  "spectatorCount",
  "jev",
]);

const NESTED_VOLATILE: ReadonlySet<string> = new Set([
  "gameTimeRemaining",
  "turnTimeRemaining",
  "startedAt",
  "clock",
  "at",
]);

function asObject(value: WireValue): WireObject {
  return isWireObject(value) ? value : {};
}

function objectsOf(value: WireValue): WireObject[] {
  return z
    .array(wireValueSchema)
    .catch([])
    .parse(value)
    .filter((entry): entry is WireObject => isWireObject(entry));
}

function stripValue(value: WireValue, depth = 0): WireValue {
  if (Array.isArray(value)) return value.map((entry) => stripValue(entry, depth + 1));

  if (!isWireObject(value)) return value;

  const kept: WireObject = {};

  for (const [key, entry] of Object.entries(value)) {
    if (NESTED_VOLATILE.has(key)) continue;

    if (depth === 0 && TOP_VOLATILE.has(key)) continue;

    kept[key] = stripValue(entry, depth + 1);
  }

  return kept;
}

function strip(value: WireObject): WireObject {
  return asObject(stripValue(value));
}

function activityViews(entries: readonly CodenamesLogEntry[]): WireValue[] {
  return entries.map((entry) => stripValue(wireValueSchema.parse(entry)));
}

function cardViews(value: WireValue): CardView[] {
  return objectsOf(value).map((card) => ({
    index: card.index,
    word: card.word,
    affiliation: card.affiliation,
    revealed: card.revealed,
    revealedBy: card.revealedBy,
  }));
}

function seatView(view: WireObject, agent: WireObject): SeatView {
  return {
    you: asObject(view.you),
    board: cardViews(view.board ?? []),
    agent: strip(agent),
  };
}

/**
 * Run with a zeroed CSPRNG.
 *
 * `randomInt` maps zeros to 0, which fixes the starting team, the word order,
 * the key layout and the lobby shuffle. Only the test process is seeded; the
 * room code that draws those values is unchanged.
 */
export async function withSeededRandom<T>(run: () => Promise<T>): Promise<T> {
  const random = vi.spyOn(crypto, "getRandomValues");

  random.mockImplementation(
    // SAFETY: the room only reads a Uint32Array back; zeros are a valid result.
    ((buffer: Uint32Array) => {
      buffer.fill(0);

      return buffer;
    }) as typeof crypto.getRandomValues,
  );

  try {
    return await run();
  } finally {
    random.mockRestore();
  }
}

/** Test-only room with the accessors the transcript needs. */
export function transcriptRoom(
  Room: new (state: RoomRuntime, env: Env) => CodenamesGameRoom,
  state: RoomRuntime,
  env: Env,
) {
  class TranscriptRoom extends Room {
    readonly events: Array<{ type: string; summary: WireValue }> = [];

    protected recordEvent<T>(type: string, summary?: T): void {
      this.events.push({ type, summary: wireValueSchema.parse(summary ?? null) });
      super.recordEvent(type, summary);
    }

    snapshot(): CodenamesGameState {
      if (!this.gameState) throw new Error("Transcript room has no game state");

      return this.gameState;
    }

    viewFor(playerId: string): WireObject {
      return wireObjectSchema.parse(this.buildClientView(playerId) ?? {});
    }

    agentViewFor(playerId: string): WireObject {
      return wireObjectSchema.parse(this.buildAgentView(playerId) ?? {});
    }

    replayView(): WireObject | null {
      const view = this.buildRewatchView();

      return view ? strip(asObject(wireValueSchema.parse(view))) : null;
    }

    expireTurn(playerId: string | null): Promise<void> {
      return this.onTurnTimeout(playerId);
    }

    expireMatch(): void {
      this.onGameTimeout();
    }

    /** Start attempt that is expected to fail validation. */
    async startAs(playerId: string): Promise<Response> {
      return post(this, "/agent/start", { playerId });
    }
  }

  return new TranscriptRoom(state, env);
}

export type TranscriptRoom = ReturnType<typeof transcriptRoom>;

export function post<T>(room: TranscriptRoom, path: string, body: T): Promise<Response> {
  return room.fetch(
    new Request(`https://transcript.invalid${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Snapshot of everything a client can read, from every seat plus a watcher. */
export function step(
  room: TranscriptRoom,
  label: string,
  seats: readonly string[],
  watcherId = "watcher",
): TranscriptStep {
  const state = room.snapshot();

  const view = (playerId: string) =>
    seatView(room.viewFor(playerId), room.agentViewFor(playerId));

  const seatViews: Record<string, SeatView> = {};

  for (const playerId of seats) seatViews[playerId] = view(playerId);

  const spymaster = state.players.find((player) => {
    const assignment = state.assignments[player.id];

    return assignment?.team === state.activeTeam && assignment.role === "spymaster";
  });

  return {
    label,
    status: state.status,
    phase: state.turnState.phase,
    turn: state.turnState.turnNumber,
    activeTeam: state.activeTeam,
    currentSpymaster: spymaster?.id ?? null,
    // Copied, not referenced: the room keeps mutating these objects, and a step
    // must describe the moment it was taken rather than the end of the match.
    clue: stripValue(wireValueSchema.parse(state.clue)),
    guessesRemaining: state.guessesRemaining,
    guessesMade: state.guessesMade,
    remaining: stripValue(state.remaining),
    winner: state.winner,
    lastAnnouncement: null,
    activity: activityViews(state.activityLog ?? []),
    seats: seatViews,
    spectator: view(watcherId),
  };
}

/** Index of the first unrevealed card with this affiliation, or null. */
export function cardIndex(
  state: CodenamesGameState,
  affiliation: "red" | "blue" | "neutral" | "assassin",
  skip = 0,
): number | null {
  const matches = state.board
    .filter((card) => !card.revealed && card.affiliation === affiliation)
    .map((card) => card.index);

  return matches.at(skip) ?? null;
}

/** Role holder for a team, used by the script to act as the right seat. */
export function seatFor(
  state: CodenamesGameState,
  team: "red" | "blue",
  role: "spymaster" | "operative",
): string {
  const player = state.players.find((candidate) => {
    const assignment = state.assignments[candidate.id];

    return assignment?.team === team && assignment.role === role;
  });

  if (!player) throw new Error(`No ${team} ${role} seated`);

  return player.id;
}
