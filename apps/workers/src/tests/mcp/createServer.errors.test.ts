import { describe, expect, it } from "vitest";
import { McpAgentIdentityError } from "../../auth/mcpAgentSeats";
import { DoRequestError, identityLimitErrorForMcp, mcpErrorData } from "../../mcp/createServer";

describe("MCP action error forwarding", () => {
  it("keeps the rejection and compacts its recovery state", () => {
    const payload = {
      ok: false,
      error: {
        code: "ILLEGAL_MOVE",
        category: "rule",
        message: "Column is full",
        actionType: "drop_disc",
        recovery: "refresh_state",
      },
      state: {
        type: "connect4",
        board: [[0, 1, 2]],
        seats: { p1: 1, p2: 2 },
        turnState: { currentPlayerId: "p1", turnNumber: 2, phase: "play" },
        you: { playerId: "p1", legalActions: ["leave", "drop_disc"] },
      },
      legalActions: ["drop_disc"],
    };

    const error = new DoRequestError(409, payload, "fallback");

    expect(error.message).toBe("Column is full");
    expect(mcpErrorData(error)).toEqual({
      ok: false,
      error: payload.error,
      state: expect.objectContaining({
        gameType: "connect4",
        board: ["012"],
        legalActions: ["drop_disc"],
        yourSeat: 1,
      }),
    });
  });

  it("returns stable agent identity error codes and recovery details", () => {
    const error = new McpAgentIdentityError("MCP_AGENT_IDENTITY_LIMIT", "Identity limit reached", {
      limit: 32,
      recoveryTools: ["agent_list"],
    });

    expect(mcpErrorData(error)).toEqual({
      error: {
        code: "MCP_AGENT_IDENTITY_LIMIT",
        category: "agent_identity",
        message: "Identity limit reached",
        limit: 32,
        recoveryTools: ["agent_list"],
      },
    });
  });

  it("explains how a second concurrent agent must recover from a seat collision", () => {
    const error = new McpAgentIdentityError(
      "MCP_AGENT_ALREADY_SEATED",
      "This agent identity already occupies this room.",
      {
        roomId: "connect4-ABC234",
        recoveryTools: ["get_state", "wait_for_turn", "agent_claim"],
        instruction:
          "Do not reuse this controllerId in another concurrent task. Resume the existing seat or acquire a new controller.",
      },
    );

    expect(mcpErrorData(error)).toEqual({
      error: expect.objectContaining({
        code: "MCP_AGENT_ALREADY_SEATED",
        roomId: "connect4-ABC234",
        recoveryTools: ["get_state", "wait_for_turn", "agent_claim"],
      }),
    });
  });

  it("tells a task with a copied controller to acquire its own", () => {
    const error = new McpAgentIdentityError(
      "MCP_AGENT_CONTROLLER_IN_USE",
      "Another AI task is already waiting with this controller.",
      {
        recoveryTools: ["agent_claim"],
        instruction: "Acquire a new controller for this AI task.",
      },
    );

    expect(mcpErrorData(error)).toEqual({
      error: expect.objectContaining({
        code: "MCP_AGENT_CONTROLLER_IN_USE",
        recoveryTools: ["agent_claim"],
      }),
    });
  });

  it("tells the MCP host to give the identity management URL to the user", () => {
    const error = identityLimitErrorForMcp(
      { FRONTEND_URL: "https://play.example/" },
      new McpAgentIdentityError("MCP_AGENT_IDENTITY_LIMIT", "Identity limit reached", {
        count: 32,
        limit: 32,
        recoveryTools: ["agent_claim"],
      }),
    );

    expect(mcpErrorData(error)).toEqual({
      error: expect.objectContaining({
        code: "MCP_AGENT_IDENTITY_LIMIT",
        managementUrl: "https://play.example/agent-log",
        recoveryTools: ["agent_claim"],
        userActionRequired: true,
        instruction:
          "Give managementUrl to the user, or wait for an abandoned idle controller to expire before retrying once.",
      }),
    });
    expect(error.message).toContain("inspect identities at https://play.example/agent-log");
  });
});
