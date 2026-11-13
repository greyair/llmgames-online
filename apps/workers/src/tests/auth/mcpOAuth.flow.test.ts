import { z } from "zod";
import { testDatabase } from "../fixtures/auth";
import { consentCallback } from "../fixtures/consentCallback";
import { testEnv } from "../fixtures/env";

import { Hono } from "hono";
import { verify } from "hono/jwt";
import { describe, expect, it } from "vitest";
import type { Env, User, Variables } from "../../types";
import {
  browserLoginDestination,
  loginReturnDestination,
  startGoogleOAuth,
} from "../../auth/google";
import { browserContentSecurityPolicy, createAccessToken } from "../../auth/mcpOAuth";
import { mcpOAuthApiRoutes } from "../../auth/mcpOAuthRoutes";
import { oauthCallbackHandoff } from "../../auth/oauthHandoff";

const secret = "test-secret-that-is-long-enough-for-hmac";

type PendingRequest = {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scopes: string;
  resource: string;
  state: string;
  expires_at: number;
  created_at: number;
};

function consentHarness(
  redirectUri = "http://127.0.0.1:4567/callback",
  options: { signedIn?: boolean } = {},
) {
  const now = Math.floor(Date.now() / 1000);

  const pending: PendingRequest = {
    id: "request-1",
    client_id: "client-1",
    redirect_uri: redirectUri,
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    scopes: "mcp",
    resource: "https://example.test/api/v1/mcp",
    state: "client-state",
    expires_at: now + 900,
    created_at: now,
  };

  const { sqlite, db } = testDatabase();
  sqlite.exec(
    "INSERT INTO users (id,email,gamertag) VALUES ('user-1','player@example.test','PlayerOne')",
  );
  sqlite
    .prepare(
      "INSERT INTO oauth_clients (client_id,client_name,redirect_uris,created_at) VALUES (?,?,?,?)",
    )
    .run("client-1", "Cursor <Beta>", JSON.stringify([redirectUri]), now);
  sqlite
    .prepare(
      "INSERT INTO oauth_pending_requests (id,client_id,redirect_uri,code_challenge,code_challenge_method,scopes,resource,state,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      pending.id,
      pending.client_id,
      pending.redirect_uri,
      pending.code_challenge,
      pending.code_challenge_method,
      pending.scopes,
      pending.resource,
      pending.state,
      pending.expires_at,
      pending.created_at,
    );

  const user: User = {
    id: "user-1",
    email: "player@example.test",
    name: "Player One",
    gamertag: "PlayerOne",
    created_at: now,
    updated_at: now,
  };

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    if (options.signedIn ?? true) c.set("user", user);
    await next();
  });
  app.route("/", mcpOAuthApiRoutes);

  return {
    app,
    sqlite,
    env: testEnv({ DB: db, ENCRYPTION_SECRET: secret }),
    markCodeRedeemed: () => {
      sqlite
        .prepare(
          "INSERT INTO oauth_authorization_codes (code_hash,client_id,user_id,redirect_uri,code_challenge,scopes,expires_at,used_at,pending_request_id) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(
          "redeemed",
          "client-1",
          "user-1",
          redirectUri,
          "a".repeat(43),
          "mcp",
          now + 600,
          now,
          "request-1",
        );
    },
  };
}

