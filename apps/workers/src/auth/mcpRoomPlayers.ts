/**
 * Public, room-scoped identities for private MCP agent credentials.
 *
 * `agentId` authenticates an MCP seat and must never enter a game Durable
 * Object or projected state. Every room instead receives a random `playerId`.
 * The Worker resolves the mapping after it has authenticated the OAuth owner.
 */

import type { D1Database } from "@cloudflare/workers-types";

export interface McpRoomPlayer {
  roomId: string;
  agentId: string;
  playerId: string;
  createdAt: number;
  lastUsedAt: number;
}

export type ClaimMcpRoomPlayerResult =
  | { claimed: true; player: McpRoomPlayer }
  | { claimed: false; player: McpRoomPlayer };

type McpRoomPlayerRow = {
  room_id: string;
  agent_id: string;
  player_id: string;
  created_at: number;
  last_used_at: number;
};

function playerFromRow(row: McpRoomPlayerRow): McpRoomPlayer {
  return {
    roomId: row.room_id,
    agentId: row.agent_id,
    playerId: row.player_id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * Return the existing public identity for a room, or mint it atomically.
 * The INSERT ... SELECT ownership check is intentional defense in depth.
 */
export async function ensureMcpRoomPlayer(
  db: D1Database,
  ownerUserId: string,
  agentId: string,
  roomId: string,
): Promise<McpRoomPlayer> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const playerId = `player_${crypto.randomUUID()}`;

    const row = await db
      .prepare(
        `INSERT INTO mcp_room_players (
           room_id, agent_id, player_id, created_at, last_used_at
         )
         SELECT ?, id, ?, unixepoch(), unixepoch()
         FROM mcp_agent_seats
         WHERE id = ? AND owner_user_id = ?
         ON CONFLICT(room_id, agent_id) DO UPDATE SET
           last_used_at = excluded.last_used_at
         RETURNING room_id, agent_id, player_id, created_at, last_used_at`,
      )
      .bind(roomId, playerId, agentId, ownerUserId)
      .first<McpRoomPlayerRow>();

    if (row) return playerFromRow(row);
  }

  throw new Error("Could not create a public room identity for this agent");
}

/**
 * Claim an agent's room seat once. Unlike ensureMcpRoomPlayer, this reports an
 * existing mapping as a collision so two independent MCP callers cannot both
 * complete room_join as the same player.
 */
export async function claimMcpRoomPlayer(
  db: D1Database,
  ownerUserId: string,
  agentId: string,
  roomId: string,
): Promise<ClaimMcpRoomPlayerResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const playerId = `player_${crypto.randomUUID()}`;

    const inserted = await db
      .prepare(
        `INSERT INTO mcp_room_players (
           room_id, agent_id, player_id, created_at, last_used_at
         )
         SELECT ?, id, ?, unixepoch(), unixepoch()
         FROM mcp_agent_seats
         WHERE id = ? AND owner_user_id = ?
         ON CONFLICT(room_id, agent_id) DO NOTHING
         RETURNING room_id, agent_id, player_id, created_at, last_used_at`,
      )
      .bind(roomId, playerId, agentId, ownerUserId)
      .first<McpRoomPlayerRow>();

    if (inserted) return { claimed: true, player: playerFromRow(inserted) };

    const existing = await getMcpRoomPlayer(db, ownerUserId, agentId, roomId);

    if (existing) return { claimed: false, player: existing };
  }

  throw new Error("Could not claim a public room identity for this agent");
}

/**
 * Transitional lookup for a persisted legacy game room whose player ID is the
 * old agentId. This is intentionally not used by public MCP tool handlers.
 */
export async function ensureLegacyMcpRoomPlayer(
  db: D1Database,
  agentId: string,
  roomId: string,
): Promise<McpRoomPlayer | null> {
  const seat = await db
    .prepare("SELECT owner_user_id FROM mcp_agent_seats WHERE id = ? LIMIT 1")
    .bind(agentId)
    .first<{ owner_user_id: string }>();

  if (!seat) return null;

  return ensureMcpRoomPlayer(db, seat.owner_user_id, agentId, roomId);
}

/** Resolve a previously seated agent without creating membership implicitly. */
export async function getMcpRoomPlayer(
  db: D1Database,
  ownerUserId: string,
  agentId: string,
  roomId: string,
): Promise<McpRoomPlayer | null> {
  const row = await db
    .prepare(
      `SELECT room_players.room_id, room_players.agent_id,
              room_players.player_id, room_players.created_at,
              room_players.last_used_at
       FROM mcp_room_players AS room_players
       JOIN mcp_agent_seats AS seats ON seats.id = room_players.agent_id
       WHERE room_players.room_id = ?
         AND room_players.agent_id = ?
         AND seats.owner_user_id = ?
       LIMIT 1`,
    )
    .bind(roomId, agentId, ownerUserId)
    .first<McpRoomPlayerRow>();

  return row ? playerFromRow(row) : null;
}

/** Remove a mapping created for a room that failed before becoming active. */
export async function releaseMcpRoomPlayer(
  db: D1Database,
  agentId: string,
  roomId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM mcp_room_players WHERE room_id = ? AND agent_id = ?")
    .bind(roomId, agentId)
    .run();
}
