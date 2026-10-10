/**
 * Persistent MCP agent identities.
 *
 * Each seat has a private server-side agentId and a public codename.
 * One OAuth human may own many seats. MCP callers receive task controllers,
 * while a separate random playerId is used inside each room.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { generateCodename, generateUniqueCodename } from "../lib/codenames";

export interface McpAgentSeat {
  id: string;
  ownerUserId: string;
  codename: string;
  clientId: string | null;
  environmentLabel: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface ManagedMcpAgentSeat extends McpAgentSeat {
  hasRoomHistory: boolean;
  isActive: boolean;
}

export const MCP_AGENT_IDENTITY_LIMIT = 32;

const MCP_AGENT_UNUSED_CLAIM_GRACE_SECONDS = 5 * 60;

interface McpAgentIdentityErrorDetails {
  count?: number;
  limit?: number;
  recoveryTools?: string[];
  roomId?: string;
  seriesCode?: string;
  managementUrl?: string;
  userActionRequired?: boolean;
  instruction?: string;
  retryAfterSeconds?: number;
}

export class McpAgentIdentityError extends Error {
  constructor(
    readonly code:
      | "MCP_AGENT_IDENTITY_LIMIT"
      | "MCP_AGENT_IDENTITY_NOT_FOUND"
      | "MCP_AGENT_CONTROLLER_NOT_FOUND"
      | "MCP_AGENT_CONTROLLER_IN_USE"
      | "MCP_AGENT_ALREADY_ACTIVE"
      | "MCP_AGENT_ALREADY_SEATED",
    message: string,
    readonly details: McpAgentIdentityErrorDetails = {},
  ) {
    super(message);
    this.name = "McpAgentIdentityError";
  }
}

export type DeleteMcpAgentSeatResult =
  | { deleted: true; seat: McpAgentSeat }
  | { deleted: false; reason: "not_found" | "active_room"; roomId?: string };

export interface DeleteAllMcpAgentSeatsResult {
  deletedCount: number;
  preservedActiveCount: number;
}

type McpAgentSeatRow = {
  id: string;
  owner_user_id: string;
  codename: string;
  client_id: string | null;
  environment_label: string;
  created_at: number;
  last_used_at: number | null;
};

type ManagedMcpAgentSeatRow = McpAgentSeatRow & {
  has_room_history: number;
  is_active: number;
};

function seatFromRow(row: McpAgentSeatRow): McpAgentSeat {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    codename: row.codename,
    clientId: row.client_id,
    environmentLabel: row.environment_label || "MCP Agent",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function environmentLabelFromClientName(clientName: string | null): string {
  const value = clientName?.toLowerCase() ?? "";

  if (value.includes("codex")) return "Codex";

  if (value.includes("claude")) return "Claude";

  if (value.includes("cursor")) return "Cursor";

  if (value.includes("grok")) return "Grok";

  if (value.includes("chatgpt")) return "ChatGPT";

  if (value.includes("gemini")) return "Gemini";

  return "MCP Agent";
}

async function resolveEnvironmentLabel(db: D1Database, clientId?: string | null): Promise<string> {
  if (!clientId) return "MCP Agent";

  const client = await db
    .prepare("SELECT client_name FROM oauth_clients WHERE client_id = ? LIMIT 1")
    .bind(clientId)
    .first<{ client_name: string | null }>();

  return environmentLabelFromClientName(client?.client_name ?? null);
}

/** Update a reused identity to show the MCP host that currently controls it. */
export async function assignMcpAgentSeatClient(
  db: D1Database,
  seat: McpAgentSeat,
  clientId?: string | null,
): Promise<McpAgentSeat> {
  if (!clientId || seat.clientId === clientId) return seat;
  const environmentLabel = await resolveEnvironmentLabel(db, clientId);
  await db
    .prepare("UPDATE mcp_agent_seats SET client_id = ?, environment_label = ? WHERE id = ?")
    .bind(clientId, environmentLabel, seat.id)
    .run();

  return { ...seat, clientId, environmentLabel };
}

