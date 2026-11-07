import { z } from "zod";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL } from "node:url";
import { sign } from "hono/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";

import app from "../../app";
import { testEnv, testNamespace } from "../fixtures/env";
import { SQLiteD1 } from "../fixtures/sqlite-d1";
import { PAT_PREFIX } from "../../auth/mcpPersonalTokens";

/**
 * MCP personal access tokens.
 *
 * The security shape matters more than the happy path: a token must open the
 * MCP endpoint, must not open anything else, must stop working the moment it is
 * revoked or expires, and must never be recoverable from storage or the list
 * response.
 */

const signingSecret = "synthetic-pat-signing-secret-not-production";

const origin = "https://site.example.com";

const tokensPath = "/api/v1/auth/users/me/mcp-tokens";

async function harness() {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../../../migrations/", import.meta.url);

  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  db.exec(
    "INSERT INTO users (id,email,gamertag,gamertag_selected) VALUES ('host','host@test.invalid','TokenHost',1),('other','other@test.invalid','OtherHost',1)",
  );

  const env = testEnv({
    FRONTEND_URL: origin,
    ENCRYPTION_SECRET: signingSecret,
    CONNECT4_ROOM: testNamespace(async () => Response.json({ ok: true })),
    DB: new SQLiteD1(db),
  });

  async function sessionFor(userId: string) {
    const now = Math.floor(Date.now() / 1000);
    const sid = crypto.randomUUID();

    db.prepare(
      "INSERT INTO web_sessions (id,user_id,authenticated_at,expires_at) VALUES (?,?,?,?)",
    ).run(sid, userId, now, now + 7 * 86400);

    return sign(
      {
        sid,
        typ: "web_session",
        sub: userId,
        email: `${userId}@test.invalid`,
        name: null,
        iat: now,
        exp: now + 7 * 86400,
      },
      signingSecret,
      "HS256",
    );
  }

  const hostSession = await sessionFor("host");
  const otherSession = await sessionFor("other");

  const request = (
    path: string,
    method = "GET",
    body?: import("@llmgames/game-catalog").WireValue,
    cookie = `__Host-session=${hostSession}`,
  ) =>
    app.request(
      origin + path,
      {
        method,
        headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );

  /** An MCP JSON-RPC call carrying a personal token instead of a session. */
  const mcp = (token: string, method = "initialize") =>
    app.request(
      `${origin}/api/v1/mcp`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params:
            method === "initialize"
              ? {
                  protocolVersion: "2025-06-18",
                  capabilities: {},
                  clientInfo: { name: "pat-test", version: "1" },
                }
              : {},
        }),
      },
      env,
    );

  async function createToken(name = "DSH server", expiresInDays = 90) {
    const response = await request(tokensPath, "POST", { name, expiresInDays });

    const body = z
      .object({
        token: z.string(),
        record: z.object({ id: z.string(), name: z.string(), expiresAt: z.number() }),
      })
      .parse(await response.json());

    return { ...body, status: response.status };
  }

  return { db, env, request, mcp, createToken, hostSession, otherSession };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MCP personal access tokens", () => {
  it("creates a token, stores only a hash, and never lists the secret", async () => {
    const h = await harness();
    const created = await h.createToken();

    expect(created.status).toBe(201);
    expect(created.token.startsWith(PAT_PREFIX)).toBe(true);
    expect(created.token.split(".")).toHaveLength(2);

    // SAFETY: the row was just written by the route under test.
    const stored = h.db
      .prepare("SELECT token_hash FROM mcp_personal_tokens WHERE id = ?")
      .get(created.record.id) as { token_hash: string };

    expect(stored.token_hash).not.toBe(created.token);
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.token_hash).not.toContain(created.token.split(".")[1]!);

    const listed = z
      .object({
        tokens: z.array(z.object({ id: z.string(), name: z.string(), lastUsedAt: z.unknown() })),
        maxActive: z.number(),
      })
      .parse(await (await h.request(tokensPath)).json());

    expect(listed.tokens).toHaveLength(1);
    expect(listed.tokens[0]!.name).toBe("DSH server");
    expect(JSON.stringify(listed)).not.toContain(created.token);
    expect(listed.maxActive).toBe(10);

    h.db.close();
  });

  it("authenticates the MCP endpoint with the token", async () => {
    const h = await harness();
    const created = await h.createToken();

    const response = await h.mcp(created.token);

    expect(response.status).toBe(200);

    const body = z
      .object({ result: z.object({ serverInfo: z.object({ name: z.string() }) }) })
      .parse(await response.json());

    expect(body.result.serverInfo.name).toBe("llmgames");

    // The token's own name becomes the seat label, so a roster reads "DSH server".
    // SAFETY: same row, read back through the same primary key.
    const row = h.db.prepare("SELECT last_used_at FROM mcp_personal_tokens WHERE id = ?").get(
      created.record.id,
    ) as { last_used_at: number | null };

    expect(row.last_used_at).not.toBeNull();
    h.db.close();
  });

  it("does not open the account API", async () => {
    const h = await harness();
    const created = await h.createToken();
    const headers = { Authorization: `Bearer ${created.token}` };

    // `/users/me` answers `{ user: null }` to anonymous callers by design; the
    // point is that a token does not become a session there.
    const me = await app.request(`${origin}/api/v1/auth/users/me`, { headers }, h.env);
    const meBody = z.object({ user: z.unknown() }).parse(await me.json());

    expect(me.status).toBe(200);
    expect(meBody.user).toBeNull();

    // A route that requires a signed-in owner refuses the token outright.
    const agents = await app.request(`${origin}/api/v1/auth/users/me/agents`, { headers }, h.env);

    expect(agents.status).toBe(401);
    h.db.close();
  });

  it("cannot mint or revoke tokens with a token", async () => {
    const h = await harness();
    const created = await h.createToken();
    const auth = { Authorization: `Bearer ${created.token}`, Origin: origin };

    const mint = await app.request(
      origin + tokensPath,
      {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "second", expiresInDays: 30 }),
      },
      h.env,
    );

    const revoke = await app.request(`${origin}${tokensPath}/${created.record.id}`, {
      method: "DELETE",
      headers: auth,
    }, h.env);

    expect(mint.status).toBe(401);
    expect(revoke.status).toBe(401);

    // SAFETY: COUNT(*) always returns one row with an integer column.
    const rows = h.db.prepare("SELECT COUNT(*) AS count FROM mcp_personal_tokens").get() as {
      count: number;
    };

    expect(rows.count).toBe(1);
    h.db.close();
  });

  it("stops working the moment it is revoked", async () => {
    const h = await harness();
    const created = await h.createToken();

    expect((await h.mcp(created.token)).status).toBe(200);

    const revoked = await h.request(`${tokensPath}/${created.record.id}`, "DELETE");

    expect(revoked.status).toBe(200);
    expect((await h.mcp(created.token)).status).toBe(401);

    const body = z.object({ error: z.string() }).parse(await (await h.mcp(created.token)).json());

    expect(body.error).toBe("invalid_token");
    h.db.close();
  });

  it("refuses an expired token", async () => {
    const h = await harness();
    const created = await h.createToken();

    h.db
      .prepare("UPDATE mcp_personal_tokens SET expires_at = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000) - 1, created.record.id);

    expect((await h.mcp(created.token)).status).toBe(401);
    h.db.close();
  });

  it("refuses a token whose secret was changed", async () => {
    const h = await harness();
    const created = await h.createToken();
    const [id, secret] = created.token.slice(PAT_PREFIX.length).split(".");
    const forged = `${PAT_PREFIX}${id}.${secret!.slice(0, -1)}${secret!.endsWith("A") ? "B" : "A"}`;

    expect((await h.mcp(forged)).status).toBe(401);
    expect((await h.mcp(created.token)).status).toBe(200);
    h.db.close();
  });

  it("cannot be revoked by another account", async () => {
    const h = await harness();
    const created = await h.createToken();

    const attempt = await h.request(
      `${tokensPath}/${created.record.id}`,
      "DELETE",
      undefined,
      `__Host-session=${h.otherSession}`,
    );

    expect(attempt.status).toBe(404);
    expect((await h.mcp(created.token)).status).toBe(200);
    h.db.close();
  });

  it("caps active tokens per account", async () => {
    const h = await harness();

    for (let index = 0; index < 10; index += 1) {
      const created = await h.createToken(`server-${index}`);

      expect(created.status).toBe(201);
    }

    const eleventh = await h.request(tokensPath, "POST", { name: "one too many" });
    const body = z.object({ code: z.string() }).parse(await eleventh.json());

    expect(eleventh.status).toBe(400);
    expect(body.code).toBe("PAT_LIMIT_REACHED");
    h.db.close();
  });

  it("rejects a malformed token without falling back to OAuth", async () => {
    const h = await harness();
    const response = await h.mcp(`${PAT_PREFIX}not-a-real-token`);

    expect(response.status).toBe(401);

    const body = z
      .object({ error: z.string(), error_description: z.string() })
      .parse(await response.json());

    expect(body.error).toBe("invalid_token");
    expect(response.headers.get("www-authenticate")).toBeTruthy();
    h.db.close();
  });
});
