import { describe, expect, it, vi } from "vitest";
import { logEvent } from "../../lib/observability";

describe("diagnostic events", () => {
  it("writes one JSON line without sensitive fields", () => {
    const write = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      logEvent("mcp_action_failed", {
        actionType: "drop_disc",
        accessToken: "super-secret",
        agentId: "private-identity",
        ownerEmail: "player@example.test",
        attempts: 2,
        terminal: false,
        reason: undefined,
      });

      expect(write).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(write.mock.calls[0]?.[0]));

      expect(payload).toMatchObject({
        event: "mcp_action_failed",
        actionType: "drop_disc",
        attempts: 2,
        terminal: false,
      });
      expect(payload).not.toHaveProperty("accessToken");
      expect(payload).not.toHaveProperty("agentId");
      expect(payload).not.toHaveProperty("ownerEmail");
      expect(payload).not.toHaveProperty("reason");
    } finally {
      write.mockRestore();
    }
  });

  it("truncates long strings so a log line stays bounded", () => {
    const write = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      logEvent("room_lifecycle", { detail: "x".repeat(500) });
      const payload = JSON.parse(String(write.mock.calls[0]?.[0]));

      expect(payload.detail).toHaveLength(120);
    } finally {
      write.mockRestore();
    }
  });
});