async function codenameTaken(db: D1Database, codename: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT id FROM mcp_agent_seats WHERE lower(codename) = lower(?) LIMIT 1`)
    .bind(codename)
    .first();

  return Boolean(row);
}

async function mintUniqueCodename(db: D1Database): Promise<string> {
  for (let i = 0; i < 32; i++) {
    const name = generateCodename();

    if (!(await codenameTaken(db, name))) return name;
  }

  // Extremely unlikely
  for (let i = 0; i < 16; i++) {
    const name = generateUniqueCodename([]);

    if (!(await codenameTaken(db, name))) return name;
  }

  return `${generateCodename()}${Date.now().toString(36)}`;
}

/**
 * Create a new MCP agent identity owned by the OAuth (or session) user.
 */
export async function createMcpAgentSeat(
  db: D1Database,
  ownerUserId: string,
  clientId?: string | null,
): Promise<McpAgentSeat> {
  const now = Math.floor(Date.now() / 1000);
  const staleBefore = now - 30 * 24 * 60 * 60;
  await db
    .prepare(
      `DELETE FROM mcp_agent_seats
     WHERE owner_user_id = ? AND COALESCE(last_used_at, created_at) < ?
       AND NOT EXISTS (
         SELECT 1 FROM mcp_agent_controllers AS controllers
         WHERE controllers.agent_id = mcp_agent_seats.id
       )`,
    )
    .bind(ownerUserId, staleBefore)
    .run();

  let current = await db
    .prepare(`SELECT COUNT(*) AS count FROM mcp_agent_seats WHERE owner_user_id = ?`)
    .bind(ownerUserId)
    .first<{ count: number }>();

  if ((current?.count ?? 0) >= MCP_AGENT_IDENTITY_LIMIT) {
    const reclaimCount = (current?.count ?? 0) - MCP_AGENT_IDENTITY_LIMIT + 1;
    const unusedBefore = now - MCP_AGENT_UNUSED_CLAIM_GRACE_SECONDS;
    await db
      .prepare(
        `DELETE FROM mcp_agent_seats
       WHERE id IN (
         SELECT seats.id
         FROM mcp_agent_seats AS seats
         WHERE seats.owner_user_id = ?
           AND seats.created_at < ?
           AND NOT EXISTS (
             SELECT 1 FROM mcp_room_players AS room_players
             WHERE room_players.agent_id = seats.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM mcp_agent_controllers AS controllers
             WHERE controllers.agent_id = seats.id
           )
         ORDER BY COALESCE(seats.last_used_at, seats.created_at) ASC,
                  seats.created_at ASC
         LIMIT ?
       )`,
      )
      .bind(ownerUserId, unusedBefore, reclaimCount)
      .run();
    current = await db
      .prepare(`SELECT COUNT(*) AS count FROM mcp_agent_seats WHERE owner_user_id = ?`)
      .bind(ownerUserId)
      .first<{ count: number }>();
  }

  if ((current?.count ?? 0) >= MCP_AGENT_IDENTITY_LIMIT) {
    throw new McpAgentIdentityError(
      "MCP_AGENT_IDENTITY_LIMIT",
      `This account has ${MCP_AGENT_IDENTITY_LIMIT} stored agent identities. Reuse an existing identity instead of claiming another one.`,
      {
        count: current?.count ?? MCP_AGENT_IDENTITY_LIMIT,
        limit: MCP_AGENT_IDENTITY_LIMIT,
        recoveryTools: ["agent_claim"],
        retryAfterSeconds: 10 * 60,
      },
    );
  }

  const id = crypto.randomUUID();
  const codename = await mintUniqueCodename(db);
  const environmentLabel = await resolveEnvironmentLabel(db, clientId);

  await db
    .prepare(
      `INSERT INTO mcp_agent_seats
       (id, owner_user_id, codename, client_id, environment_label, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, ownerUserId, codename, clientId ?? null, environmentLabel, now, now)
    .run();

  return {
    id,
    ownerUserId,
    codename,
    clientId: clientId ?? null,
    environmentLabel,
    createdAt: now,
    lastUsedAt: now,
  };
}

/**
 * Recent MCP seats for the owner's profile activity list.
 * This exposes seat metadata only; game state and action payloads stay in the room.
 */
export async function listOwnedMcpAgentSeats(
  db: D1Database,
  ownerUserId: string,
  limit = 20,
): Promise<McpAgentSeat[]> {
  const safeLimit = Math.max(1, Math.min(32, Math.floor(limit)));
  const activeSince = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

  const result = await db
    .prepare(
      `SELECT id, owner_user_id, codename, client_id, environment_label, created_at, last_used_at
       FROM mcp_agent_seats
       WHERE owner_user_id = ? AND COALESCE(last_used_at, created_at) >= ?
       ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC
       LIMIT ?`,
    )
    .bind(ownerUserId, activeSince, safeLimit)
    .all<McpAgentSeatRow>();

  return (result.results ?? []).map(seatFromRow);
}

