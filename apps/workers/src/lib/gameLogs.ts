import {
  archivedParticipantsAreReadable,
  isObject,
  isString,
  wireValueSchema,
  type WireValue,
} from "@llmgames/game-catalog";
import { logEvent } from "./observability";

import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { RewatchPayload } from "../types";
import type { GameEventRecord } from "../durable-objects/BaseGameRoom";
import type { BaseGameState, BasePlayerInfo } from "../durable-objects/types";

export const GAME_LOG_SCHEMA_VERSION = 1;

export interface GameLogParticipant {
  ref: string;
  name: string;
  isAgent: boolean;
  codename?: string;
  environmentLabel?: string;
  ownerGamertag?: string;
}

export interface GameLogDocument {
  version: typeof GAME_LOG_SCHEMA_VERSION;
  gameId: string;
  gameType: string;
  startedAt: number;
  endedAt: number;
  endReason: string;
  winner: string | null;
  participants: GameLogParticipant[];
  events: GameEventRecord[];
  rewatch: RewatchPayload;
}

interface ArchiveParticipant extends GameLogParticipant {
  sourceId: string;
  ownerUserIdHint?: string;
}

export interface CompletedGameArchive {
  document: GameLogDocument;
  participants: ArchiveParticipant[];
}

export interface GameLogBindings {
  DB: D1Database;
  GAME_LOGS: R2Bucket;
}

/** Replace room player IDs everywhere in the public archive with p1, p2, ... */
function replacePlayerIds(value: WireValue, refs: Map<string, string>): WireValue {
  if (isString(value)) return refs.get(value) ?? value;

  if (Array.isArray(value)) {
    return value.map((entry) => replacePlayerIds(entry, refs));
  }

  if (value === null || !isObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      refs.get(key) ?? key,
      replacePlayerIds(entry, refs),
    ]),
  );
}

function participantFromPlayer(
  player: BasePlayerInfo,
  index: number,
  ownerUserIdHint?: string,
): ArchiveParticipant {
  const participant: ArchiveParticipant = {
    ref: `p${index + 1}`,
    sourceId: player.id,
    ownerUserIdHint,
    name: player.name,
    isAgent: player.isAgent === true || player.channel === "mcp",
  };

  if (player.codename) participant.codename = player.codename;

  if (player.environmentLabel) participant.environmentLabel = player.environmentLabel;

  if (player.ownerGamertag) participant.ownerGamertag = player.ownerGamertag;

  return participant;
}

/** Build the single sanitized file written to R2. */
export function buildCompletedGameArchive(
  state: BaseGameState,
  events: GameEventRecord[],
  rewatch: RewatchPayload,
  endReason: string,
): CompletedGameArchive {
  const participants = state.players.map((player, index) => participantFromPlayer(player, index));

  const refs = new Map(participants.map((participant) => [participant.sourceId, participant.ref]));

  const startedAt =
    events.find((event) => event.type === "game_started")?.at ??
    state.turnState.startedAt ??
    state.createdAt;

  const endedAt =
    [...events].reverse().find((event) => event.type === "game_ended")?.at ?? Date.now();

  const winnerValue = "winner" in state ? state.winner : undefined;

  const winner = isString(winnerValue) ? (refs.get(winnerValue) ?? winnerValue) : null;

  // The reader only understands this shape; report drift instead of archiving a
  // document that history detail can never open.
  if (!archivedParticipantsAreReadable(participants))
    logEvent("archive_contract_violation", { gameType: state.type, gameId: state.id });

  return {
    participants,
    document: {
      version: GAME_LOG_SCHEMA_VERSION,
      gameId: state.id,
      gameType: state.type,
      startedAt,
      endedAt,
      endReason,
      winner,
      participants: participants.map(
        ({ sourceId: _sourceId, ownerUserIdHint: _hint, ...participant }) => participant,
      ),
      events: events.map((event) => {
        const sanitized = { ...event };

        if (event.summary !== undefined) sanitized.summary = replacePlayerIds(event.summary, refs);

        return sanitized;
      }),
      rewatch: {
        ...rewatch,
        frames: rewatch.frames.map((frame) => ({
          ...frame,
          state: replacePlayerIds(wireValueSchema.parse(frame.state), refs),
        })),
      },
    },
  };
}

