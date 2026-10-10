import { testDatabase } from "../fixtures/auth";
import { MemoryR2Bucket } from "../fixtures/memory-r2";
import { testEnv } from "../fixtures/env";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env, User, Variables } from "../../types";
import { authRoutes } from "../../auth/routes";

function authenticatedAuthRoutes(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", authRoutes);

  return app;
}

describe("current-user profile routes", () => {
  it("keeps the read-only current-user endpoint", async () => {
    const response = await authRoutes.request("/users/me");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ user: null });
  });

  it("does not expose a general profile PATCH endpoint", async () => {
    const response = await authRoutes.request("/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamertag: "ChangedName" }),
    });

    expect(response.status).toBe(404);
  });

  it("does not expose an avatar preferences endpoint", async () => {
    const response = await authRoutes.request("/users/me/avatar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rerollAvatar: true }),
    });

    expect(response.status).toBe(404);
  });

  it("keeps username onboarding behind authentication", async () => {
    const response = await authRoutes.request("/users/me/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "PlayerOne" }),
    });

    expect(response.status).toBe(401);
  });

  it("manages agent identities by codename without exposing private agent IDs", async () => {
    const user: User = {
      id: "user-1",
      email: "player@example.test",
      name: "Player",
      gamertag: "PlayerOne",
      gamertag_selected: 1,
      created_at: 0,
      updated_at: 0,
    };

    const seat = {
      id: "private-agent-id",
      owner_user_id: user.id,
      codename: "SwiftAnchor",
      client_id: "codex-client",
      environment_label: "Codex",
      created_at: 10,
      last_used_at: 20,
    };

    const { sqlite, db } = testDatabase();
    sqlite.prepare("INSERT INTO users (id,email) VALUES (?,?)").run(user.id, user.email);
    sqlite
      .prepare(
        "INSERT INTO mcp_agent_seats (id,owner_user_id,codename,client_id,environment_label,created_at,last_used_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        seat.id,
        seat.owner_user_id,
        seat.codename,
        seat.client_id,
        seat.environment_label,
        seat.created_at,
        seat.last_used_at,
      );
    const env = testEnv({ DB: db });

    const app = authenticatedAuthRoutes(user);

    const listResponse = await app.request("/users/me/agents", undefined, env);
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody).toEqual({
      agents: [
        {
          codename: seat.codename,
          environmentLabel: "Codex",
          createdAt: 10,
          lastUsedAt: 20,
          hasRoomHistory: false,
          isActive: false,
        },
      ],
    });
    expect(JSON.stringify(listBody)).not.toContain(seat.id);

    const deleteResponse = await app.request(
      `/users/me/agents/${seat.codename}`,
      { method: "DELETE" },
      env,
    );

    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      deleted: true,
      codename: seat.codename,
    });

    const deleteAllResponse = await app.request("/users/me/agents", { method: "DELETE" }, env);

    expect(deleteAllResponse.status).toBe(200);
    await expect(deleteAllResponse.json()).resolves.toMatchObject({
      deleted: true,
      deletedCount: 0,
      preservedActiveCount: 0,
    });
  });

  it("returns success when completed onboarding is retried unchanged", async () => {
    const user: User = {
      id: "user-1",
      email: "player@example.test",
      name: "Player",
      gamertag: "PlayerOne",
      gamertag_selected: 1,
      created_at: 0,
      updated_at: 0,
    };

    const response = await authenticatedAuthRoutes(user).request(
      "/users/me/onboarding",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "PlayerOne" }),
      },
      testEnv({}),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ user });
  });

  it("marks archived game logs as already gzip encoded", async () => {
    const user: User = {
      id: "user-1",
      email: "player@example.test",
      name: "Player",
      gamertag: "PlayerOne",
      gamertag_selected: 1,
      created_at: 0,
      updated_at: 0,
    };

    const nativeResponse = globalThis.Response;
    const responseInits: ResponseInit[] = [];

    class CapturingResponse extends nativeResponse {
      constructor(body?: BodyInit | null, init?: ResponseInit) {
        responseInits.push(init ?? {});
        super(body, init);
      }
    }

    const { sqlite, db } = testDatabase();
    sqlite.prepare("INSERT INTO users (id,email) VALUES (?,?)").run(user.id, user.email);
    sqlite.exec(
      "INSERT INTO game_logs (id,game_type,started_at,ended_at,end_reason,event_count,r2_key,size_bytes) VALUES ('game-1','connect4',1,2,'win',1,'game-logs/v1/game-1.json.gz',2)",
    );
    sqlite
      .prepare(
        "INSERT INTO game_log_participants (game_log_id,participant_ref,owner_user_id,is_agent,display_name) VALUES ('game-1','p1',?,1,'Agent')",
      )
      .run(user.id);
    const bucket = new MemoryR2Bucket();
    await bucket.put("game-logs/v1/game-1.json.gz", new Uint8Array([0x1f, 0x8b]));
    const env = testEnv({ DB: db, GAME_LOGS: bucket });

    vi.stubGlobal("Response", CapturingResponse);

    try {
      const response = await authenticatedAuthRoutes(user).request(
        "/users/me/game-logs/game-1",
        undefined,
        env,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Encoding")).toBe("gzip");
      expect(responseInits.some((init) => init.encodeBody === "manual")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
