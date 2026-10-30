import {
  isString,
  isWireObject,
  wireObjectSchema,
  wireValueSchema,
  type WireObject,
  type WireValue,
} from "@llmgames/game-catalog";
import { vi } from "vitest";
import { z } from "zod";

import { BattleshipRoom } from "../../../durable-objects/BattleshipRoom";
import type { RoomRuntime } from "../../../durable-objects/runtime";
import type { Env } from "../../../types";
import { BATTLESHIP_FALLBACK_FLEET } from "../../../durable-objects/types";
import type { BattleshipGameState } from "../../../durable-objects/types";

/**
 * Deterministic driver for the Battleship transcript.
 *
 * The same script captures the pre-plugin transcript and replays it against the
 * migrated room, so an equivalence failure always means a rule changed — not
 * that two tests drifted apart.
 *
 * Timestamps are dropped from the transcript and randomness comes from a seeded
 * CSPRNG, so seat order, auto-placed fleets and mine retaliation are reproducible.
 * Production randomness is untouched: this file is tests only.
 */

export type Side = "p1" | "p2";

interface SideView {
  you: WireObject;
  yourBoard: WireObject | null;
  opponent: WireObject | null;
  stats: WireObject;
  shotLog: WireValue[];
  /** Full MCP decision state for this seat. */
  agent: WireObject;
}

export interface TranscriptStep {
  label: string;
  status: string;
  phase: string;
  turn: number;
  current: Side | null;
  winner: Side | "draw" | null;
  announcement: string | null;
  views: Record<Side, SideView>;
  spectator: WireObject;
}

export interface TranscriptRejection {
  label: string;
  status: number;
  message: string | null;
}

export interface Transcript {
  steps: TranscriptStep[];
  rejections: TranscriptRejection[];
  events: Array<{ type: string; summary: WireValue }>;
  replay: WireObject | null;
}

/**
 * Fields that belong to the platform rather than the rules.
 *
 * Top-level ids and lifetime stamps describe the room; clock fields also appear
 * inside `turnState`, where a millisecond of test timing must not count as a rule
 * difference. `salvoId` is a random UUID and never reaches the transcript: salvo
 * grouping stays visible through the shot sequence and weapon.
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
  "salvoId",
]);

/** Read an object field without trusting its shape. */
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

/** Drop platform-owned volatile fields so only rule output remains. */
function strip(value: WireObject): WireObject {
  return asObject(stripValue(value));
}

/** Map a room player id to the transcript's stable seat label. */
function seatOf(value: WireValue): Side | null {
  return value === "p1" || value === "p2" ? value : null;
}

function winnerOf(value: WireValue): Side | "draw" | null {
  return value === "draw" ? "draw" : seatOf(value);
}

/** Board cells as rows of ship initials, so two fleets compare cell by cell. */
function grid(cells: WireValue): string[] {
  const rows = z.array(z.array(wireValueSchema)).catch([]).parse(cells);

  return rows.map((row) => row.map((cell) => (isString(cell) ? cell[0]! : ".")).join(""));
}

function ships(value: WireValue) {
  return objectsOf(value).map((ship) => ({
    id: ship.id,
    row: ship.row,
    col: ship.col,
    rotation: ship.rotation,
    hits: ship.hits,
    sunk: ship.sunk,
  }));
}

function fleetStatus(value: WireValue) {
  return objectsOf(value).map((ship) => ({
    id: ship.id,
    sunk: ship.sunk,
    hits: ship.hits ?? null,
  }));
}

function shots(value: WireValue) {
  return objectsOf(value).map((shot) => ({
    sequence: shot.sequence,
    row: shot.row,
    col: shot.col,
    hit: shot.hit,
    sunkShipId: shot.sunkShipId,
    byPlayerId: shot.byPlayerId,
    weapon: shot.weapon,
  }));
}

