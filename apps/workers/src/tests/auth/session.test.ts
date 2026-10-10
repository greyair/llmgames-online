import { testDatabase } from "../fixtures/auth";
import { testEnv } from "../fixtures/env";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { describe, expect, it } from "vitest";
import type { Env, Variables } from "../../types";
import { requireCompletedOnboarding, sessionMiddleware } from "../../auth/session";

const secret = "test-secret-that-is-long-enough-for-hmac";

function testApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", sessionMiddleware);
  app.get("/", (c) => c.json({ user: c.get("user") }));

  return app;
}

function envWithUser(issuedAt: number): Env {
  const { sqlite, db } = testDatabase();
  sqlite.exec(
    "INSERT INTO users (id,email,name,gamertag,created_at,updated_at) VALUES ('user-1','player@example.test','Player','PlayerOne',0,0)",
  );
  sqlite
    .prepare("INSERT INTO web_sessions (id,user_id,authenticated_at,expires_at) VALUES (?,?,?,?)")
    .run("00000000-0000-4000-8000-000000000001", "user-1", issuedAt, issuedAt + 7 * 86400);

  return testEnv({ ENCRYPTION_SECRET: secret, DB: db });
}

describe("session token type separation", () => {
  it("rejects an OAuth state JWT used as a session cookie", async () => {
    const now = Math.floor(Date.now() / 1000);

    const token = await sign(
      { typ: "oauth_state", state: "state", iat: now, exp: now + 300 },
      secret,
      "HS256",
    );

    const response = await testApp().request(
      "https://example.test/",
      { headers: { Cookie: `__Host-session=${token}` } },
      testEnv({ ENCRYPTION_SECRET: secret }),
    );

    expect(await response.json()).toEqual({ user: null });
  });

  it("accepts a correctly typed web session", async () => {
    const now = Math.floor(Date.now() / 1000);

    const token = await sign(
      {
        sid: "00000000-0000-4000-8000-000000000001",
        typ: "web_session",
        sub: "user-1",
        email: "player@example.test",
        name: "Player",
        iat: now,
        exp: now + 7 * 86400,
      },
      secret,
      "HS256",
    );

    const response = await testApp().request(
      "https://example.test/",
      { headers: { Cookie: `__Host-session=${token}` } },
      envWithUser(now),
    );

    const body = await response.json<{ user: { id: string } }>();
    expect(body.user.id).toBe("user-1");
  });
});

describe("username onboarding enforcement", () => {
  function onboardingApp(gamertagSelected: number) {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", async (c, next) => {
      c.set("user", {
        id: "user-1",
        email: "player@example.test",
        name: "Player",
        gamertag: "PlayerOne",
        gamertag_selected: gamertagSelected,
        created_at: 0,
        updated_at: 0,
      });
      await next();
    });
    app.use("*", requireCompletedOnboarding);
    app.get("/", (c) => c.json({ ok: true }));

    return app;
  }

  it("blocks play APIs until a username is selected", async () => {
    const response = await onboardingApp(0).request("/");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Choose your username before playing",
    });
  });

  it("allows play APIs after onboarding", async () => {
    const response = await onboardingApp(1).request("/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