/** All stored identities for the signed-in owner's web management page. */
export async function listManagedMcpAgentSeats(
  db: D1Database,
  ownerUserId: string,
  now = Date.now(),
): Promise<ManagedMcpAgentSeat[]> {
  const result = await db
    .prepare(
      `SELECT seats.id, seats.owner_user_id, seats.codename, seats.client_id,
              seats.environment_label, seats.created_at, seats.last_used_at,
              EXISTS (
                SELECT 1 FROM mcp_room_players AS room_history
                WHERE room_history.agent_id = seats.id
              ) AS has_room_history,
              EXISTS (
                SELECT 1
                FROM mcp_room_players AS room_players
                JOIN mcp_live_rooms AS rooms ON rooms.room_id = room_players.room_id
                WHERE room_players.agent_id = seats.id
                  AND rooms.status IN ('creating', 'active')
                  AND rooms.expires_at > ?
              ) AS is_active
       FROM mcp_agent_seats AS seats
       WHERE seats.owner_user_id = ?
       ORDER BY COALESCE(seats.last_used_at, seats.created_at) DESC,
                seats.created_at DESC
       LIMIT ?`,
    )
    .bind(now, ownerUserId, MCP_AGENT_IDENTITY_LIMIT)
    .all<ManagedMcpAgentSeatRow>();

  return (result.results ?? []).map((row) => ({
    ...seatFromRow(row),
    hasRoomHistory: Boolean(row.has_room_history),
    isActive: Boolean(row.is_active),
  }));
}

/** Return a live room occupied by this identity, excluding an allowed reconnect. */
export async function getActiveRoomForMcpAgent(
  db: D1Database,
  ownerUserId: string,
  agentId: string,
  allowedRoomId?: string,
  now = Date.now(),
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT room_players.room_id
       FROM mcp_room_players AS room_players
       JOIN mcp_agent_seats AS seats ON seats.id = room_players.agent_id
       JOIN mcp_live_rooms AS rooms ON rooms.room_id = room_players.room_id
       WHERE seats.owner_user_id = ?
         AND seats.id = ?
         AND rooms.status IN ('creating', 'active')
         AND rooms.expires_at > ?
         AND (? IS NULL OR room_players.room_id <> ?)
       ORDER BY room_players.last_used_at DESC
       LIMIT 1`,
    )
    .bind(ownerUserId, agentId, now, allowedRoomId ?? null, allowedRoomId ?? null)
    .first<{ room_id: string }>();

  return row?.room_id ?? null;
}

/** Prevent two independent game loops from controlling one persistent identity. */
export async function requireMcpAgentAvailable(
  db: D1Database,
  ownerUserId: string,
  agentId: string,
  allowedRoomId?: string,
): Promise<void> {
  const roomId = await getActiveRoomForMcpAgent(db, ownerUserId, agentId, allowedRoomId);

  if (!roomId) return;

  if (roomId.startsWith("series-"))
    throw new McpAgentIdentityError(
      "MCP_AGENT_ALREADY_ACTIVE",
      "This identity is reserved by an active series. Resume it with series_status or claim a different controller for another task.",
      { seriesCode: roomId.slice(7), recoveryTools: ["series_status"] },
    );
  throw new McpAgentIdentityError(
    "MCP_AGENT_ALREADY_ACTIVE",
    "This agent identity is already seated in a live room. Reconnect to that room or claim a different identity for another concurrent agent.",
    { roomId },
  );
}

/** Delete an owner-selected identity only when it is not part of a live room. */
export async function deleteOwnedMcpAgentSeat(
  db: D1Database,
  ownerUserId: string,
  agentId: string,
  now = Date.now(),
): Promise<DeleteMcpAgentSeatResult> {
  const deleted = await db
    .prepare(
      `DELETE FROM mcp_agent_seats
       WHERE id = ? AND owner_user_id = ?
         AND NOT EXISTS (
           SELECT 1
           FROM mcp_room_players AS room_players
           JOIN mcp_live_rooms AS rooms ON rooms.room_id = room_players.room_id
           WHERE room_players.agent_id = mcp_agent_seats.id
             AND rooms.status IN ('creating', 'active')
             AND rooms.expires_at > ?
         )
       RETURNING id, owner_user_id, codename, client_id, environment_label,
                 created_at, last_used_at`,
    )
    .bind(agentId, ownerUserId, now)
    .first<McpAgentSeatRow>();

  if (deleted) return { deleted: true, seat: seatFromRow(deleted) };

  const owned = await db
    .prepare(
      `SELECT id FROM mcp_agent_seats
       WHERE id = ? AND owner_user_id = ? LIMIT 1`,
    )
    .bind(agentId, ownerUserId)
    .first<{ id: string }>();

  if (!owned) return { deleted: false, reason: "not_found" };

  const roomId = await getActiveRoomForMcpAgent(db, ownerUserId, agentId, undefined, now);

  return { deleted: false, reason: "active_room", roomId: roomId ?? undefined };
}

/** Delete from the web UI without sending the private agentId to the browser. */
export async function deleteOwnedMcpAgentSeatByCodename(
  db: D1Database,
  ownerUserId: string,
  codename: string,
  now = Date.now(),
): Promise<DeleteMcpAgentSeatResult> {
  const owned = await db
    .prepare(
      `SELECT id FROM mcp_agent_seats
       WHERE owner_user_id = ? AND codename = ? LIMIT 1`,
    )
    .bind(ownerUserId, codename)
    .first<{ id: string }>();

  if (!owned) return { deleted: false, reason: "not_found" };

  return deleteOwnedMcpAgentSeat(db, ownerUserId, owned.id, now);
}

/** Delete every owner identity except identities currently in live rooms. */
export async function deleteAllOwnedMcpAgentSeats(
  db: D1Database,
  ownerUserId: string,
  now = Date.now(),
): Promise<DeleteAllMcpAgentSeatsResult> {
  const deleted = await db
    .prepare(
      `DELETE FROM mcp_agent_seats
       WHERE owner_user_id = ?
         AND NOT EXISTS (
           SELECT 1
           FROM mcp_room_players AS room_players
           JOIN mcp_live_rooms AS rooms ON rooms.room_id = room_players.room_id
           WHERE room_players.agent_id = mcp_agent_seats.id
             AND rooms.status IN ('creating', 'active')
             AND rooms.expires_at > ?
         )`,
    )
    .bind(ownerUserId, now)
    .run();

  const remaining = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM mcp_agent_seats
       WHERE owner_user_id = ?`,
    )
    .bind(ownerUserId)
    .first<{ count: number }>();

  return {
    deletedCount: deleted.meta.changes,
    preservedActiveCount: remaining?.count ?? 0,
  };
}

