import { describe, expect, it } from "vitest";
import { classifyActionError } from "../../durable-objects/actionErrors";

describe("agent action error taxonomy", () => {
  it.each([
    ["Unknown action: teleport", "UNSUPPORTED_ACTION", "scope", 400],
    ["row and col must be integers 0–7", "INVALID_ACTION_DATA", "input", 400],
    ["Not your turn", "NOT_YOUR_TURN", "state", 409],
    ["Not player phase", "WRONG_PHASE", "state", 409],
    ["Illegal move: placement must bracket opponent discs", "ILLEGAL_MOVE", "rule", 422],
    ["Not enough chips to double", "INSUFFICIENT_RESOURCE", "resource", 422],
    ["Column is full", "ALREADY_RESOLVED", "state", 409],
    ["Only the host can start", "FORBIDDEN", "permission", 403],
    ["Not a seated player", "NOT_SEATED", "permission", 403],
    ["Player not found", "NOT_FOUND", "not_found", 404],
    ["Deck empty", "INTERNAL_STATE", "internal", 500],
  ])("classifies %s", (message, code, category, status) => {
    expect(classifyActionError(message, "test_action")).toMatchObject({
      code,
      category,
      httpStatus: status,
      actionType: "test_action",
    });
  });

  it("falls back to a stable rule rejection instead of an untyped string", () => {
    expect(classifyActionError("That combination is unavailable", "act")).toMatchObject({
      code: "ACTION_REJECTED",
      category: "rule",
      recovery: "refresh_state",
      httpStatus: 422,
    });
  });
});
