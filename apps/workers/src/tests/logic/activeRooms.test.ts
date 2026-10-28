import { DatabaseSync } from "node:sqlite";
import { RecordingSQLiteD1 } from "../fixtures/recording-db";

import { describe, expect, it } from "vitest";
import {
  activateRoomCode,
  extendRoomCode,
  releaseRoomCode,
  reserveRoomCode,
  resolveRoomCode,
} from "../../lib/activeRooms";

type DirectoryRow = {
  room_code: string;
  game_type: string;
  room_id: string;
  status: string;
  expires_at: number;
  created_at: number;
};

function fakeDb(row?: DirectoryRow) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE active_rooms(room_code TEXT PRIMARY KEY, game_type TEXT, room_id TEXT UNIQUE, status TEXT, expires_at INTEGER, created_at INTEGER)",
  );

  if (row)
    sqlite
      .prepare("INSERT INTO active_rooms VALUES (?,?,?,?,?,?)")
      .run(row.room_code, row.game_type, row.room_id, row.status, row.expires_at, row.created_at);
  const db = new RecordingSQLiteD1(sqlite);

  return { db, calls: db.calls };
}

describe("active room directory", () => {
  it("normalizes reservations and derives the canonical room id", async () => {
    const { db, calls } = fakeDb();

    const entry = await reserveRoomCode(db, "poker", "po2345", 5000, 1000);
    expect(entry).toEqual({
      roomCode: "PO2345",
      gameType: "poker",
      roomId: "poker-PO2345",
      status: "creating",
      expiresAt: 5000,
      createdAt: 1000,
    });
    expect(calls[0]!.args).toEqual(["PO2345", "poker", "poker-PO2345", 5000, 1000, 1000]);
  });

  it("returns null when an unexpired code cannot be reserved", async () => {
    const { db } = fakeDb({
      room_code: "AB2345",
      game_type: "connect4",
      room_id: "connect4-AB2345",
      status: "active",
      expires_at: 9000,
      created_at: 0,
    });

    await expect(reserveRoomCode(db, "reversi", "AB2345", 5000, 1000)).resolves.toBeNull();
  });

  it("requires activation to update the exact creating room", async () => {
    const { db, calls } = fakeDb({
      room_code: "AB2345",
      game_type: "reversi",
      room_id: "reversi-AB2345",
      status: "creating",
      expires_at: 5000,
      created_at: 1000,
    });

    await expect(activateRoomCode(db, "ab2345", "reversi-AB2345", 9000)).resolves.toBeUndefined();
    expect(calls[0]!.args).toEqual([9000, "AB2345", "reversi-AB2345"]);

    const missing = fakeDb();
    await expect(activateRoomCode(missing.db, "AB2345", "reversi-AB2345", 9000)).rejects.toThrow(
      "Could not activate room code",
    );
  });

  it("guards late room cleanup against a newer reservation using the same code", async () => {
    const { db, calls } = fakeDb();
    await releaseRoomCode(db, "ab2345", "reversi-AB2345", 9000);
    expect(calls[0]!.sql).toContain("AND status = 'active' AND expires_at = ?");
    expect(calls[0]!.args).toEqual(["AB2345", "reversi-AB2345", 9000]);
  });

  it("extends only the active row it owns and keeps cleanup exact", async () => {
    const { db, calls } = fakeDb({
      room_code: "AB2345",
      game_type: "poker",
      room_id: "poker-AB2345",
      status: "active",
      expires_at: 9000,
      created_at: 1000,
    });

    await expect(extendRoomCode(db, "ab2345", "poker-AB2345", 90_000)).resolves.toBe(true);
    expect(calls[0]!.sql).toContain("AND status = 'active'");
    expect(calls[0]!.args).toEqual([90_000, "AB2345", "poker-AB2345"]);

    // The extended row stays resolvable until cleanup releases that exact expiry.
    await expect(resolveRoomCode(db, "ab2345", 20_000)).resolves.not.toBeNull();
    await releaseRoomCode(db, "ab2345", "poker-AB2345", 90_000);
    await expect(resolveRoomCode(db, "ab2345", 20_000)).resolves.toBeNull();
  });

  it("reports when there is no active row to extend", async () => {
    const { db } = fakeDb({
      room_code: "AB2345",
      game_type: "poker",
      room_id: "poker-AB2345",
      status: "creating",
      expires_at: 9000,
      created_at: 1000,
    });

    await expect(extendRoomCode(db, "AB2345", "poker-AB2345", 90_000)).resolves.toBe(false);
  });

  it("maps live lookups and releases only the matching room", async () => {
    const { db, calls } = fakeDb({
      room_code: "AB2345",
      game_type: "reversi",
      room_id: "reversi-AB2345",
      status: "active",
      expires_at: 9000,
      created_at: 1000,
    });

    await expect(resolveRoomCode(db, "ab2345", 5000)).resolves.toMatchObject({
      roomCode: "AB2345",
      gameType: "reversi",
      roomId: "reversi-AB2345",
    });
    await releaseRoomCode(db, "ab2345", "reversi-AB2345");
    expect(calls.at(-1)!.args).toEqual(["AB2345", "reversi-AB2345"]);
  });
});