function pickSideView(view: WireObject, agent: WireObject): SideView {
  const yourBoard = view.yourBoard;
  const opponent = view.opponent;

  return {
    you: asObject(view.you),
    yourBoard: isWireObject(yourBoard)
      ? {
          ready: yourBoard.ready,
          munitionPoints: yourBoard.munitionPoints,
          weapons: asObject(yourBoard.weapons),
          shipsRemaining: yourBoard.shipsRemaining,
          ships: ships(yourBoard.ships ?? null),
          cells: grid(yourBoard.cells ?? []),
          mines: yourBoard.mines ?? [],
          fleetStatus: fleetStatus(yourBoard.fleetStatus ?? []),
          incomingHits: yourBoard.incomingHits ?? [],
          incomingMisses: yourBoard.incomingMisses ?? [],
          radarScans: yourBoard.radarScans ?? [],
          bombedAreas: yourBoard.bombedAreas ?? [],
          triggeredMines: yourBoard.triggeredMines ?? [],
          torpedoPaths: yourBoard.torpedoPaths ?? [],
          mineShots: yourBoard.mineShots ?? [],
          mineHits: yourBoard.mineHits ?? [],
        }
      : null,
    opponent: isWireObject(opponent)
      ? {
          ready: opponent.ready,
          shipsRemaining: opponent.shipsRemaining,
          fleetStatus: fleetStatus(opponent.fleetStatus ?? []),
          sunkShips: objectsOf(opponent.sunkShips ?? []).map((ship) => ship.id),
          hits: opponent.hits ?? [],
          misses: opponent.misses ?? [],
          radarScans: opponent.radarScans ?? [],
          bombedAreas: opponent.bombedAreas ?? [],
          triggeredMines: opponent.triggeredMines ?? [],
          torpedoPaths: opponent.torpedoPaths ?? [],
          mineShots: opponent.mineShots ?? [],
        }
      : null,
    stats: asObject(view.stats),
    shotLog: shots(view.shotLog ?? []),
    agent: strip(agent),
  };
}

/**
 * Spectator projection: both fleets stay hidden, so no cell grid may appear.
 * That absence is the privacy assertion for watchers.
 */
function pickSpectator(view: WireObject): WireObject {
  const turn = asObject(view.turnState);

  return {
    status: view.status,
    phase: turn.phase ?? null,
    winner: view.winner ?? null,
    announcement: view.lastAnnouncement ?? null,
    yourBoard: view.yourBoard ?? null,
    boards: objectsOf(view.spectatorBoards ?? []).map((board) => ({
      playerId: board.playerId,
      ready: board.ready,
      shipsRemaining: board.shipsRemaining,
      fleetStatus: fleetStatus(board.fleetStatus ?? []),
      hits: board.hits ?? [],
      misses: board.misses ?? [],
      mines: board.mines ?? null,
      cells: board.cells ?? null,
    })),
  };
}

/**
 * Run with a zeroed CSPRNG.
 *
 * `randomInt` maps zeros to 0, which fixes seat order, the auto-placed fleets and
 * every mine retaliation. Only the test process is seeded; the room code that
 * draws those values is unchanged.
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
  Room: new (state: RoomRuntime, env: Env) => BattleshipRoom,
  state: RoomRuntime,
  env: Env,
) {
  class TranscriptRoom extends Room {
    readonly events: Array<{ type: string; summary: WireValue }> = [];

    protected recordEvent<T>(type: string, summary?: T): void {
      this.events.push({ type, summary: wireValueSchema.parse(summary ?? null) });
      super.recordEvent(type, summary);
    }

    snapshot(): BattleshipGameState {
      if (!this.gameState) throw new Error("Transcript room has no game state");

      return this.gameState;
    }

    /** The browser payload: fog-of-war projection plus the platform `you` block. */
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

/** Snapshot of everything a client can read, from both seats plus a watcher. */
export function step(room: TranscriptRoom, label: string, watcherId = "watcher"): TranscriptStep {
  const state = room.snapshot();

  const side = (sideId: Side): SideView =>
    pickSideView(room.viewFor(sideId), room.agentViewFor(sideId));

  return {
    label,
    status: state.status,
    phase: state.turnState.phase,
    turn: state.turnState.turnNumber,
    current: seatOf(state.turnState.currentPlayerId),
    winner: winnerOf(state.winner),
    announcement: state.lastAnnouncement,
    views: { p1: side("p1"), p2: side("p2") },
    spectator: pickSpectator(room.viewFor(watcherId)),
  };
}

/** The shipped fallback fleet, mirrored for the opponent so both layouts differ. */
export function fleetFor(mirror: 0 | 1 = 0): Array<Record<string, number | string>> {
  return BATTLESHIP_FALLBACK_FLEET.map((ship) =>
    mirror === 0
      ? { ...ship }
      : { id: ship.id, row: 9 - ship.row, col: 9 - ship.col, rotation: 180 },
  );
}
