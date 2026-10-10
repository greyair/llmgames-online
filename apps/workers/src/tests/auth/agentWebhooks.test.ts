import { z } from "zod";
import { testUser } from "../fixtures/auth";
import { SQLiteD1 } from "../fixtures/sqlite-d1";
import { testEnv, testNamespace } from "../fixtures/env";
import { DatabaseSync } from "node:sqlite";
import { URL } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentWebhookRoutes } from "../../auth/agentWebhooks";
import { decryptWebhook, webhookUrl } from "../../agents/webhooks";
import type { Env, Variables } from "../../types";

const webhookRowSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  name: z.string(),
  hostname: z.string(),
  header_name: z.string(),
  ciphertext: z.string(),
  nonce: z.string(),
  key_version: z.string(),
  created_at: z.number(),
  last_attempt_at: z.number().nullable(),
  last_delivery: z.string().nullable(),
});

const input = {
  name: "Cursor agent",
  url: "https://hooks.example.com/private-path?key=private-url-token",
  headerName: "Authorization",
  headerValue: "Bearer test-webhook-secret",
};

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
  const roomCheck = vi.fn(async () => Response.json({ ok: true }));

  const env = testEnv({
    FRONTEND_URL: "https://site.example.com",
    JEV_CREDENTIAL_KEYS: JSON.stringify({ v1: btoa("a".repeat(32)) }),
    CONNECT4_ROOM: testNamespace(async () => roomCheck()),
    DB: new SQLiteD1(db),
  });

  let owner = "host";
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    if (auth) {
      c.set("user", testUser({ id: owner }));
      c.set("session", {
        userId: owner,
        email: "host@test.invalid",
        name: null,
        expiresAt: 9999999999,
        authenticatedAt: Math.floor(Date.now() / 1000),
      });

      if (mcp) c.set("mcpClientId", "mcp");
    }

    await next();
  });
  app.route("/hooks", agentWebhookRoutes);

  const request = (
    method = "GET",
    path = "",
    body?: import("@llmgames/game-catalog").WireValue,
    origin = "https://site.example.com",
  ) =>
    app.request(
      `https://site.example.com/hooks${path}`,
      {
        method,
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );

  const create = async (value = input) => {
    const res = await request("POST", "", value);
    expect(res.status).toBe(200);

    return z.object({ id: z.string() }).parse(await res.json()).id;
  };

  const activeRoom = () =>
    db
      .prepare(
        "INSERT INTO active_rooms (room_code,game_type,room_id,status,expires_at,created_at) VALUES ('ABC234','connect4','connect4-ABC234','active',?,?)",
      )
      .run(Date.now() + 600000, Date.now());

  return {
    db,
    env,
    request,
    create,
    activeRoom,
    roomCheck,
    setOwner: (id: string) => {
      owner = id;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("agent webhooks", () => {
  it("requires a browser session and same-origin writes", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    for (const [auth, mcp] of [
      [false, false],
      [true, true],
    ]) {
      const h = harness(auth, mcp);
      expect((await h.request()).status).toBe(401);
      h.db.close();
    }

    const h = harness();
    expect((await h.request("POST", "", input, "https://evil.example.com")).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    h.db.close();
  });
  it("stores multiple encrypted destinations, returns metadata only, and isolates owners", async () => {
    const h = harness();
    const id = await h.create();
    await h.create({ ...input, name: "Other agent" });

    const row = webhookRowSchema.parse(
      h.db.prepare("SELECT * FROM agent_webhooks WHERE id=?").get(id),
    );

    expect(JSON.stringify(row)).not.toContain(input.headerValue);
    expect(JSON.stringify(row)).not.toContain("private-path");
    expect(await decryptWebhook(h.env, row)).toEqual({
      url: input.url,
      headerValue: input.headerValue,
    });
    await expect(decryptWebhook(h.env, { ...row, owner_id: "guest" })).rejects.toThrow();
    await expect(decryptWebhook(h.env, { ...row, id: "swapped" })).rejects.toThrow();
    const res = await h.request();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.text();
    expect(body).not.toContain("private-");
    expect(JSON.parse(body).webhooks).toHaveLength(2);
    h.setOwner("guest");
    expect(await (await h.request()).json()).toMatchObject({ webhooks: [] });
    expect(
      (await h.request("PUT", `/${id}`, { name: "Stolen", headerName: "Authorization" })).status,
    ).toBe(404);
    expect((await h.request("POST", `/${id}/invite`, { roomCode: "ABC234" })).status).toBe(404);
    await h.request("DELETE", `/${id}`);
    expect(h.db.prepare("SELECT id FROM agent_webhooks WHERE id=?").get(id)).toBeTruthy();
    h.db.close();
  });
  it("preserves blank edit fields, allows explicit removal of auth, and deletes a webhook", async () => {
    const h = harness();
    const id = await h.create();
    expect(
      (await h.request("PUT", `/${id}`, { name: "Renamed", headerName: "Authorization" })).status,
    ).toBe(200);

    let row = webhookRowSchema.parse(
      h.db.prepare("SELECT * FROM agent_webhooks WHERE id=?").get(id),
    );

    expect(await decryptWebhook(h.env, row)).toEqual({
      url: input.url,
      headerValue: input.headerValue,
    });
    await h.request("PUT", `/${id}`, {
      name: "Renamed",
      headerName: "Authorization",
      headerValue: "",
    });
    row = webhookRowSchema.parse(h.db.prepare("SELECT * FROM agent_webhooks WHERE id=?").get(id));
    expect((await decryptWebhook(h.env, row)).headerValue).toBe("");
    await h.request("DELETE", `/${id}`);
    expect(await (await h.request()).json()).toMatchObject({ webhooks: [] });
    h.db.close();
  });
  it.each([
    "http://hooks.example.com",
    "https://127.0.0.1",
    "https://2130706433",
    "https://[::1]",
    "https://a.local",
    "https://metadata.google.internal",
    "https://localhost",
    "https://a.example.com:8080",
    "https://user:pass@hooks.example.com",
    "https://hooks.example.com/#secret",
    "https://a..com",
    "https://host.home.arpa",
  ])("rejects unsafe URL %s", (url) => expect(webhookUrl(url)).toBeNull());
  it("rejects routing headers and newlines, enforces a storage limit, and fails closed without encryption", async () => {
    const h = harness();

    for (const headerName of [
      "Host",
      "Cookie",
      "Content-Type",
      "CF-Access-Client-Secret",
      "X-Forwarded-For",
      "Proxy-Authorization",
    ])
      expect((await h.request("POST", "", { ...input, headerName })).status).toBe(400);
    expect(
      (await h.request("POST", "", { ...input, headerValue: "token\r\nCookie: stolen" })).status,
    ).toBe(400);

    for (let i = 0; i < 10; i++) await h.create();
    expect((await h.request("POST", "", input)).status).toBe(409);
    h.env.JEV_CREDENTIAL_KEYS = undefined;
    expect((await h.request("POST", "", input)).status).toBe(503);
    h.db.close();
  });
  it("sends one bounded POST with canonical room data and no account credentials, then prevents duplicate delivery", async () => {
    const h = harness();
    const id = await h.create();
    h.activeRoom();

    const fetcher = vi.fn(
      async (_url: string, _options: RequestInit) => new Response(null, { status: 202 }),
    );

    vi.stubGlobal("fetch", fetcher);

    const results = await Promise.all([
      h.request("POST", `/${id}/invite`, { roomCode: "ABC234" }),
      h.request("POST", `/${id}/invite`, { roomCode: "ABC234" }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe(input.url);
    expect(options).toMatchObject({
      method: "POST",
      redirect: "manual",
      signal: expect.any(AbortSignal),
    });
    const headers = new Headers(options.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe(input.headerValue);
    const payload = JSON.parse(z.string().parse(options.body));
    expect(payload).toMatchObject({
      event: "llmgames.invite",
      version: 1,
      action: "join",
      roomCode: "ABC234",
      gameType: "connect4",
      mcpUrl: "https://site.example.com/api/v1/mcp",
    });
    expect(payload.joinUrl).toContain("roomCode=ABC234");

    for (const key of ["ownerId", "agentId", "controllerId", "email", "state"])
      expect(payload).not.toHaveProperty(key);
    expect(
      h.db.prepare("SELECT last_delivery FROM agent_webhooks WHERE id=?").get(id),
    ).toMatchObject({ last_delivery: "delivered" });
    h.db.close();
  });
  it("refuses absent rooms and failed host/open-seat checks before contacting the webhook", async () => {
    const h = harness();
    const id = await h.create();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await h.request("POST", `/${id}/invite`, { roomCode: "ABC234" })).status).toBe(404);
    h.activeRoom();
    h.roomCheck.mockImplementation(async () => new Response(null, { status: 409 }));
    expect((await h.request("POST", `/${id}/invite`, { roomCode: "ABC234" })).status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
    h.db.close();
  });
  it.each([302, 401, 500])(
    "never follows redirects or exposes provider response bodies (%s)",
    async (status) => {
      const h = harness();
      const id = await h.create();
      h.activeRoom();

      const fetcher = vi.fn(
        async () =>
          new Response(input.headerValue, {
            status,
            headers: { Location: "https://other.example.com" },
          }),
      );

      vi.stubGlobal("fetch", fetcher);
      const res = await h.request("POST", `/${id}/invite`, { roomCode: "ABC234" });
      expect(res.status).toBe(502);
      expect(await res.text()).not.toContain(input.headerValue);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(
        h.db.prepare("SELECT last_delivery FROM agent_webhooks WHERE id=?").get(id),
      ).toMatchObject({ last_delivery: "failed" });
      h.db.close();
    },
  );
  it("marks network errors as uncertain and does not retry", async () => {
    const h = harness();
    const id = await h.create();
    h.activeRoom();

    const fetcher = vi.fn(async () => {
      throw new Error(input.url);
    });

    vi.stubGlobal("fetch", fetcher);
    const res = await h.request("POST", `/${id}/invite`, { roomCode: "ABC234" });
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("could not be confirmed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      h.db.prepare("SELECT last_delivery FROM agent_webhooks WHERE id=?").get(id),
    ).toMatchObject({ last_delivery: "unknown" });
    h.db.close();
  });
});