async function gzipJson<T>(value: T): Promise<ArrayBuffer> {
  const json = JSON.stringify(value);

  const compressed = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));

  return new Response(compressed).arrayBuffer();
}

async function resolveOwnerUserId(
  db: D1Database,
  participant: ArchiveParticipant,
): Promise<string | null> {
  const directOwnerId =
    participant.ownerUserIdHint ?? (!participant.isAgent ? participant.sourceId : null);

  if (directOwnerId) {
    const user = await db
      .prepare("SELECT id FROM users WHERE id = ? LIMIT 1")
      .bind(directOwnerId)
      .first<{ id: string }>();

    return user?.id ?? null;
  }

  const seat = await db
    .prepare(
      `SELECT owner_user_id
       FROM (
         SELECT seats.owner_user_id AS owner_user_id, 0 AS priority
         FROM mcp_room_players AS room_players
         JOIN mcp_agent_seats AS seats ON seats.id = room_players.agent_id
         WHERE room_players.player_id = ?
         UNION ALL
         SELECT owner_user_id, 1 AS priority
         FROM mcp_agent_seats
         WHERE id = ?
       )
       ORDER BY priority
       LIMIT 1`,
    )
    // The second argument preserves ownership for games that were already live
    // before room-scoped public player IDs were introduced.
    .bind(participant.sourceId, participant.sourceId)
    .first<{ owner_user_id: string }>();

  return seat?.owner_user_id ?? null;
}

/**
 * Persist one completed game. The R2 key and D1 primary key make retries safe.
 * R2 is written first so D1 never advertises an object that was not uploaded.
 */
export async function persistCompletedGameArchive(
  bindings: GameLogBindings,
  archive: CompletedGameArchive,
): Promise<void> {
  const { document, participants } = archive;
  const r2Key = `game-logs/v${GAME_LOG_SCHEMA_VERSION}/${document.gameId}.json.gz`;
  const body = await gzipJson(document);
  await bindings.GAME_LOGS.put(r2Key, body, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      contentEncoding: "gzip",
    },
    customMetadata: {
      gameId: document.gameId,
      gameType: document.gameType,
      version: String(GAME_LOG_SCHEMA_VERSION),
    },
  });

  const owners = await Promise.all(
    participants.map((participant) => resolveOwnerUserId(bindings.DB, participant)),
  );

  const statements = [
    bindings.DB.prepare(
      `INSERT INTO game_logs (
         id, game_type, started_at, ended_at, end_reason, winner_ref,
         event_count, r2_key, size_bytes, schema_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         game_type = excluded.game_type,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         end_reason = excluded.end_reason,
         winner_ref = excluded.winner_ref,
         event_count = excluded.event_count,
         r2_key = excluded.r2_key,
         size_bytes = excluded.size_bytes,
         schema_version = excluded.schema_version`,
    ).bind(
      document.gameId,
      document.gameType,
      Math.floor(document.startedAt / 1000),
      Math.floor(document.endedAt / 1000),
      document.endReason,
      document.winner,
      document.events.length,
      r2Key,
      body.byteLength,
      GAME_LOG_SCHEMA_VERSION,
    ),
    bindings.DB.prepare("DELETE FROM game_log_participants WHERE game_log_id = ?").bind(
      document.gameId,
    ),
    ...participants.map((participant, index) =>
      bindings.DB.prepare(
        `INSERT INTO game_log_participants (
           game_log_id, participant_ref, owner_user_id, is_agent, codename,
           environment_label, display_name, owner_gamertag
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        document.gameId,
        participant.ref,
        owners[index],
        participant.isAgent ? 1 : 0,
        participant.codename ?? null,
        participant.environmentLabel ?? null,
        participant.name,
        participant.ownerGamertag ?? null,
      ),
    ),
  ];

  await bindings.DB.batch(statements);
}
