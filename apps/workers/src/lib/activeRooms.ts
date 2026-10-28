import type { D1Database } from "@cloudflare/workers-types";
import { roomIdFor, type GameType } from "./roomRouting";

export type ActiveRoomStatus = "creating" | "active";

export interface ActiveRoomEntry {
  roomCode: string;
  gameType: GameType;
  roomId: string;
  status: ActiveRoomStatus;
  expiresAt: number;
  createdAt: number;
}

type ActiveRoomRow = {
  room_code: string;
  game_type: GameType;
  room_id: string;
  status: ActiveRoomStatus;
  expires_at: number;
  created_at: number;
};

function entryFromRow(row: ActiveRoomRow): ActiveRoomEntry {
  return {
    roomCode: row.room_code,
    gameType: row.game_type,
    roomId: row.room_id,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Atomically reserves one code across every game namespace. Expired rows may be
 * replaced; an unexpired code remains owned by its existing room.
 */
export async function reserveRoomCode(
  db: D1Database,
  gameType: GameType,
  roomCode: string,
  expiresAt: number,
  now = Date.now(),
): Promise<ActiveRoomEntry | null> {
  const code = roomCode.toUpperCase();
  const roomId = roomIdFor(gameType, code);

  const row = await db
    .prepare(
      `INSERT INTO active_rooms (
         room_code, game_type, room_id, status, expires_at, created_at
       ) VALUES (?, ?, ?, 'creating', ?, ?)
       ON CONFLICT(room_code) DO UPDATE SET
         game_type = excluded.game_type,
         room_id = excluded.room_id,
         status = excluded.status,
         expires_at = excluded.expires_at,
         created_at = excluded.created_at
       WHERE active_rooms.expires_at <= ?
       RETURNING room_code, game_type, room_id, status, expires_at, created_at`,
    )
    .bind(code, gameType, roomId, expiresAt, now, now)
    .first<ActiveRoomRow>();

  return row ? entryFromRow(row) : null;
}

/** Make a successfully-created Durable Object visible to room-code lookups. */
export async function activateRoomCode(
  db: D1Database,
  roomCode: string,
  roomId: string,
  expiresAt: number,
): Promise<void> {
  const activated = await db
    .prepare(
      `UPDATE active_rooms
       SET status = 'active', expires_at = ?
       WHERE room_code = ? AND room_id = ? AND status = 'creating'
       RETURNING room_code`,
    )
    .bind(expiresAt, roomCode.toUpperCase(), roomId)
    .first<{ room_code: string }>();

  if (!activated) {
    throw new Error("Could not activate room code");
  }
}

/** Why a directory extension did or did not change the row. */
export type RoomExtendResult = "extended" | "current" | "missing";

/**
 * Publish a new expiry for an active room. The update only moves forward, so a
 * late retry from an old room can never shorten or steal a reused room code.
 */
export async function extendRoomCode(
  db: D1Database,
  roomCode: string,
  roomId: string,
  expiresAt: number,
): Promise<RoomExtendResult> {
  const code = roomCode.toUpperCase();

  const extended = await db
    .prepare(
      `UPDATE active_rooms
       SET expires_at = ?
       WHERE room_code = ? AND room_id = ? AND status = 'active' AND expires_at < ?
       RETURNING room_code`,
    )
    .bind(expiresAt, code, roomId, expiresAt)
    .first<{ room_code: string }>();

  if (extended) return "extended";

  const row = await db
    .prepare(
      `SELECT expires_at FROM active_rooms
       WHERE room_code = ? AND room_id = ? AND status = 'active'
       LIMIT 1`,
    )
    .bind(code, roomId)
    .first<{ expires_at: number }>();

  return row ? "current" : "missing";
}

/** Resolve a bare room code without touching or joining a game Durable Object. */
export async function resolveRoomCode(
  db: D1Database,
  roomCode: string,
  now = Date.now(),
): Promise<ActiveRoomEntry | null> {
  const row = await db
    .prepare(
      `SELECT room_code, game_type, room_id, status, expires_at, created_at
       FROM active_rooms
       WHERE room_code = ? AND status = 'active' AND expires_at > ?
       LIMIT 1`,
    )
    .bind(roomCode.toUpperCase(), now)
    .first<ActiveRoomRow>();

  return row ? entryFromRow(row) : null;
}

/** Release only the directory entry owned by this exact Durable Object. */
export async function releaseRoomCode(
  db: D1Database,
  roomCode: string,
  roomId: string,
  expectedExpiresAt?: number,
): Promise<void> {
  const query = db.prepare(
    `DELETE FROM active_rooms WHERE room_code = ? AND room_id = ?${
      expectedExpiresAt === undefined ? "" : " AND status = 'active' AND expires_at = ?"
    }`,
  );

  await (
    expectedExpiresAt === undefined
      ? query.bind(roomCode.toUpperCase(), roomId)
      : query.bind(roomCode.toUpperCase(), roomId, expectedExpiresAt)
  ).run();
}