describe("MCP OAuth browser flow", () => {
  it("renders consent with the native llmgames shell and escaped client name", async () => {
    const { app, env } = consentHarness();
    env.FRONTEND_URL = "http://localhost:3000";

    const response = await app.request(
      "https://example.test/consent?req=request-1",
      undefined,
      env,
    );

    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Connect Cursor &lt;Beta&gt;");
    expect(html).toContain('name="decision" value="allow"');
    expect(html).toContain('name="decision" value="deny"');
    expect(html).toContain('action="/api/v1/oauth/change-account"');
    expect(html).toContain('aria-label="llmgames home"');
    expect(html).toContain("http://localhost:3000/fonts/geist-variable.woff2");
    expect(html).not.toContain("fonts.googleapis.com");
    // Approval must navigate to the client, never disappear into a frame.
    expect(html).not.toContain("data-oauth-approval");
    expect(html).not.toContain('createElement("iframe")');
    expect(html).not.toContain("Connection approved");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "form-action 'self' http://127.0.0.1:4567",
    );
    expect(response.headers.get("Content-Security-Policy")).toMatch(/script-src 'nonce-[a-f0-9]+'/);
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "font-src 'self' http://localhost:3000",
    );
  });

  it("preserves the MCP request while offering both login methods", async () => {
    const { app, env } = consentHarness();
    Object.assign(env, { GOOGLE_CLIENT_ID: "google-client-id" });

    const response = await app.request(
      "https://example.test/change-account",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ req: "request-1" }),
      },
      env,
    );

    const location = new URL(response.headers.get("Location")!);
    const cookies = response.headers.get("Set-Cookie")!;

    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("return_to")).toBe("/api/v1/oauth/consent?req=request-1");
    expect(cookies).toContain("session=");
    expect(cookies).toContain("Max-Age=0");
  });

  it("hands a browser callback to the client with a document instead of a redirect", async () => {
    const relay = "https://oauth-redirect.googleusercontent.com/r/gemini";
    const { app, sqlite, env } = consentHarness(relay);

    const approve = () =>
      app.request(
        "https://example.test/consent",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ req: "request-1", decision: "allow" }),
        },
        env,
      );

    const first = await approve();
    const second = await approve();
    const html = await first.clone().text();
    const firstCallback = await consentCallback(first);
    const secondCallback = await consentCallback(second);

    // A redirect here is what Chrome refuses once the relay adds another hop.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get("Location")).toBeNull();
    expect(first.headers.get("Cache-Control")).toContain("no-store");
    expect(first.headers.get("Content-Security-Policy")).toContain("form-action 'none'");
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("Continue");
    expect(firstCallback.origin).toBe("https://oauth-redirect.googleusercontent.com");
    expect(firstCallback.searchParams.get("state")).toBe("client-state");
    expect(secondCallback.searchParams.get("state")).toBe("client-state");
    expect(firstCallback.searchParams.get("code")).toBeTruthy();
    expect(secondCallback.searchParams.get("code")).toBeTruthy();

    const authorizationCodes = sqlite
      .prepare("SELECT pending_request_id FROM oauth_authorization_codes")
      .all();

    expect(authorizationCodes).toHaveLength(2);
    expect(authorizationCodes.every((code) => code.pending_request_id === "request-1")).toBe(true);
  });

  it("hands a denied request back with the error and the original state", async () => {
    const { app, env } = consentHarness("https://oauth-redirect.googleusercontent.com/r/gemini");

    const response = await app.request(
      "https://example.test/consent",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ req: "request-1", decision: "deny" }),
      },
      env,
    );

    const callback = await consentCallback(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(callback.searchParams.get("error")).toBe("access_denied");
    expect(callback.searchParams.get("state")).toBe("client-state");
  });

  it("escapes the callback out of the handoff document", async () => {
    const response = oauthCallbackHandoff(
      'https://client.example/cb?next="><script>alert(1)</script>&x=1',
    );

    const html = await response.text();

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("asks an expired session to sign in again without losing the request", async () => {
    const { app, env } = consentHarness("https://oauth-redirect.googleusercontent.com/r/gemini", {
      signedIn: false,
    });

    env.FRONTEND_URL = "https://games.xsrc.in";

    const response = await app.request(
      "https://example.test/consent",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ req: "request-1", decision: "allow" }),
      },
      env,
    );

    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("Location")!).searchParams.get("return_to")).toBe(
      "/api/v1/oauth/consent?req=request-1",
    );
  });

  it("refuses a consent POST for a request that already expired", async () => {
    const { app, sqlite, env } = consentHarness();
    sqlite
      .prepare("UPDATE oauth_pending_requests SET expires_at = ?")
      .run(Math.floor(Date.now() / 1000) - 1);

    const response = await app.request(
      "https://example.test/consent",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ req: "request-1", decision: "allow" }),
      },
      env,
    );

    expect(response.status).toBe(410);
    expect(await response.text()).toContain("This request is no longer available");
  });

  it("reports success only after the client redeems the authorization code", async () => {
    const { app, env, markCodeRedeemed } = consentHarness();

    const readStatus = () =>
      app.request(
        "https://example.test/handoff-status",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ req: "request-1" }),
        },
        env,
      );

    const pending = await readStatus();
    expect(await pending.json()).toEqual({ status: "pending" });

    markCodeRedeemed();
    const complete = await readStatus();
    expect(await complete.json()).toEqual({ status: "complete" });
  });

  it("keeps custom-scheme callbacks as a direct 303 redirect", async () => {
    const { app, env } = consentHarness("cursor://anysphere.cursor-mcp/oauth/callback");

    const response = await app.request(
      "https://example.test/consent",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ req: "request-1", decision: "allow" }),
      },
      env,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toMatch(/^cursor:\/\//);
  });

  it("returns a real gone status for an unavailable consent request", async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();

    const { db } = testDatabase();
    app.route("/", mcpOAuthApiRoutes);

    const response = await app.request(
      "https://example.test/consent?req=missing",
      undefined,
      testEnv({ DB: db }),
    );

    expect(response.status).toBe(410);
    expect(await response.text()).toContain("This request is no longer available");
  });
});