/**
 * Load a seat; returns null if missing or not owned by ownerUserId.
 */
async function getOwnedMcpAgentSeat(
  db: D1Database,
  agentId: string,
  ownerUserId: string,
): Promise<McpAgentSeat | null> {
  const row = await db
    .prepare(
      `SELECT id, owner_user_id, codename, client_id, environment_label, created_at, last_used_at
       FROM mcp_agent_seats
       WHERE id = ? AND owner_user_id = ?`,
    )
    .bind(agentId, ownerUserId)
    .first<McpAgentSeatRow>();

  if (!row) return null;

  await db
    .prepare(`UPDATE mcp_agent_seats SET last_used_at = unixepoch() WHERE id = ?`)
    .bind(agentId)
    .run();

  return seatFromRow(row);
}

/**
 * Resolve seat for a tool call: reuse agentId if valid, otherwise mint a new one.
 */
export async function resolveMcpAgentSeat(
  db: D1Database,
  ownerUserId: string,
  agentId?: string | null,
  clientId?: string | null,
): Promise<{ seat: McpAgentSeat; created: boolean }> {
  if (agentId?.trim()) {
    let existing = await getOwnedMcpAgentSeat(db, agentId.trim(), ownerUserId);

    if (!existing) {
      throw new McpAgentIdentityError(
        "MCP_AGENT_IDENTITY_NOT_FOUND",
        "Unknown agentId for this account. Call agent_list to recover an existing identity or agent_claim to create a new one.",
        { recoveryTools: ["agent_list", "agent_claim"] },
      );
    }

    // Seats created before environment metadata existed get it on first reuse.
    if (!existing.clientId && clientId) {
      existing = await assignMcpAgentSeatClient(db, existing, clientId);
    }

    return { seat: existing, created: false };
  }

  const seat = await createMcpAgentSeat(db, ownerUserId, clientId);

  return { seat, created: true };
}
