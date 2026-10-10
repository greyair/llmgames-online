import { describe, expect, it } from "vitest";
import { isAllowedRedirectUri, redirectUriMatches } from "../../auth/mcpOAuth";
import { mcpWwwAuthenticate } from "../../auth/mcpOAuthRoutes";

describe("isAllowedRedirectUri", () => {
  it("allows https", () => {
    expect(isAllowedRedirectUri("https://example.com/callback").ok).toBe(true);
  });

  it("allows loopback http", () => {
    expect(isAllowedRedirectUri("http://127.0.0.1:8787/callback").ok).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:54321/callback").ok).toBe(true);
    expect(isAllowedRedirectUri("http://[::1]/callback").ok).toBe(true);
  });

  it("rejects non-loopback http", () => {
    const r = isAllowedRedirectUri("http://evil.example/callback");
    expect(r.ok).toBe(false);

    if (!r.ok) expect(r.error).toMatch(/loopback/i);
  });

  it("allows Cursor custom-scheme callback", () => {
    expect(isAllowedRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback").ok).toBe(true);
  });

  it("allows other native app schemes with host or path", () => {
    expect(isAllowedRedirectUri("vscode://mcp/oauth/callback").ok).toBe(true);
    expect(isAllowedRedirectUri("myapp:/oauth/callback").ok).toBe(true);
  });

  it("rejects dangerous schemes", () => {
    expect(isAllowedRedirectUri("javascript:alert(1)").ok).toBe(false);
    expect(isAllowedRedirectUri("data:text/html,hi").ok).toBe(false);
    expect(isAllowedRedirectUri("file:///etc/passwd").ok).toBe(false);
  });

  it("rejects bare scheme", () => {
    expect(isAllowedRedirectUri("cursor:").ok).toBe(false);
  });
});

describe("mcpWwwAuthenticate", () => {
  it("emits RFC 9728 resource metadata without leaking placeholder text", () => {
    expect(mcpWwwAuthenticate("https://www.llmgames.online")).toBe(
      'Bearer resource_metadata="https://www.llmgames.online/api/v1/oauth/protected-resource", scope="mcp"',
    );
  });
});

describe("redirectUriMatches", () => {
  it("exact match for custom schemes", () => {
    const u = "cursor://anysphere.cursor-mcp/oauth/callback";
    expect(redirectUriMatches(u, u)).toBe(true);
    expect(redirectUriMatches(u, "cursor://other/oauth/callback")).toBe(false);
  });

  it("loopback port flexibility", () => {
    expect(
      redirectUriMatches("http://127.0.0.1:9999/callback", "http://127.0.0.1:1/callback"),
    ).toBe(true);
  });
});
