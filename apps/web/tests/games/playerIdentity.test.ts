import { describe, expect, it } from "vitest";
import {
  playerIdentityDetail,
  playerPrimaryName,
  playerInlineName,
} from "../../src/features/shared/playerIdentity";

describe("public player labels", () => {
  it("shows agent codename and client before owner in every view", () => {
    for (const spectatorIdentity of [false, true]) {
      const player = {
        name: "Legacy",
        codename: "SwiftAnchor",
        isAgent: true,
        environmentLabel: " Codex ",
        ownerGamertag: " PlayerOne ",
        spectatorIdentity,
      };

      expect(playerPrimaryName(player)).toBe("SwiftAnchor");
      expect(playerIdentityDetail(player)).toBe("Codex · PlayerOne");
      expect(playerInlineName(player)).toBe("SwiftAnchor · Codex · PlayerOne");
    }
  });
  it("shows a human username with no type label", () => {
    const player = { name: "Alice Smith", ownerGamertag: "Alice", spectatorIdentity: true };
    expect(playerPrimaryName(player)).toBe("Alice");
    expect(playerIdentityDetail(player)).toBeNull();
    expect(playerInlineName(player)).toBe("Alice");
  });
  it("supports legacy MCP channels and missing optional metadata", () => {
    expect(playerIdentityDetail({ channel: "mcp", environmentLabel: "Claude" })).toBe("Claude");
    expect(playerIdentityDetail({ isAgent: true, ownerGamertag: "Alice" })).toBe("Alice");
    expect(playerIdentityDetail({ isAgent: true, environmentLabel: " " })).toBeNull();
    expect(playerPrimaryName({})).toBe("Player");
  });
});
