/**
 * Server-assigned controllers for MCP agent identities.
 *
 * MCP hosts receive controllerId, never agentId. A controller exclusively
 * leases one persistent identity so concurrent AI tasks cannot select the same
 * seat. Expired controllers are recycled when their identity is not in a live
 * room.
 */

import type { D1Database } from "@cloudflare/workers-types";
import {
  assignMcpAgentSeatClient,
  createMcpAgentSeat,
  McpAgentIdentityError,
  type McpAgentSeat,
} from "./mcpAgentSeats";

export const MCP_AGENT_CONTROLLER_TTL_SECONDS = 10 * 60;

const MCP_AGENT_WAIT_LEASE_SECONDS = 35;

export interface McpAgentController {
  id: string;
  seat: McpAgentSeat;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}

type ControllerSeatRow = {
  controller_id: string;
  agent_id: string;
  owner_user_id: string;
  codename: string;
  client_id: string | null;
  environment_label: string;
  seat_created_at: number;
  seat_last_used_at: number | null;
  controller_created_at: number;
  controller_last_used_at: number;
  expires_at: number;
};

function controllerFromRow(row: ControllerSeatRow): McpAgentController {
  return {
    id: row.controller_id,
    seat: {
      id: row.agent_id,
      ownerUserId: row.owner_user_id,
      codename: row.codename,
      clientId: row.client_id,
      environmentLabel: row.environment_label || "MCP Agent",
      createdAt: row.seat_created_at,
      lastUsedAt: row.seat_last_used_at,
    },
    createdAt: row.controller_created_at,
    lastUsedAt: row.controller_last_used_at,
    expiresAt: row.expires_at,
  };
}

async function removeExpiredIdleControllers(
  db: D1Database,
  ownerUserId: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM mcp_agent_controllers
       WHERE owner_user_id = ?
         AND expires_at <= ?
         AND NOT EXISTS (
           SELECT 1
           FROM mcp_room_players AS room_players
           JOIN mcp_live_rooms AS rooms ON rooms.room_id = room_players.room_id
           WHERE room_players.agent_id = mcp_agent_controllers.agent_id
             AND rooms.status IN ('creating', 'active')
             AND rooms.expires_at > ?
         )`,
    )
    .bind(ownerUserId, now, now * 1000)
    .run();
}

async function leaseExistingSeat(
  db: D1Database,
  ownerUserId: string,
  controllerId: string,
  clientId: string | null | undefined,
  now: number,
): Promise<McpAgentController | null> {
  const expiresAt = now + MCP_AGENT_CONTROLLER_TTL_SECONDS;

  const inserted = await db
    .prepare(
      `INSERT INTO mcp_agent_controllers (
         controller_id, owner_user_id, agent_id, client_id,
         created_at, last_used_at, expires_at
       )
       SELECT ?, seats.owner_user_id, seats.id, ?, ?, ?, ?
       FROM mcp_agent_seats AS seats
       WHERE seats.owner_user_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM mcp_agent_controllers AS controllers
           WHERE controllers.agent_id = seats.id
         )
         AND NOT EXISTS (
           SELECT 1
           FROM mcp_room_players AS room_players
           JOIN mcp_live_rooms AS rooms ON rooms.room_id = room_players.room_id
           WHERE room_players.agent_id = seats.id
             AND rooms.status IN ('creating', 'active')
             AND rooms.expires_at > ?
         )
       ORDER BY COALESCE(seats.last_used_at, seats.created_at) ASC,
                seats.created_at ASC
       LIMIT 1
       ON CONFLICT DO NOTHING
       RETURNING agent_id`,
    )
    .bind(controllerId, clientId ?? null, now, now, expiresAt, ownerUserId, now * 1000)
    .first<{ agent_id: string }>();

  if (!inserted) return null;

  const row = await db
    .prepare(
      `SELECT controllers.controller_id, controllers.agent_id,
              controllers.owner_user_id, seats.codename, seats.client_id,
              seats.environment_label, seats.created_at AS seat_created_at,
              seats.last_used_at AS seat_last_used_at,
              controllers.created_at AS controller_created_at,
              controllers.last_used_at AS controller_last_used_at,
              controllers.expires_at
       FROM mcp_agent_controllers AS controllers
       JOIN mcp_agent_seats AS seats ON seats.id = controllers.agent_id
       WHERE controllers.controller_id = ?
         AND controllers.owner_user_id = ?
       LIMIT 1`,
    )
    .bind(controllerId, ownerUserId)
    .first<ControllerSeatRow>();

  if (!row) return null;
  const controller = controllerFromRow(row);
  controller.seat = await assignMcpAgentSeatClient(db, controller.seat, clientId);

  return controller;
}

async function leaseSeat(
  db: D1Database,
  ownerUserId: string,
  seat: McpAgentSeat,
  controllerId: string,
  clientId: string | null | undefined,
  now: number,
): Promise<McpAgentController | null> {
  const expiresAt = now + MCP_AGENT_CONTROLLER_TTL_SECONDS;

  const inserted = await db
    .prepare(
      `INSERT INTO mcp_agent_controllers (
         controller_id, owner_user_id, agent_id, client_id,
         created_at, last_used_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(controllerId, ownerUserId, seat.id, clientId ?? null, now, now, expiresAt)
    .run();

  if (!inserted.meta.changes) return null;

  return {
    id: controllerId,
    seat,
    createdAt: now,
    lastUsedAt: now,
    expiresAt,
  };
}

