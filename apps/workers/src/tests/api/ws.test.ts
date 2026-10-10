import { testEnv, testNamespace } from "../fixtures/env";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env, User, Variables } from "../../types";
import { wsRoutes } from "../../api/ws";

const user: User = {
  id: "user-1",
  email: "player@example.test",
  name: "Player",
  gamertag: "PlayerOne",
  created_at: 0,
  updated_at: 0,
};

function testApp() {
  const calls: Array<{ request: Request; namespaceId: string }> = [];

  const namespace = testNamespace(async (namespaceId, request) => {
    calls.push({ request, namespaceId });

    return new Response("forwarded");
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", wsRoutes);

  const env = testEnv({
    CONNECT4_ROOM: namespace,
    REVERSI_ROOM: namespace,
    CODENAMES_ROOM: namespace,
    BATTLESHIP_ROOM: namespace,
    POKER_ROOM: namespace,
  });

  return { app, env, calls };
}

describe("WebSocket route boundary", () => {
  it("canonicalizes aliases and forwards the authenticated browser seat", async () => {
    const harness = testApp();

    const response = await harness.app.request(
      "https://api.test/games/holdem-ab2345?roomCode=wrong",
      undefined,
      harness.env,
    );

    expect(response.status).toBe(200);
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]!.namespaceId).toBe("poker-AB2345");
    expect(harness.calls[0]!.request.url).toContain("roomCode=AB2345");
    expect(harness.calls[0]!.request.headers.get("x-user-id")).toBe("user-1");
    expect(harness.calls[0]!.request.headers.get("x-seat-channel")).toBe("browser");
  });

  it("rejects malformed room ids without forwarding them", async () => {
    const harness = testApp();

    const response = await harness.app.request("/games/not-a-room", undefined, harness.env);

    expect(response.status).toBe(400);
    expect(harness.calls).toHaveLength(0);
  });

  it("rejects removed Blackjack rooms without forwarding them", async () => {
    const harness = testApp();

    const response = await harness.app.request("/games/blackjack-AB2345", undefined, harness.env);

    expect(response.status).toBe(400);
    expect(harness.calls).toHaveLength(0);
  });
});