describe("Google OAuth state cookies", () => {
  it("isolates concurrent browser attempts in separate cookies", async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.get("/start", (c) => startGoogleOAuth(c, { mode: "json" }));

    const env = testEnv({ ENCRYPTION_SECRET: secret, GOOGLE_CLIENT_ID: "google-client-id" });

    const first = await app.request("https://example.test/start", undefined, env);
    const second = await app.request("https://example.test/start", undefined, env);
    const firstCookie = first.headers.get("Set-Cookie")!;
    const secondCookie = second.headers.get("Set-Cookie")!;
    const firstName = firstCookie.split("=", 1)[0];
    const secondName = secondCookie.split("=", 1)[0];

    expect(firstName).toMatch(/^oauth_state_[a-f0-9]{64}$/);
    expect(secondName).toMatch(/^oauth_state_[a-f0-9]{64}$/);
    expect(firstName).not.toBe(secondName);
    expect(firstCookie).toContain("Max-Age=600");
    expect(secondCookie).toContain("Max-Age=600");
  });

  it("rejects network-path return targets that use backslashes", async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.get("/start", (c) =>
      startGoogleOAuth(c, {
        mode: "json",
        returnTo: c.req.query("returnTo"),
      }),
    );

    const env = testEnv({ ENCRYPTION_SECRET: secret, GOOGLE_CLIENT_ID: "google-client-id" });

    const malicious = encodeURIComponent("/\\evil.example/path");

    const response = await app.request(
      `https://example.test/start?returnTo=${malicious}`,
      undefined,
      env,
    );

    const cookie = response.headers.get("Set-Cookie")!;
    const token = cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf(";"));

    const payload = z
      .object({ returnTo: z.union([z.string(), z.null()]).optional() })
      .parse(await verify(token, secret, "HS256"));

    expect(payload.returnTo).toBeNull();
  });
});

describe("Google OAuth browser destination", () => {
  it("sends returning players straight to the app", () => {
    expect(
      browserLoginDestination("https://www.llmgames.online", {
        gamertag_selected: 1,
      }),
    ).toBe("https://www.llmgames.online/play");
  });

  it("sends new players through onboarding", () => {
    expect(
      browserLoginDestination("https://www.llmgames.online", {
        gamertag_selected: 0,
      }),
    ).toBe("https://www.llmgames.online/onboarding");
  });

  it("resolves app returns against the frontend and MCP returns against the API", () => {
    expect(loginReturnDestination("/play", "http://localhost:6787", "http://localhost:3000")).toBe(
      "http://localhost:3000/play",
    );
    expect(
      loginReturnDestination(
        "/api/v1/oauth/consent?req=abc",
        "http://localhost:6787",
        "http://localhost:3000",
      ),
    ).toBe("http://localhost:6787/api/v1/oauth/consent?req=abc");
  });
});

describe("MCP OAuth access tokens", () => {
  it("issues access tokens for seven days", async () => {
    const user: User = {
      id: "user-1",
      email: "player@example.test",
      name: "Player One",
      gamertag: "PlayerOne",
      gamertag_selected: 1,
      created_at: 0,
      updated_at: 0,
    };

    const token = await createAccessToken(secret, user, {
      clientId: "client-1",
      resource: "https://example.test/api/v1/mcp",
      scope: "mcp",
    });

    const payload = z
      .object({ iat: z.number(), exp: z.number() })
      .parse(await verify(token.access_token, secret, "HS256"));

    expect(token.expires_in).toBe(7 * 24 * 60 * 60);
    expect(payload.exp - payload.iat).toBe(7 * 24 * 60 * 60);
  });
});

describe("OAuth callback frame policy", () => {
  it("allows only the validated loopback origin for a background callback", () => {
    expect(browserContentSecurityPolicy("http://127.0.0.1:4567/callback", "test")).toContain(
      "frame-src 'self' http://127.0.0.1:4567;",
    );
    expect(browserContentSecurityPolicy("http://localhost:9999/callback", "test")).toContain(
      "frame-src 'self' http://localhost:9999;",
    );
    expect(browserContentSecurityPolicy("https://client.example/callback", "test")).toContain(
      "frame-src 'none';",
    );
    expect(browserContentSecurityPolicy("cursor://callback", "test")).toContain(
      "frame-src 'none';",
    );
  });
});