/** Assign one idle identity to a fresh, server-generated controller. */
export async function acquireMcpAgentController(
  db: D1Database,
  ownerUserId: string,
  clientId?: string | null,
): Promise<{ controller: McpAgentController; identityCreated: boolean }> {
  const now = Math.floor(Date.now() / 1000);
  await removeExpiredIdleControllers(db, ownerUserId, now);

  for (let attempt = 0; attempt < 4; attempt++) {
    const existing = await leaseExistingSeat(db, ownerUserId, crypto.randomUUID(), clientId, now);

    if (existing) return { controller: existing, identityCreated: false };
  }

  const seat = await createMcpAgentSeat(db, ownerUserId, clientId);

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = await leaseSeat(db, ownerUserId, seat, crypto.randomUUID(), clientId, now);

    if (controller) return { controller, identityCreated: true };
  }

  throw new Error("Could not assign an agent identity to this controller");
}

/** Resolve and renew a controller without exposing its underlying agentId. */
export async function resolveMcpAgentController(
  db: D1Database,
  ownerUserId: string,
  controllerId: string,
): Promise<McpAgentController> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + MCP_AGENT_CONTROLLER_TTL_SECONDS;

  const renewed = await db
    .prepare(
      `UPDATE mcp_agent_controllers
       SET last_used_at = ?, expires_at = ?
       WHERE controller_id = ? AND owner_user_id = ?
         AND (
           expires_at > ? OR EXISTS (
             SELECT 1
             FROM mcp_room_players AS room_players
             JOIN mcp_live_rooms AS rooms ON rooms.room_id = room_players.room_id
             WHERE room_players.agent_id = mcp_agent_controllers.agent_id
               AND rooms.status IN ('creating', 'active')
               AND rooms.expires_at > ?
           )
         )
       RETURNING agent_id`,
    )
    .bind(now, expiresAt, controllerId, ownerUserId, now, now * 1000)
    .first<{ agent_id: string }>();

  if (!renewed) {
    throw new McpAgentIdentityError(
      "MCP_AGENT_CONTROLLER_NOT_FOUND",
      "This task controller is missing or expired. Call agent_claim once to receive a new server-assigned controller.",
      { recoveryTools: ["agent_claim"] },
    );
  }

  const row = await db
    .prepare(
      `SELECT controllers.controller_id, controllers.agent_id,
              controllers.owner_user_id, seats.codename, seats.client_id,
              seats.environment_label, seats.created_at AS seat_created_at,
              seats.last_used_at AS seat_last_used_at,
              controllers.created_at AS controller_created_at,
              controllers.last_used_at AS controller_last_used_at,
              controllers.expires_at
       FROM mcp_agent_controllers AS controllers
       JOIN mcp_agent_seats AS seats ON seats.id = controllers.agent_id
       WHERE controllers.controller_id = ?
         AND controllers.owner_user_id = ?
       LIMIT 1`,
    )
    .bind(controllerId, ownerUserId)
    .first<ControllerSeatRow>();

  if (!row) {
    throw new McpAgentIdentityError(
      "MCP_AGENT_CONTROLLER_NOT_FOUND",
      "This task controller no longer has an agent identity. Call agent_claim once to receive a new server-assigned controller.",
      { recoveryTools: ["agent_claim"] },
    );
  }

  await db
    .prepare("UPDATE mcp_agent_seats SET last_used_at = ? WHERE id = ?")
    .bind(now, renewed.agent_id)
    .run();

  return controllerFromRow(row);
}

/** Prevent copied controllers from opening two concurrent waits as one player. */
export async function acquireMcpAgentWaitLease(
  db: D1Database,
  ownerUserId: string,
  controllerId: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const waitToken = crypto.randomUUID();

  const acquired = await db
    .prepare(
      `UPDATE mcp_agent_controllers
       SET active_wait_token = ?, active_wait_expires_at = ?
       WHERE controller_id = ? AND owner_user_id = ?
         AND (active_wait_token IS NULL OR active_wait_expires_at <= ?)
       RETURNING controller_id`,
    )
    .bind(waitToken, now + MCP_AGENT_WAIT_LEASE_SECONDS, controllerId, ownerUserId, now)
    .first<{ controller_id: string }>();

  if (acquired) return waitToken;

  throw new McpAgentIdentityError(
    "MCP_AGENT_CONTROLLER_IN_USE",
    "Another AI task is already waiting with this controller. This task must call agent_claim once and use its own server-assigned controller.",
    {
      recoveryTools: ["agent_claim"],
      instruction:
        "Do not retry wait_for_turn with this copied controllerId. Acquire a new controller for this AI task.",
    },
  );
}

export async function releaseMcpAgentWaitLease(
  db: D1Database,
  ownerUserId: string,
  controllerId: string,
  waitToken: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE mcp_agent_controllers
       SET active_wait_token = NULL, active_wait_expires_at = NULL
       WHERE controller_id = ? AND owner_user_id = ?
         AND active_wait_token = ?`,
    )
    .bind(controllerId, ownerUserId, waitToken)
    .run();
}
