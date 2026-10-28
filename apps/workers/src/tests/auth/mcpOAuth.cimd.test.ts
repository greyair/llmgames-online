import type { WireObject } from "@llmgames/game-catalog";
import { Hono } from "hono";
import { z } from "zod";
import { testEnv } from "../fixtures/env";
import { mcpOAuthApiRoutes } from "../../auth/mcpOAuthRoutes";
import type { Env, Variables } from "../../types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testDatabase } from "../fixtures/auth";
import { resolveClient } from "../../auth/mcpOAuth";

const clientId = "https://chatgpt.com/oauth/client.json";

const baseMetadata = {
  client_id: clientId,
  client_name: "ChatGPT",
  redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
};

async function resolveMetadata(metadata: WireObject) {
  const { db } = testDatabase();
  const fetcher = vi.fn(async () => Response.json(metadata));
  vi.stubGlobal("fetch", fetcher);

  return { client: await resolveClient(db, clientId), fetcher };
}

describe("CIMD authentication method negotiation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts ChatGPT metadata when the methods intersection contains none", async () => {
    const { client, fetcher } = await resolveMetadata({
      ...baseMetadata,
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    });

    expect(client?.client_id).toBe(clientId);
    expect(client?.token_endpoint_auth_method).toBe("none");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(clientId, expect.objectContaining({ redirect: "manual" }));
  });

  it("rejects metadata which only supports private_key_jwt", async () => {
    const { client } = await resolveMetadata({
      ...baseMetadata,
      token_endpoint_auth_method: "none",
      token_endpoint_auth_methods_supported: ["private_key_jwt"],
    });

    expect(client).toBeNull();
  });

  it("does not follow redirected metadata documents", async () => {
    const { db } = testDatabase();
    const fetcher = vi.fn(async () => Response.redirect("https://example.com/client.json", 302));
    vi.stubGlobal("fetch", fetcher);
    expect(await resolveClient(db, clientId)).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("preserves the singular none fallback for legacy metadata", async () => {
    const { client } = await resolveMetadata({ ...baseMetadata, token_endpoint_auth_method: "none" });
    expect(client?.token_endpoint_auth_method).toBe("none");
  });

  it("rejects malformed and empty method lists", async () => {
    for (const methods of [[], "none", ["none", 42]]) {
      const { client } = await resolveMetadata({ ...baseMetadata, token_endpoint_auth_methods_supported: methods });
      expect(client).toBeNull();
    }
  });

  it("still rejects mismatched client ids and unsafe redirect URIs", async () => {
    for (const metadata of [
      { ...baseMetadata, client_id: "https://other.example/client.json" },
      { ...baseMetadata, redirect_uris: ["http://192.168.1.1/callback"] },
    ]) {
      const { client } = await resolveMetadata({ ...metadata, token_endpoint_auth_methods_supported: ["none"] });
      expect(client).toBeNull();
    }
  });
});

it("completes CIMD consent, PKCE exchange, and refresh using public authentication", async () => {
  const { sqlite, db } = testDatabase();
  sqlite.prepare("INSERT INTO users (id,email,gamertag) VALUES (?,?,?)").run("u1", "player@example.test", "PlayerOne");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...baseMetadata, token_endpoint_auth_method: "private_key_jwt", token_endpoint_auth_methods_supported: ["none", "private_key_jwt"] })));

  try {
    const env = testEnv({ DB: db, ENCRYPTION_SECRET: "test-secret-that-is-long-enough-for-hmac" });
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", async (c, next) => {
      c.set("user", { id: "u1", email: "player@example.test", name: null, gamertag: "PlayerOne", created_at: 0, updated_at: 0 });
      await next();
    });
    app.route("/", mcpOAuthApiRoutes);
    const verifier = "v".repeat(43);
    const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
    const redirect = baseMetadata.redirect_uris[0]!;
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "test-state", scope: "mcp", resource: "https://example.test/api/v1/mcp" });
    const auth = await app.request(`https://example.test/authorize?${query}`, {}, env);
    expect(auth.status).toBe(302);
    const consentUrl = new URL(auth.headers.get("location")!);
    const approved = await app.request("https://example.test/consent", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ req: consentUrl.searchParams.get("req")!, decision: "allow" }) }, env);
    expect(approved.status).toBe(303);
    const callback = new URL(approved.headers.get("location")!);
    expect(callback.searchParams.get("state")).toBe("test-state");
    const exchange = { grant_type: "authorization_code", client_id: clientId, redirect_uri: redirect, code: callback.searchParams.get("code"), code_verifier: verifier, resource: "https://example.test/api/v1/mcp" };
    const post = (data: WireObject) => app.request("https://example.test/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }, env);
    expect((await post({ ...exchange, code_verifier: "incorrect" })).status).toBe(400);
    expect((await post({ ...exchange, client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: "not-a-valid-signature" })).status).toBe(401);
    const response = await post(exchange);
    expect(response.status).toBe(200);
    const tokens = z.object({ access_token: z.string(), refresh_token: z.string() }).parse(await response.json());
    expect((await post(exchange)).status).toBe(400);
    expect((await post({ client_id: clientId, grant_type: "refresh_token", refresh_token: tokens.refresh_token, resource: "https://example.test/api/v1/mcp" })).status).toBe(200);
  } finally { vi.unstubAllGlobals(); }
});
