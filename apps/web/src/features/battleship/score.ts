import { isNumber } from "@llmgames/game-catalog";

/**
 * Client-side Battleship scoring (derived from shot log).
 *
 *  Miss ………… 0
 *  Hit …………… 10
 *  Sink bonus … 25 + (ship length × 5)
 */

import { BATTLESHIP_FLEET } from "@llmgames/game-catalog";

const SHIP_LENGTH: Record<string, number> = Object.fromEntries(
  BATTLESHIP_FLEET.map((ship) => [ship.id, ship.length]),
);

export type ScoreShot = {
  sequence?: number;
  hit: boolean;
  sunkShipId?: string;
  byPlayerId: string;
  weapon?: string;
  row: number;
  col: number;
};

function pointsForShot(s: ScoreShot): number {
  if (!s.hit) return 0;
  let pts = 10;

  if (s.sunkShipId) {
    const len = SHIP_LENGTH[s.sunkShipId] ?? 3;
    pts += 25 + len * 5;
  }

  return pts;
}

export function scoreForPlayer(shots: ScoreShot[], playerId: string | undefined): number {
  if (!playerId) return 0;

  return shots
    .filter((s) => s.byPlayerId === playerId)
    .reduce((sum, s) => sum + pointsForShot(s), 0);
}

export function latestShotSequence(shots: ScoreShot[]): number {
  const sequence = shots.at(-1)?.sequence;

  return isNumber(sequence) ? sequence : shots.length;
}

/** Return shots added since the previous absolute server sequence. */
export function latestRoundShots(shots: ScoreShot[], previousSequence: number): ScoreShot[] {
  if (shots.some((shot) => isNumber(shot.sequence))) {
    return shots.filter((shot) => isNumber(shot.sequence) && shot.sequence > previousSequence);
  }

  if (shots.length <= previousSequence) return [];

  return shots.slice(previousSequence);
}

export function summarizeRound(shots: ScoreShot[]) {
  const points = shots.reduce((sum, s) => sum + pointsForShot(s), 0);
  const hits = shots.filter((s) => s.hit).length;
  const misses = shots.length - hits;

  const sinks = shots.flatMap((shot) => (shot.sunkShipId ? [shot.sunkShipId] : []));

  const raw = shots[0]?.weapon;

  const weapon = !raw || raw === "fire" || raw === "cannon" ? "cannon" : raw;

  return { points, hits, misses, sinks, weapon };
}
