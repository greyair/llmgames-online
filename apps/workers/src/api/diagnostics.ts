/**
 * Operator diagnostics.
 *
 * Read-only aggregation over existing D1 tables: no new infrastructure, no new
 * migrations, and no room fan-out. Detailed failure counters live in structured
 * log events (`archive_failed`, `state_restore_failed`, `mcp_action_failed`).
 */

import { Hono } from "hono";
import type { Env, Variables } from "../types";

export const diagnosticsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const WINDOW_HOURS = 24;

/** End reasons that mean the platform reclaimed the room instead of the rules ending it. */
const ABNORMAL_END_REASONS = ["room_expired", "room_inactive", "aborted"] as const;

function operatorIds(env: Env): string[] {
  return (env.OPERATOR_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

diagnosticsRoutes.get("/", async (c) => {
  const user = c.get("user");

  // Unconfigured diagnostics stay invisible rather than advertising themselves.
  if (!user || !operatorIds(c.env).includes(user.id)) return c.json({ error: "Not Found" }, 404);

  const now = Date.now();
  const since = Math.floor((now - WINDOW_HOURS * 60 * 60 * 1000) / 1000);

  const [liveRooms, endedByReason, seriesRows, oldestRoom] = await Promise.all([
    c.env.DB.prepare(
      `SELECT game_type, status, COUNT(*) AS rooms
       FROM active_rooms
       WHERE expires_at > ?
       GROUP BY game_type, status`,
    )
      .bind(now)
      .all<{ game_type: string; status: string; rooms: number }>(),
    c.env.DB.prepare(
      `SELECT end_reason, COUNT(*) AS games
       FROM game_logs
       WHERE ended_at >= ?
       GROUP BY end_reason
       ORDER BY games DESC`,
    )
      .bind(since)
      .all<{ end_reason: string; games: number }>(),
    c.env.DB.prepare(
      `SELECT status, COUNT(*) AS series
       FROM game_series
       GROUP BY status`,
    ).all<{ status: string; series: number }>(),
    c.env.DB.prepare(
      `SELECT MIN(created_at) AS oldest, COUNT(*) AS rooms
       FROM active_rooms
       WHERE expires_at > ?`,
    )
      .bind(now)
      .first<{ oldest: number | null; rooms: number }>(),
  ]);

  const ends = endedByReason.results ?? [];

  const abnormal = ends
    .filter((row) => ABNORMAL_END_REASONS.some((reason) => row.end_reason === reason))
    .reduce((total, row) => total + row.games, 0);

  const totalEnded = ends.reduce((total, row) => total + row.games, 0);

  return c.json({
    windowHours: WINDOW_HOURS,
    generatedAt: now,
    rooms: {
      live: oldestRoom?.rooms ?? 0,
      oldestCreatedAt: oldestRoom?.oldest ?? null,
      byGameType: (liveRooms.results ?? []).map((row) => ({
        gameType: row.game_type,
        status: row.status,
        rooms: row.rooms,
      })),
    },
    games: {
      ended: totalEnded,
      abnormal,
      normal: totalEnded - abnormal,
      byEndReason: ends,
    },
    series: seriesRows.results ?? [],
    logEvents: {
      note: "Failure counters are structured log events, not stored rows.",
      names: [
        "archive_failed",
        "archive_directory_failed",
        "state_restore_failed",
        "mcp_action_failed",
        "mcp_auth_failed",
        "room_lifecycle",
      ],
    },
  });
});
