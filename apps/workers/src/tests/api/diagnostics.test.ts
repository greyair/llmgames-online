import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env, User, Variables } from "../../types";
import { diagnosticsRoutes } from "../../api/diagnostics";
import { testEnv } from "../fixtures/env";
import { migratedDb } from "../fixtures/migrated-db";

const operator: User = {
  id: "operator-1",
  email: "operator@example.test",
  name: "Operator",
  gamertag: "Operator",
  gamertag_selected: 1,
  created_at: 0,
  updated_at: 0,
};

function appFor(db: Env["DB"], env: Partial<Env>, user: User | null = operator) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use("*", async (c, next) => {
    if (user) c.set("user", user);
    await next();
  });
  app.route("/diagnostics", diagnosticsRoutes);

  return app.request("/diagnostics", {}, testEnv({ DB: db, ...env }));
}

function seedRoom(db: Env["DB"], code: string, expiresAt: number) {
  return db
    .prepare(
      `INSERT INTO active_rooms (room_code, game_type, room_id, status, expires_at, created_at)
       VALUES (?, 'connect4', ?, 'active', ?, ?)`,
    )
    .bind(code, `connect4-${code}`, expiresAt, Date.now() - 60_000)
    .run();
}

function seedGame(db: Env["DB"], id: string, endReason: string, endedAt: number) {
  return db
    .prepare(
      `INSERT INTO game_logs (id, game_type, started_at, ended_at, end_reason, event_count, r2_key, size_bytes)
       VALUES (?, 'connect4', ?, ?, ?, 3, ?, 10)`,
    )
    .bind(id, endedAt - 60, endedAt, endReason, `game-logs/v1/${id}.json.gz`)
    .run();
}

describe("operator diagnostics", () => {
  it("stays invisible until OPERATOR_USER_IDS is configured", async () => {
    const db = migratedDb();
    const response = await appFor(db, { OPERATOR_USER_IDS: undefined });
    expect(response.status).toBe(404);
  });

  it("rejects a signed-in user who is not an operator", async () => {
    const db = migratedDb();
    const response = await appFor(db, { OPERATOR_USER_IDS: "someone-else" });
    expect(response.status).toBe(404);
  });

  it("aggregates live rooms and separates abnormal endings", async () => {
    const db = migratedDb();
    const now = Date.now();

    await seedRoom(db, "AB2345", now + 600_000);
    await seedRoom(db, "CD2345", now + 600_000);
    await seedRoom(db, "EF2345", now - 1_000);
    await seedGame(db, "game-win", "Game completed", Math.floor(now / 1000) - 60);
    await seedGame(db, "game-expired", "room_expired", Math.floor(now / 1000) - 60);

    const response = await appFor(db, { OPERATOR_USER_IDS: "other, operator-1" });

    const body = await response.json<{
      rooms: {
        live: number;
        byGameType: Array<{ gameType: string; status: string; rooms: number }>;
      };
      games: { ended: number; normal: number; abnormal: number; byEndReason: unknown[] };
    }>();

    expect(response.status).toBe(200);
    expect(body.rooms.live).toBe(2);
    expect(body.rooms.byGameType).toEqual([{ gameType: "connect4", status: "active", rooms: 2 }]);
    expect(body.games).toMatchObject({ ended: 2, normal: 1, abnormal: 1 });
    expect(body.games.byEndReason).toHaveLength(2);
  });
});
