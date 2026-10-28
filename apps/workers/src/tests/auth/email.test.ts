import { z } from "zod";
import { SQLiteD1 } from "../fixtures/sqlite-d1";
import { testEnv } from "../fixtures/env";
import { URL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verify } from "hono/jwt";
import type { Env, Variables } from "../../types";
import { authRoutes } from "../../auth/routes";
import { sessionMiddleware } from "../../auth/session";
import { mcpOAuthApiRoutes } from "../../auth/mcpOAuthRoutes";

function harness() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../../../migrations/", import.meta.url);

  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }

  const db = new SQLiteD1(sqlite);

  const send = vi.fn(
    async (_message: {
      from: string;
      to: string;
      text: string;
      html?: string;
      subject: string;
    }) => {},
  );

  const env = testEnv({
    DB: db,
    EMAIL: { send },
    EMAIL_FROM: "noreply@llmgames.online",
    ENCRYPTION_SECRET: "test-secret-that-is-long-enough-for-hmac",
    FRONTEND_URL: "http://localhost:3000",
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", sessionMiddleware);
  app.route("/api/v1/auth", authRoutes);
  app.route("/api/v1/oauth", mcpOAuthApiRoutes);

  const post = (
    path: string,
    body: import("@llmgames/game-catalog").WireValue,
    cookie = "",
    origin = "http://localhost:3000",
  ) =>
    app.request(
      `http://localhost/api/v1/auth/email/${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
        body: JSON.stringify(body),
      },
      env,
    );

  async function request(email = "player@example.com", returnTo?: string) {
    const response = await post("request", { email, returnTo });
    expect(response.status).toBe(200);
    const body = z.object({ challengeId: z.string() }).parse(await response.json());
    const cookie = response.headers.get("Set-Cookie")!.split(";")[0]!;
    const code = send.mock.calls.at(-1)![0].text.match(/\b\d{6}\b/)![0];

    return { id: body.challengeId, cookie, code };
  }

  return { sqlite, env, app, send, post, request };
}

describe("email code sign-in", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("completes MCP authorization, email login, consent, PKCE exchange and refresh", async () => {
    const h = harness();
    const redirectUri = "http://127.0.0.1:4567/callback";

    const jsonPost = (path: string, body: import("@llmgames/game-catalog").WireValue) =>
      h.app.request(
        `http://localhost/api/v1/oauth/${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        h.env,
      );

    const registration = await jsonPost("register", {
      client_name: "Email QA",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    });

    expect(registration.status).toBe(201);
    const { client_id } = z.object({ client_id: z.string() }).parse(await registration.json());
    const verifier = "v".repeat(43);

    const challenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ).toString("base64url");

    const query = new URLSearchParams({
      client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "original-client-state",
    });

    const authorization = await h.app.request(
      `http://localhost/api/v1/oauth/authorize?${query}`,
      undefined,
      h.env,
    );

    const login = new URL(authorization.headers.get("Location")!);
    expect(login.pathname).toBe("/login");
    const returnTo = login.searchParams.get("return_to")!;
    const c = await h.request("mcp@example.com", returnTo);
    const verified = await h.post("verify", { challengeId: c.id, code: c.code }, c.cookie);
    const { redirectUrl } = z.object({ redirectUrl: z.string() }).parse(await verified.json());
    const cookie = verified.headers.get("Set-Cookie")!.match(/session=[^;]+/)![0];
    const consent = await h.app.request(redirectUrl, { headers: { Cookie: cookie } }, h.env);
    expect(consent.status).toBe(200);
    expect(await consent.text()).toContain("Email QA");

    const approved = await h.app.request(
      "http://localhost/api/v1/oauth/consent",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          req: new URL(redirectUrl).searchParams.get("req")!,
          decision: "allow",
        }),
      },
      h.env,
    );

    expect(approved.status).toBe(303);
    const callback = new URL(approved.headers.get("Location")!);
    expect(callback.searchParams.get("state")).toBe("original-client-state");

    const exchangeBody = {
      client_id,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code: callback.searchParams.get("code"),
      code_verifier: verifier,
    };

    expect(
      (await jsonPost("token", { ...exchangeBody, code_verifier: "wrong".repeat(12) })).status,
    ).toBe(400);
    const exchanged = await jsonPost("token", exchangeBody);
    expect(exchanged.status).toBe(200);

    const tokens = z
      .object({ access_token: z.string(), refresh_token: z.string() })
      .parse(await exchanged.json());

    expect((await verify(tokens.access_token, h.env.ENCRYPTION_SECRET, "HS256")).client_id).toBe(
      client_id,
    );
    expect((await jsonPost("token", exchangeBody)).status).toBe(400);
    expect(
      (
        await jsonPost("token", {
          client_id,
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
        })
      ).status,
    ).toBe(200);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/a/..//evil.example",
    "/%2e%2e//evil.example",
    "/\\evil.example",
    "/\n/evil.example",
  ])("rejects unsafe return URL %s", async (returnTo) => {
    const h = harness();
    const c = await h.request("player@example.com", returnTo);
    const response = await h.post("verify", { challengeId: c.id, code: c.code }, c.cookie);
    expect(await response.json()).toEqual({ redirectUrl: "http://localhost:3000/onboarding" });
  });

  it("does not let a different browser consume a code or exhaust its attempts", async () => {
    const h = harness();
    const c = await h.request();
    expect(
      (
        await h.post(
          "verify",
          { challengeId: c.id, code: c.code },
          `email_login_${c.id}=other-browser`,
        )
      ).status,
    ).toBe(400);
    expect(h.sqlite.prepare("SELECT attempts FROM email_login_codes").get()?.attempts).toBe(0);
    expect((await h.post("verify", { challengeId: c.id, code: c.code }, c.cookie)).status).toBe(
      200,
    );
  });

  it.each([null, [], "email", { email: 42 }])("rejects invalid request bodies %j", async (body) => {
    const h = harness();
    expect((await h.post("request", body)).status).toBe(400);
    expect(h.send).not.toHaveBeenCalled();
  });

  it.each([
    [{ success: false, "error-codes": ["timeout-or-duplicate"] }, 200, 403],
    [{ success: true }, 503, 502],
    [{ success: "true" }, 200, 502],
    [{ success: true }, 200, 200],
  ])("checks Turnstile response %j with HTTP %s", async (body, status, expected) => {
    const h = harness();
    h.env.TURNSTILE_SECRET_KEY = "test-secret";
    const fetch = vi.fn(async () => Response.json(body, { status }));
    vi.stubGlobal("fetch", fetch);

    const response = await h.post("request", {
      email: "player@example.com",
      turnstileToken: "test-token",
    });

    expect(response.status).toBe(expected);
    expect(h.send).toHaveBeenCalledTimes(expected === 200 ? 1 : 0);
    expect(fetch).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("fails closed in production without Turnstile configuration", async () => {
    const h = harness();
    h.env.FRONTEND_URL = "https://www.llmgames.online";

    const response = await h.app.request(
      "https://www.llmgames.online/api/v1/auth/email/request",
      {
        method: "POST",
        headers: { Origin: h.env.FRONTEND_URL, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "player@example.com" }),
      },
      h.env,
    );

    expect(response.status).toBe(503);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("does not send email when Turnstile is unreachable", async () => {
    const h = harness();
    h.env.TURNSTILE_SECRET_KEY = "test-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")),
    );
    expect(
      (await h.post("request", { email: "player@example.com", turnstileToken: "test-token" }))
        .status,
    ).toBe(500);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("uses secure browser and session cookies on HTTPS and permits verification without another Turnstile token", async () => {
    const h = harness();
    h.env.FRONTEND_URL = "https://www.llmgames.online";
    h.env.TURNSTILE_SECRET_KEY = "test-secret";
    const fetch = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetch);

    const post = (path: string, body: import("@llmgames/game-catalog").WireValue, cookie = "") =>
      h.app.request(
        `https://www.llmgames.online/api/v1/auth/email/${path}`,
        {
          method: "POST",
          headers: {
            Origin: h.env.FRONTEND_URL,
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          body: JSON.stringify(body),
        },
        h.env,
      );

    const response = await post("request", {
      email: "player@example.com",
      turnstileToken: "test-token",
    });

    const { challengeId } = z.object({ challengeId: z.string() }).parse(await response.json());
    const cookie = response.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly; SameSite=Strict; Max-Age=600; Secure");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const code = h.send.mock.calls[0]![0].text.match(/\b\d{6}\b/)![0];
    const verified = await post("verify", { challengeId, code }, cookie.split(";")[0]);
    expect(verified.status).toBe(200);
    expect(verified.headers.get("Set-Cookie")).toMatch(/session=[^;]+;.*Secure/);
    expect(verified.headers.get("Set-Cookie")).toContain("Max-Age=0; Secure");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps Google login working after email signup and preserves MCP return URLs", async () => {
    const h = harness();
    const c = await h.request();
    await h.post("verify", { challengeId: c.id, code: c.code }, c.cookie);
    const original = h.sqlite.prepare("SELECT id FROM users").get();

    const start = await h.app.request(
      "http://localhost/api/v1/auth/oauth/google",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: "/api/v1/oauth/consent?req=abc" }),
      },
      h.env,
    );

    const { authUrl } = z.object({ authUrl: z.string() }).parse(await start.json());
    const state = new URL(authUrl).searchParams.get("state")!;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: "google-token" }))
        .mockResolvedValueOnce(
          Response.json({
            email: "player@example.com",
            verified_email: true,
            name: "Google Player",
          }),
        ),
    );

    const callback = await h.app.request(
      `http://localhost/api/v1/auth/oauth/google/callback?code=google-code&state=${state}`,
      { headers: { Cookie: start.headers.get("Set-Cookie")!.split(";")[0]! } },
      h.env,
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("http://localhost/api/v1/oauth/consent?req=abc");
    expect(callback.headers.get("Set-Cookie")).toContain("session=");
    expect(h.sqlite.prepare("SELECT id FROM users").all()).toEqual([original]);
  });
  it("creates a session after verification and consumes the code exactly once", async () => {
    const h = harness();
    const c = await h.request(" Player@Example.com ");
    expect(h.sqlite.prepare("SELECT * FROM users").all()).toHaveLength(0);
    const stored = h.sqlite.prepare("SELECT code_hash FROM email_login_codes").get();
    expect(stored?.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.code_hash).not.toBe(c.code);
    const response = await h.post("verify", { challengeId: c.id, code: c.code }, c.cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirectUrl: "http://localhost:3000/onboarding" });
    const token = response.headers.get("Set-Cookie")!.match(/session=([^;]+)/)![1]!;
    const session = await verify(token, h.env.ENCRYPTION_SECRET, "HS256");
    expect(session).not.toHaveProperty("email");
    expect(
      h.sqlite
        .prepare("SELECT user_id FROM web_sessions WHERE id=?")
        .get(z.string().parse(session.sid))?.user_id,
    ).toBe(session.sub);
    expect(
      h.sqlite.prepare("SELECT email FROM users WHERE id=?").get(z.string().parse(session.sub))
        ?.email,
    ).toBe("player@example.com");
    expect((await h.post("verify", { challengeId: c.id, code: c.code }, c.cookie)).status).toBe(
      400,
    );
  });

  it("keeps an existing account and resumes MCP consent", async () => {
    const h = harness();
    h.sqlite
      .prepare(
        "INSERT INTO users (id,email,name,gamertag,gamertag_selected,created_at,updated_at) VALUES ('existing','player@example.com','Existing name','ExistingTag',1,0,0)",
      )
      .run();
    const c = await h.request("player@example.com", "/api/v1/oauth/consent?req=abc");
    const response = await h.post("verify", { challengeId: c.id, code: c.code }, c.cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      redirectUrl: "http://localhost/api/v1/oauth/consent?req=abc",
    });
    expect(h.sqlite.prepare("SELECT id,name,gamertag FROM users").all()).toEqual([
      { id: "existing", name: "Existing name", gamertag: "ExistingTag" },
    ]);
  });

  it("rejects missing browser cookies, wrong codes, and exhausted attempts", async () => {
    const h = harness();
    const c = await h.request();
    expect((await h.post("verify", { challengeId: c.id, code: c.code })).status).toBe(400);
    const wrong = c.code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i++)
      expect((await h.post("verify", { challengeId: c.id, code: wrong }, c.cookie)).status).toBe(
        400,
      );
    expect((await h.post("verify", { challengeId: c.id, code: c.code }, c.cookie)).status).toBe(
      400,
    );
    expect(h.sqlite.prepare("SELECT * FROM users").all()).toHaveLength(0);
  });

  it("accepts a correct fifth attempt", async () => {
    const h = harness();
    const c = await h.request();
    const wrong = c.code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 4; i++)
      await h.post("verify", { challengeId: c.id, code: wrong }, c.cookie);
    expect((await h.post("verify", { challengeId: c.id, code: c.code }, c.cookie)).status).toBe(
      200,
    );
  });

  it("expires codes and rejects external return URLs", async () => {
    const h = harness();
    const c = await h.request("player@example.com", "/\\evil.example");
    expect(h.sqlite.prepare("SELECT return_to FROM email_login_codes").get()?.return_to).toBeNull();
    h.sqlite.exec("UPDATE email_login_codes SET expires_at = 0");
    expect((await h.post("verify", { challengeId: c.id, code: c.code }, c.cookie)).status).toBe(
      400,
    );
  });

  it("limits resends and rejects cross-origin requests", async () => {
    const h = harness();
    await h.request();
    expect((await h.post("request", { email: "player@example.com" })).status).toBe(429);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(
      (await h.post("request", { email: "loopback@example.com" }, "", "http://127.0.0.1:3000"))
        .status,
    ).toBe(200);
    expect(
      (await h.post("request", { email: "other@example.com" }, "", "https://evil.example")).status,
    ).toBe(403);
  });

  it("removes undelivered codes and fails closed without email configuration", async () => {
    const h = harness();
    h.send.mockRejectedValueOnce(new Error("Delivery failed"));
    expect((await h.post("request", { email: "player@example.com" })).status).toBe(502);
    expect(h.sqlite.prepare("SELECT * FROM email_login_codes").all()).toHaveLength(0);
    delete h.env.EMAIL;
    expect((await h.post("request", { email: "other@example.com" })).status).toBe(503);
  });

  it("sends HTML mail with the code in the subject", async () => {
    const h = harness();
    const c = await h.request();
    const message = h.send.mock.calls.at(-1)![0];
    expect(message.subject).toBe(`${c.code} is your llmgames code`);
    expect(message.text).toContain(c.code);
    expect(message.html).toContain(c.code);
    expect(message.html).toContain("Use this code to sign in");
    expect(message.html).toContain("#ffd43b");
    expect(message.html).toContain('src="http://localhost:3000/llmgames-apple-touch-v3.png"');
  });

  it("requires a valid Turnstile token before sending when configured", async () => {
    const h = harness();
    h.env.TURNSTILE_SECRET_KEY = "configured-secret";
    expect((await h.post("request", { email: "player@example.com" })).status).toBe(400);
    expect(h.send).not.toHaveBeenCalled();
  });
});

it("does not let a verified old email sign into a GitHub account", async () => {
  const h = harness();
  h.sqlite.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run("github-user", "player@example.com");
  h.sqlite.prepare("INSERT INTO github_identities (github_id, user_id) VALUES (?, ?)").run("123", "github-user");
  const challenge = await h.request();
  const response = await h.post("verify", { challengeId: challenge.id, code: challenge.code }, challenge.cookie);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "This account requires GitHub sign-in." });
  expect(response.headers.get("set-cookie")).toBeNull();
});
