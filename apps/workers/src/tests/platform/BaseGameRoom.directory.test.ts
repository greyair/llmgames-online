import { roomTestEnv } from "../fixtures/room-env";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";

import { describe, expect, it, vi } from "vitest";
import { Connect4Room } from "../../durable-objects/Connect4Room";
import type { BaseGameState } from "../../durable-objects/types";

class DirectoryRoom extends Connect4Room {
  protected restoreSessions(): void {}
  protected startingPlayerIndex(): number {
    return 0;
  }
}

function harness() {
  const storage = new Map<string, unknown>();
  const state = new MemoryRoomRuntime(storage, () => undefined);
  const env = roomTestEnv();

  return { room: new DirectoryRoom(state, env), state, storage, env };
}

function post<T>(room: DirectoryRoom, route: string, body: T): Promise<Response> {
  return room.fetch(
    new Request(`https://room.test${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function snapshot(storage: Map<string, unknown>): Promise<BaseGameState> {
  // SAFETY: the harness creates a room, so a persisted BaseGameState is present.
  return (await Promise.resolve(storage.get("gameState"))) as BaseGameState;
}

describe("room directory extension", () => {
  it("marks a failed extension and repairs it on the next save", async () => {
    const test = harness();
    await test.state.initialized;
    await post(test.room, "/create", { hostId: "host", hostName: "Host", roomCode: "ABC234" });
    await post(test.room, "/agent/join", { playerId: "guest", assignedCodename: "SwiftAnchor" });

    const created = await snapshot(test.storage);
    // snapshot() returns the live state object, so keep the lobby values now.
    const lobbyExpiry = created.expiresAt;
    const createdAt = created.createdAt;

    // Seed the directory row the public create route would have activated.
    await test.env.DB.prepare(
      `INSERT INTO active_rooms (room_code, game_type, room_id, status, expires_at, created_at)
       VALUES ('ABC234', 'connect4', 'connect4-ABC234', 'active', ?, ?)`,
    )
      .bind(lobbyExpiry, createdAt)
      .run();

    const db = test.env.DB;
    const originalPrepare = db.prepare.bind(db);
    const failures: number[] = [];

    const spy = vi.spyOn(db, "prepare").mockImplementation((query) => {
      if (query.includes("UPDATE active_rooms")) {
        failures.push(1);
        throw new Error("D1 unavailable");
      }

      return originalPrepare(query);
    });

    try {
      expect((await post(test.room, "/agent/start", { playerId: "host" })).status).toBe(200);
    } finally {
      spy.mockRestore();
    }

    // The room keeps playing even though the directory write failed.
    const started = await snapshot(test.storage);
    expect(started.status).toBe("playing");
    // Starting a short match never shortens the lobby deadline.
    expect(started.expiresAt).toBeGreaterThanOrEqual(lobbyExpiry);
    expect(failures.length).toBeGreaterThan(0);
    expect(test.storage.get("directoryExpiryPending")).toBe(true);

    // Any later save retries; the row catches up without another phase change.
    await post(test.room, "/agent/action", {
      playerId: "host",
      actionType: "drop_disc",
      data: { col: 0 },
    });

    const row = await test.env.DB.prepare(
      "SELECT expires_at FROM active_rooms WHERE room_code = 'ABC234'",
    ).first<{ expires_at: number }>();

    expect(row?.expires_at).toBe(started.expiresAt);
    expect(test.storage.get("directoryExpiryPending")).toBe(false);
  });

  it("recreates a directory row that disappeared while the room was live", async () => {
    const test = harness();
    await test.state.initialized;
    await post(test.room, "/create", { hostId: "host", hostName: "Host", roomCode: "AB2345" });
    await post(test.room, "/agent/join", { playerId: "guest", assignedCodename: "SwiftAnchor" });

    // No directory row at all: the extension must not fail silently.
    expect((await post(test.room, "/agent/start", { playerId: "host" })).status).toBe(200);

    const started = await snapshot(test.storage);

    const row = await test.env.DB.prepare(
      "SELECT expires_at, status FROM active_rooms WHERE room_code = 'AB2345'",
    ).first<{ expires_at: number; status: string }>();

    expect(row).toMatchObject({ expires_at: started.expiresAt, status: "active" });
  });
});
