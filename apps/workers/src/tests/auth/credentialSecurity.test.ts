import { z } from "zod";
import { SQLiteD1 } from "../fixtures/sqlite-d1";
import { testEnv, testNamespace } from "../fixtures/env";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL } from "node:url";
import { sign } from "hono/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";

import app from "../../app";

const signingSecret = "synthetic-audit-signing-secret-not-production";

const storedToken = "Bearer synthetic-webhook-audit-token";

const origin = "https://site.example.com";

async function harness(ageDays = 0) {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../../../migrations/", import.meta.url);

  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  db.exec(
    "INSERT INTO users (id,email,gamertag,gamertag_selected) VALUES ('host','host@test.invalid','AuditHost',1)",
  );

  const env = testEnv({
    FRONTEND_URL: origin,
    ENCRYPTION_SECRET: signingSecret,
    JEV_CREDENTIAL_KEYS: JSON.stringify({ v1: btoa("a".repeat(32)) }),
    CONNECT4_ROOM: testNamespace(async () => Response.json({ ok: true })),
    DB: new SQLiteD1(db),
  });

  const now = Math.floor(Date.now() / 1000);
  const sid = crypto.randomUUID();
  db.prepare(
    "INSERT INTO web_sessions (id,user_id,authenticated_at,expires_at) VALUES (?,?,?,?)",
  ).run(sid, "host", now - ageDays * 86400, now + (7 - ageDays) * 86400);

  const token = await sign(
    {
      sid,
      typ: "web_session",
      sub: "host",
      email: "host@test.invalid",
      name: null,
      iat: now - ageDays * 86400,
      exp: now + (7 - ageDays) * 86400,
    },
    signingSecret,
    "HS256",
  );

  const request = (
    path: string,
    method = "GET",
    body?: import("@llmgames/game-catalog").WireValue,
    cookieName = "__Host-session",
  ) =>
    app.request(
      origin + path,
      {
        method,
        headers: {
          Cookie: `${cookieName}=${token}`,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );

  return { db, env, request, token, sid };
}

const hooks = "/api/v1/auth/users/me/agent-webhooks";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("credential security regressions using synthetic secrets only", () => {
  it.each([
    "https://collector.example.com/capture",
    "https://provider.example.com/another-tenant",
    "https://provider.example.com/hook?tenant=other",
  ])("rejects implicit secret reuse at %s before delivery", async (destination) => {
    const h = await harness();

    const created = await h.request(hooks, "POST", {
      name: "Agent",
      url: "https://provider.example.com/hook",
      headerName: "Authorization",
      headerValue: storedToken,
    });

    expect(created.status).toBe(200);
    const { id } = z.object({ id: z.string() }).parse(await created.json());
    const before = h.db.prepare("SELECT * FROM agent_webhooks WHERE id=?").get(id);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const changed = await h.request(`${hooks}/${id}`, "PUT", {
      name: "Agent",
      url: destination,
      headerName: "Authorization",
    });

    expect(changed.status).toBe(400);
    expect(h.db.prepare("SELECT * FROM agent_webhooks WHERE id=?").get(id)).toEqual(before);
    expect(fetcher).not.toHaveBeenCalled();
    h.db.close();
  });
  it.each(["", "Bearer replacement-token"])(
    "allows an explicit replacement or removal of auth",
    async (headerValue) => {
      const h = await harness();

      const created = await h.request(hooks, "POST", {
        name: "Agent",
        url: "https://provider.example.com/hook",
        headerName: "Authorization",
        headerValue: storedToken,
      });

      const { id } = z.object({ id: z.string() }).parse(await created.json());
      expect(
        (
          await h.request(`${hooks}/${id}`, "PUT", {
            name: "Agent",
            url: "https://collector.example.com/capture",
            headerName: "Authorization",
            headerValue,
          })
        ).status,
      ).toBe(200);
      h.db
        .prepare(
          "INSERT INTO active_rooms (room_code,game_type,room_id,status,expires_at,created_at) VALUES ('ABC234','connect4','connect4-ABC234','active',?,?)",
        )
        .run(Date.now() + 600000, Date.now());

      const fetcher = vi.fn(
        async (_url: string, _options: RequestInit) => new Response(null, { status: 202 }),
      );

      vi.stubGlobal("fetch", fetcher);
      expect(
        (await h.request(`${hooks}/${id}/invite`, "POST", { roomCode: "ABC234" })).status,
      ).toBe(200);
      const options = fetcher.mock.calls[0]!;
      expect(new Headers(options[1].headers).get("Authorization")).toBe(headerValue || null);
      expect(JSON.stringify(options)).not.toContain(storedToken);
      h.db.close();
    },
  );
  it("logout of an aging session only deletes cookies and revokes all copies", async () => {
    const h = await harness(4);
    const response = await h.request("/api/v1/auth/sessions/logout", "POST");
    expect(response.status).toBe(200);

    for (const cookie of response.headers.getSetCookie()) expect(cookie).toContain("Max-Age=0");
    expect(h.db.prepare("SELECT id FROM web_sessions").all()).toEqual([]);
    expect((await h.request(hooks)).status).toBe(401);
    h.db.close();
  });
  it("requires recent authentication for mutations but permits viewing and revocation", async () => {
    const h = await harness(1);
    expect((await h.request(hooks)).status).toBe(200);

    for (const [path, method, body] of [
      [hooks, "POST", {}],
      [`${hooks}/record`, "DELETE", undefined],
      ["/api/v1/auth/users/me/typesafe", "PUT", {}],
    ] as const) {
      const res = await h.request(path, method, body);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    }

    expect((await h.request("/api/v1/auth/sessions/logout", "POST")).status).toBe(200);
    h.db.close();
  });
  it("rejects expired sessions without renewing them", async () => {
    const h = await harness(8);
    const res = await h.request(hooks);
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toEqual([]);
    h.db.close();
  });
  it("rejects a session when its stored record is missing or mismatched", async () => {
    const h = await harness();
    h.db
      .prepare("UPDATE web_sessions SET authenticated_at=authenticated_at-1 WHERE id=?")
      .run(h.sid);
    expect((await h.request(hooks)).status).toBe(401);
    h.db.prepare("DELETE FROM web_sessions").run();
    expect((await h.request(hooks)).status).toBe(401);
    h.db.close();
  });
  it("logout-all revokes every browser session for this owner only", async () => {
    const h = await harness();
    const now = Math.floor(Date.now() / 1000);
    h.db.prepare("INSERT INTO users (id,email) VALUES ('guest','guest@test.invalid')").run();
    h.db
      .prepare("INSERT INTO web_sessions VALUES (?,?,?,?)")
      .run("another-session", "host", now, now + 1000);
    h.db
      .prepare("INSERT INTO web_sessions VALUES (?,?,?,?)")
      .run("guest-session", "guest", now, now + 1000);
    expect((await h.request("/api/v1/auth/sessions/logout-all", "POST")).status).toBe(200);
    expect(h.db.prepare("SELECT id FROM web_sessions").all()).toEqual([{ id: "guest-session" }]);
    expect((await h.request(hooks)).status).toBe(401);
    h.db.close();
  });
  it.each(["not_session", "session", "not___Host-session"])(
    "does not authenticate from cookie named %s on HTTPS",
    async (name) => {
      const h = await harness();
      expect((await h.request(hooks, "GET", undefined, name)).status).toBe(401);
      h.db.close();
    },
  );
  it("rejects duplicate cookies and cross-origin logout", async () => {
    const h = await harness();

    const duplicate = await app.request(
      origin + hooks,
      { headers: { Cookie: `__Host-session=${h.token}; __Host-session=${h.token}` } },
      h.env,
    );

    expect(duplicate.status).toBe(401);

    const logout = await app.request(
      origin + "/api/v1/auth/sessions/logout",
      {
        method: "POST",
        headers: { Cookie: `__Host-session=${h.token}`, Origin: "https://evil.example.com" },
      },
      h.env,
    );

    expect(logout.status).toBe(403);
    expect((await h.request(hooks)).status).toBe(200);
    h.db.close();
  });
  it("sanitizes unexpected credential-route exceptions before logging", async () => {
    const h = await harness();
    const marker = "synthetic-provider-error-with-sensitive-marker";
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: {
          cancel: async () => {
            throw new Error(marker);
          },
        },
      })),
    );

    const response = await h.request("/api/v1/auth/users/me/typesafe", "PUT", {
      apiKey: "synthetic-typesafe-key",
      dailyLimit: 10,
      consent: true,
    });

    expect(response.status).toBe(503);
    expect(logger).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(marker);
    h.db.close();
  });
  it("sanitizes webhook decryption failure and global error objects", async () => {
    const h = await harness();
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});

    const created = await h.request(hooks, "POST", {
      name: "Agent",
      url: "https://provider.example.com/hook",
      headerName: "Authorization",
      headerValue: storedToken,
    });

    const { id } = z.object({ id: z.string() }).parse(await created.json());
    h.db
      .prepare("UPDATE agent_webhooks SET ciphertext=? WHERE id=?")
      .run("invalid-secret-ciphertext", id);
    expect(
      (await h.request(`${hooks}/${id}`, "PUT", { name: "Updated", headerName: "Authorization" }))
        .status,
    ).toBe(503);
    expect(logger).not.toHaveBeenCalled();
    h.db.close();
  });
  it("does not report successful logout when session storage fails", async () => {
    const h = await harness();
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    const prepare = h.env.DB.prepare.bind(h.env.DB);

    const fail = vi.spyOn(h.env.DB, "prepare").mockImplementation((sql) => {
      if (sql.startsWith("DELETE FROM web_sessions"))
        throw new Error("synthetic-secret-storage-error");

      return prepare(sql);
    });

    const res = await h.request("/api/v1/auth/sessions/logout", "POST");
    expect(res.status).toBe(500);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(JSON.stringify(logger.mock.calls)).not.toContain("synthetic-secret");
    expect(logger).toHaveBeenCalledWith("REQUEST_FAILED", { requestId: expect.any(String) });
    fail.mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect((await h.request("/api/v1/auth/sessions/logout", "POST")).status).toBe(503);
    h.db.close();
  });
});
