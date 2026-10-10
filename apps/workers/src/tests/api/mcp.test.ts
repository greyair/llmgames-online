import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env, Variables } from "../../types";
import { mcpRoutes } from "../../api/mcp";

function unauthenticatedRoutes() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("user", null);
    await next();
  });
  app.route("/", mcpRoutes);

  return app;
}

describe("MCP HTTP boundary", () => {
  it("publishes the enabled discovery catalog and the OAuth endpoint", async () => {
    const response = await mcpRoutes.request("https://games.test/info");
    expect(response.status).toBe(200);

    const body = await response.json<{
      endpoint: string;
      games: string[];
      tools: { core: string[] };
      auth: { preferred: string };
      agents: {
        model: string;
        credentialPrivacy: string;
      };
    }>();

    expect(body.endpoint).toBe("https://games.test/api/v1/mcp");
    expect(body.auth.preferred).toBe("oauth2.1");
    expect(body.games).toEqual([
      "connect4",
      "pokemon",
      "reversi",
      "checkers",
      "codenames",
      "battleship",
      "poker",
      "contexto",
    ]);
    expect(body.tools.core).toContain("wait_for_turn");
    expect(body.tools.core).toContain("send_action");
    expect(body.tools.core).toContain("agent_list");
    expect(body.tools.core).not.toContain("agent_delete");
    expect(body.tools.core).not.toContain("ranked_matchmaking");
    expect(body.tools.core).not.toContain("ranked_leaderboard");
    expect(body.agents.model).toContain("controllerId");
    expect(body.agents.credentialPrivacy).toContain("agentId stays server-side");
  });

  it("returns an OAuth challenge without starting an MCP session", async () => {
    const response = await unauthenticatedRoutes().request("https://games.test/");
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: "unauthorized",
      login: "https://games.test/api/v1/oauth/authorize",
    });
  });

  it("allows protocol preflight without requiring OAuth", async () => {
    const response = await unauthenticatedRoutes().request("https://games.test/", {
      method: "OPTIONS",
    });

    expect(response.status).toBe(204);
  });
});
