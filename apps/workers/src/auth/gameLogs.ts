import { streamWatchUrl } from "../lib/featuredGames";
import type { D1Database } from "@cloudflare/workers-types";

export interface AgentGameLogParticipant {
  ref: string;
  isYours: boolean;
  isAgent: boolean;
  codename: string | null;
  environmentLabel: string | null;
  displayName: string;
  ownerGamertag: string | null;
}

export interface AgentGameLogSummary {
  id: string;
  gameType: string;
  startedAt: number;
  endedAt: number;
  endReason: string;
  winner: string | null;
  eventCount: number;
  sizeBytes: number;
  participants: AgentGameLogParticipant[];
  featured?: { watchUrl: string; recording: boolean };
}

type GameLogRow = {
  id: string;
  game_type: string;
  started_at: number;
  ended_at: number;
  end_reason: string;
  winner_ref: string | null;
  event_count: number;
  size_bytes: number;
  channel_login: string | null;
  vod_id: string | null;
  offset_seconds: number | null;
};

type ParticipantRow = {
  game_log_id: string;
  participant_ref: string;
  is_agent: number;
  codename: string | null;
  environment_label: string | null;
  display_name: string;
  owner_gamertag: string | null;
  owner_user_id: string | null;
};

export async function listOwnedAgentGameLogs(
  db: D1Database,
  ownerUserId: string,
  options: { limit?: number; before?: string } = {},
): Promise<{ games: AgentGameLogSummary[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 20)));
  const cursorMatch = options.before?.match(/^(\d+):([0-9A-Za-z-]+)$/);
  const beforeEndedAt = cursorMatch ? Number(cursorMatch[1]) : null;
  const beforeId = cursorMatch?.[2] ?? null;

  const beforeClause =
    beforeEndedAt == null || beforeId == null
      ? ""
      : "AND (gl.ended_at < ? OR (gl.ended_at = ? AND gl.id < ?))";

  const query = `SELECT
      gl.id, gl.game_type, gl.started_at, gl.ended_at, gl.end_reason,
      gl.winner_ref, gl.event_count, gl.size_bytes, bf.channel_login, bf.vod_id, bf.offset_seconds
    FROM game_logs gl
    LEFT JOIN game_broadcast_features bf ON bf.game_log_id = gl.id
    WHERE EXISTS (
      SELECT 1 FROM game_log_participants own
      WHERE own.game_log_id = gl.id
        AND own.owner_user_id = ?
    )
    ${beforeClause}
    ORDER BY gl.ended_at DESC, gl.id DESC
    LIMIT ?`;

  const statement = db.prepare(query);

  const result =
    beforeEndedAt == null || beforeId == null
      ? await statement.bind(ownerUserId, limit + 1).all<GameLogRow>()
      : await statement
          .bind(ownerUserId, beforeEndedAt, beforeEndedAt, beforeId, limit + 1)
          .all<GameLogRow>();

  const rows = result.results ?? [];
  const page = rows.slice(0, limit);

  if (page.length === 0) return { games: [], nextCursor: null };

  const placeholders = page.map(() => "?").join(", ");

  const participantResult = await db
    .prepare(
      `SELECT game_log_id, participant_ref, is_agent, codename,
            environment_label, display_name, owner_gamertag, owner_user_id
     FROM game_log_participants
     WHERE game_log_id IN (${placeholders})
     ORDER BY game_log_id, participant_ref`,
    )
    .bind(...page.map((row) => row.id))
    .all<ParticipantRow>();

  const participantsByGame = new Map<string, AgentGameLogParticipant[]>();

  for (const participant of participantResult.results ?? []) {
    const list = participantsByGame.get(participant.game_log_id) ?? [];
    list.push({
      ref: participant.participant_ref,
      isYours: participant.owner_user_id === ownerUserId,
      isAgent: participant.is_agent === 1,
      codename: participant.codename,
      environmentLabel: participant.environment_label,
      displayName: participant.display_name,
      ownerGamertag: participant.owner_gamertag,
    });
    participantsByGame.set(participant.game_log_id, list);
  }

  return {
    games: page.map((row) => {
      const game: AgentGameLogSummary = {
        id: row.id,
        gameType: row.game_type,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        endReason: row.end_reason,
        winner: row.winner_ref,
        eventCount: row.event_count,
        sizeBytes: row.size_bytes,
        participants: participantsByGame.get(row.id) ?? [],
      };

      if (row.channel_login)
        game.featured = {
          watchUrl: streamWatchUrl({
            channel_login: row.channel_login,
            vod_id: row.vod_id,
            offset_seconds: row.offset_seconds ?? 0,
          }),
          recording: Boolean(row.vod_id),
        };

      return game;
    }),
    nextCursor: rows.length > limit ? `${page.at(-1)!.ended_at}:${page.at(-1)!.id}` : null,
  };
}

export async function getOwnedAgentGameLogKey(
  db: D1Database,
  ownerUserId: string,
  gameId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT gl.r2_key
     FROM game_logs gl
     WHERE gl.id = ?
       AND EXISTS (
         SELECT 1 FROM game_log_participants own
         WHERE own.game_log_id = gl.id
           AND own.owner_user_id = ?
       )
     LIMIT 1`,
    )
    .bind(gameId, ownerUserId)
    .first<{ r2_key: string }>();

  return row?.r2_key ?? null;
}
