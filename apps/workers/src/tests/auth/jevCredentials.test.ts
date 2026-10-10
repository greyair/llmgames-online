import { testUser } from "../fixtures/auth";
import { SQLiteD1 } from "../fixtures/sqlite-d1";
import { testEnv } from "../fixtures/env";
import { DatabaseSync } from "node:sqlite";
import { URL } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jevCredentialRoutes } from "../../auth/jevCredentials";
import {
  decryptJevKey,
  encryptJevKey,
  getJevCredential,
  reservePersonalJevCall,
} from "../../agents/jevCredentials";
import type { Env, Variables } from "../../types";

const apiKey = "test-private-typesafe-key";

function harness(auth = true, mcp = false) {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../../../migrations/", import.meta.url);

  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  db.exec(
    "INSERT INTO users (id,email) VALUES ('host','host@test.invalid'),('guest','guest@test.invalid')",
  );

  const env = testEnv({
    FRONTEND_URL: "https://site.test",
    JEV_CREDENTIAL_KEYS: JSON.stringify({ v1: btoa("a".repeat(32)) }),
    DB: new SQLiteD1(db),
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    if (auth) {
      c.set("user", testUser({ id: "host" }));
      c.set("session", {
        userId: "host",
        email: "host@test.invalid",
        name: null,
        expiresAt: 9999999999,
        authenticatedAt: Math.floor(Date.now() / 1000),
      });

      if (mcp) c.set("mcpClientId", "mcp");
    }

    await next();
  });
  app.route("/key", jevCredentialRoutes);

  const request = (
    method = "GET",
    body?: import("@llmgames/game-catalog").WireValue,
    origin = "https://site.test",
  ) =>
    app.request(
      "https://site.test/key",
      {
        method,
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );

  return { env, db, request };
}

afterEach(() => vi.unstubAllGlobals());

describe("personal Jev credentials", () => {
  it("requires browser authentication and rejects cross-origin writes before calling TypeSafe", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    for (const [auth, mcp, status] of [
      [false, false, 401],
      [true, true, 401],
    ] as const) {
      const h = harness(auth, mcp);
      expect((await h.request()).status).toBe(status);
      h.db.close();
    }

    const h = harness();
    expect((await h.request("PUT", {}, "https://evil.test")).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    h.db.close();
  });
  it("encrypts credentials, binds ciphertext to the owner, and returns metadata only", async () => {
    const fetcher = vi.fn(async () => Response.json({ models: [] }));
    vi.stubGlobal("fetch", fetcher);
    const h = harness();
    const response = await h.request("PUT", { apiKey, dailyLimit: 2, consent: true });
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.typesafe.ai/v1/models",
      expect.objectContaining({
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: "manual",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(await response.text()).not.toContain(apiKey);
    const row = (await getJevCredential(h.env, "host"))!;
    expect(JSON.stringify(row)).not.toContain(apiKey);
    expect(await decryptJevKey(h.env, "host", row)).toBe(apiKey);
    await expect(decryptJevKey(h.env, "guest", row)).rejects.toThrow();
    await expect(decryptJevKey(h.env, "host", { ...row, id: "swapped" })).rejects.toThrow();
    const status = await h.request();
    expect(status.headers.get("Cache-Control")).toBe("no-store");
    expect(await status.json()).toMatchObject({
      connected: true,
      trialAvailable: true,
      dailyLimit: 2,
      callsToday: 0,
    });
    expect(await getJevCredential(h.env, "guest")).toBeNull();
    h.db.close();
  });
  it("reports whether the sponsored Jev match has already been used", async () => {
    const h = harness();
    expect(await (await h.request()).json()).toMatchObject({ trialAvailable: true });
    h.db.exec("INSERT INTO jev_trial_games (owner_id) VALUES ('host')");
    expect(await (await h.request()).json()).toMatchObject({ trialAvailable: false });
    h.db.close();
  });
  it("atomically caps concurrent reservations and preserves daily usage across replacements", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ models: [] })),
    );
    const h = harness();
    await h.request("PUT", { apiKey, dailyLimit: 2, consent: true });
    const first = (await getJevCredential(h.env, "host"))!;
    expect(
      (
        await Promise.all(
          Array.from({ length: 8 }, () => reservePersonalJevCall(h.env, "host", first.id)),
        )
      ).filter(Boolean),
    ).toHaveLength(2);
    await h.request("PUT", { apiKey: apiKey + "-new", dailyLimit: 2, consent: true });
    const next = (await getJevCredential(h.env, "host"))!;
    expect(next.id).not.toBe(first.id);
    expect(await reservePersonalJevCall(h.env, "host", first.id)).toBe(false);
    expect(await reservePersonalJevCall(h.env, "host", next.id)).toBe(false);
    await h.request("DELETE");
    expect(await getJevCredential(h.env, "host")).toBeNull();
    expect(await reservePersonalJevCall(h.env, "host", next.id)).toBe(false);
    h.db.close();
  });
  it("keeps the old key on verification failure and never reflects provider errors", async () => {
    const fetcher = vi.fn(async () => Response.json({ models: [] }));
    vi.stubGlobal("fetch", fetcher);
    const h = harness();
    await h.request("PUT", { apiKey, dailyLimit: 2, consent: true });
    const row = await getJevCredential(h.env, "host");
    fetcher.mockImplementation(async () => new Response(apiKey, { status: 401 }));

    const response = await h.request("PUT", {
      apiKey: apiKey + "-new",
      dailyLimit: 2,
      consent: true,
    });

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(apiKey);
    expect(await getJevCredential(h.env, "host")).toEqual(row);
    h.db.close();
  });
  it.each([301, 302, 303, 307, 308])(
    "rejects provider redirects (%i) without replacing the saved key",
    async (status) => {
      const fetcher = vi.fn(async () => Response.json({ models: [] }));
      vi.stubGlobal("fetch", fetcher);
      const h = harness();
      await h.request("PUT", { apiKey, dailyLimit: 2, consent: true });
      const row = await getJevCredential(h.env, "host");
      fetcher.mockClear();
      fetcher.mockImplementation(
        async () =>
          new Response(null, { status, headers: { Location: "https://other.test/models" } }),
      );

      const response = await h.request("PUT", {
        apiKey: apiKey + "-new",
        dailyLimit: 2,
        consent: true,
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "TypeSafe could not verify the key right now. Try again later.",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith(
        "https://api.typesafe.ai/v1/models",
        expect.objectContaining({ redirect: "manual" }),
      );
      expect(await getJevCredential(h.env, "host")).toEqual(row);
      h.db.close();
    },
  );
  it("fails closed without the dedicated encryption key and rejects invalid limits or missing consent", async () => {
    const h = harness();

    for (const body of [
      { apiKey, dailyLimit: 0, consent: true },
      { apiKey, dailyLimit: 2, consent: false },
    ])
      expect((await h.request("PUT", body)).status).toBe(400);
    h.env.JEV_CREDENTIAL_KEYS = undefined;
    expect((await h.request("PUT", { apiKey, dailyLimit: 2, consent: true })).status).toBe(503);
    await expect(encryptJevKey(h.env, "host", "id", apiKey)).rejects.toThrow();
    h.db.close();
  });
});
