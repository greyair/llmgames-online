import { z } from "zod";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { URL } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { SQLiteD1 } from "../fixtures/sqlite-d1";
import { testEnv } from "../fixtures/env";
import { authRoutes } from "../../auth/routes";
import type { Env, Variables } from "../../types";

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../../../migrations/", import.meta.url);

  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));

  const env = testEnv({
    DB: new SQLiteD1(sqlite),
    ENCRYPTION_SECRET: "test-secret-that-is-long-enough-for-hmac",
    FRONTEND_URL: "http://localhost:3000",
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-secret",
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route("/api/v1/auth", authRoutes);

  return { app, env, sqlite };
}

describe("GitHub OAuth", () => {
  it("starts a provider-specific state-bound flow with a safe MCP return path", async () => {
    const { app, env } = setup();

    const res = await app.request(
      "http://localhost/api/v1/auth/oauth/github",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: "/api/v1/oauth/consent?req=abc" }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = z.object({ authUrl: z.string() }).parse(await res.json());
    const url = new URL(body.authUrl);
    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/v1/auth/oauth/github/callback",
    );
    expect(url.searchParams.get("scope")).toBe("user:email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toMatch(/^[a-f0-9]{64}$/);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("rejects callback without a matching signed state cookie", async () => {
    const { app, env } = setup();

    const res = await app.request(
      `http://localhost/api/v1/auth/oauth/github/callback?code=test&state=${"a".repeat(64)}`,
      {},
      env,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("missing_state_cookie");
  });
});

describe("GitHub identity verification", () => {
  it("creates a user only from a verified primary email and reuses the stable GitHub ID", async () => {
    const { app, env, sqlite } = setup();
    const originalFetch = globalThis.fetch;
    let sentVerifier = "";
    globalThis.fetch = async (input, init) => {
      const target = String(input);

      if (target.includes("access_token")) {
        const request = z.object({ code_verifier: z.string() }).parse(JSON.parse(String(init?.body)));
        sentVerifier = request.code_verifier;

        return Response.json({ access_token: "fake" });
      }

      if (target.endsWith("/user"))
        return Response.json({ id: 12345, login: "player", name: "Player" });

      if (target.endsWith("/user/emails"))
        return Response.json([{ email: "player@example.test", primary: true, verified: true }]);
      throw new Error("Unexpected request");
    };

    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const start = await app.request(
          "http://localhost/api/v1/auth/oauth/github",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(attempt === 1 ? { returnTo: "/api/v1/oauth/consent?req=abc" } : {}) },
          env,
        );

        const data = z.object({ authUrl: z.string() }).parse(await start.json());
        const state = new URL(data.authUrl).searchParams.get("state");
        const cookie = start.headers.get("set-cookie")!.split(";")[0]!;

        const callback = await app.request(
          `http://localhost/api/v1/auth/oauth/github/callback?state=${state}&code=test`,
          { headers: { Cookie: cookie } },
          env,
        );

        expect(createHash("sha256").update(sentVerifier).digest("base64url")).toBe(new URL(data.authUrl).searchParams.get("code_challenge"));
        expect(callback.status).toBe(302);
        expect(callback.headers.get("location")).toBe(attempt === 1 ? "http://localhost/api/v1/oauth/consent?req=abc" : "http://localhost:3000/onboarding");
      }

      expect(sqlite.prepare("SELECT count(*) AS count FROM users").get()?.count).toBe(1);
      expect(sqlite.prepare("SELECT github_id FROM github_identities").get()?.github_id).toBe(
        "12345",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects an existing email and never links it automatically", async () => {
    const { app, env, sqlite } = setup();
    sqlite
      .prepare("INSERT INTO users (id,email) VALUES (?,?)")
      .run("existing", "player@example.test");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const target = String(input);

      if (target.includes("access_token")) return Response.json({ access_token: "fake" });

      if (target.endsWith("/user")) return Response.json({ id: 12345, login: "player" });

      return Response.json([{ email: "player@example.test", primary: true, verified: true }]);
    };

    try {
      const start = await app.request(
        "http://localhost/api/v1/auth/oauth/github",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        env,
      );

      const data = z.object({ authUrl: z.string() }).parse(await start.json());
      const state = new URL(data.authUrl).searchParams.get("state");
      const cookie = start.headers.get("set-cookie")!.split(";")[0]!;

      const callback = await app.request(
        `http://localhost/api/v1/auth/oauth/github/callback?state=${state}&code=test`,
        { headers: { Cookie: cookie } },
        env,
      );

      expect(callback.headers.get("location")).toContain("github_email_conflict");
      expect(sqlite.prepare("SELECT count(*) AS count FROM github_identities").get()?.count).toBe(
        0,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

it("rejects an unverified primary email without creating a user", async () => {
  const { app, env, sqlite } = setup();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const target = String(input);

    if (target.includes("access_token")) return Response.json({ access_token: "fake" });

    if (target.endsWith("/user")) return Response.json({ id: 12345, login: "player" });

    return Response.json([{ email: "player@example.test", primary: true, verified: false }]);
  };

  try {
    const start = await app.request(
      "http://localhost/api/v1/auth/oauth/github",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      env,
    );

    const data = z.object({ authUrl: z.string() }).parse(await start.json());
    const state = new URL(data.authUrl).searchParams.get("state");

    const callback = await app.request(
      `http://localhost/api/v1/auth/oauth/github/callback?state=${state}&code=test`,
      { headers: { Cookie: start.headers.get("set-cookie")!.split(";")[0]! } },
      env,
    );

    expect(callback.headers.get("location")).toContain("unverified_email");
    expect(sqlite.prepare("SELECT count(*) AS count FROM users").get()?.count).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("does not let Google silently adopt an existing GitHub account", async () => {
  const { app, env, sqlite } = setup();
  sqlite
    .prepare("INSERT INTO users (id,email) VALUES (?,?)")
    .run("github-user", "player@example.test");
  sqlite
    .prepare("INSERT INTO github_identities (github_id,user_id) VALUES (?,?)")
    .run("123", "github-user");
  const { upsertUser } = await import("../../auth/google");
  app.get("/test-upsert", async (c) => {
    try {
      await upsertUser(c, { email: "player@example.test", verified_email: true, name: "Player" });

      return c.text("unexpected", 200);
    } catch {
      return c.text("conflict", 409);
    }
  });
  const response = await app.request("http://localhost/test-upsert", {}, env);
  expect(response.status).toBe(409);
});

it("preserves MCP returnTo after GitHub authorization is denied", async () => {
  const { app, env } = setup();
  const returnTo = "/api/v1/oauth/consent?req=abc";
  const start = await app.request("http://localhost/api/v1/auth/oauth/github", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnTo }) }, env);
  const data = z.object({ authUrl: z.string() }).parse(await start.json());
  const state = new URL(data.authUrl).searchParams.get("state");
  const response = await app.request(`http://localhost/api/v1/auth/oauth/github/callback?state=${state}&error=access_denied`, { headers: { Cookie: start.headers.get("set-cookie")!.split(";")[0]! } }, env);
  expect(new URL(response.headers.get("location")!).searchParams.get("return_to")).toBe(returnTo);
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
});

it("does not silently merge verified email login with a GitHub account", async () => {
  const { app, env, sqlite } = setup();
  sqlite.prepare("INSERT INTO users (id,email) VALUES (?,?)").run("github-user", "player@example.test");
  sqlite.prepare("INSERT INTO github_identities (github_id,user_id) VALUES (?,?)").run("123", "github-user");
  const { upsertUser } = await import("../../auth/google");
  app.get("/test-email-upsert", async (c) => {
    try { await upsertUser(c, { email: "player@example.test", verified_email: true });

 return c.text("ok", 200); }
    catch { return c.text("conflict", 409); }
  });
  expect((await app.request("http://localhost/test-email-upsert", {}, env)).status).toBe(409);
});

it("rejects duplicate state cookies instead of accepting the first value", async () => {
  const { app, env } = setup();
  const start = await app.request("http://localhost/api/v1/auth/oauth/github", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, env);
  const data = z.object({ authUrl: z.string() }).parse(await start.json());
  const state = new URL(data.authUrl).searchParams.get("state");
  const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
  const response = await app.request(`http://localhost/api/v1/auth/oauth/github/callback?state=${state}&code=test`, { headers: { Cookie: `${cookie}; ${cookie}` } }, env);
  expect(response.headers.get("location")).toContain("invalid_state");
});

it("uses a host-only prefixed state cookie on HTTPS", async () => {
  const { app, env } = setup();
  const response = await app.request("https://localhost/api/v1/auth/oauth/github", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, env);
  expect(response.headers.get("set-cookie")).toContain("__Host-github_oauth_state_");
  expect(response.headers.get("set-cookie")).toContain("Secure");
});

it("fails closed when production Turnstile is missing or invalid", async () => {
  const { app, env } = setup();
  env.TURNSTILE_SECRET_KEY = "production-test-secret";
  const endpoint = "https://games.example.test/api/v1/auth/oauth/github";
  const missing = await app.request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, env);
  expect(missing.status).toBe(400);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] });

  try {
    const invalid = await app.request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turnstileToken: "invalid" }) }, env);
    expect(invalid.status).toBe(403);
  } finally { globalThis.fetch = originalFetch; }
});
