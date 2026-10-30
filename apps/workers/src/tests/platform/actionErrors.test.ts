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

  // These wordings used to disappear into a generic bucket ("need at least" →
  // WRONG_PHASE, "spectators" → NOT_SEATED), which gave the browser a sentence
  // that never told the player what to do next.
  it.each([
    ["Need at least 3 player(s) to start", "NEED_MORE_PLAYERS"],
    ["Spectators cannot act — watch only", "SPECTATOR_CANNOT_ACT"],
    [
      "Your free Jev game has been used. Connect TypeSafe in Profile settings to keep playing.",
      "JEV_TRIAL_USED",
    ],
    ["Assign every player to a Codenames role before starting", "CODENAMES_ROLES_INCOMPLETE"],
    ["Assign exactly one blue spymaster", "CODENAMES_SPYMASTER_COUNT"],
    ["Assign at least one red operative", "CODENAMES_OPERATIVE_MISSING"],
    ["Red and blue teams must be balanced within one player", "CODENAMES_TEAMS_UNBALANCED"],
    ["That word is not in this game's dictionary", "CONTEXTO_WORD_NOT_IN_DICTIONARY"],
  ])("keeps %s out of the generic buckets", (message, code) => {
    expect(classifyActionError(message, "test_action").code).toBe(code);
  });
});
