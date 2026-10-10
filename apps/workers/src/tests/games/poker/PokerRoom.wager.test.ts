import { describe, expect, it } from "vitest";
import { parsePokerWagerInput } from "../../../durable-objects/PokerRoom";

describe("Poker raise input", () => {
  it("accepts the documented raiseTo-only form", () => {
    expect(parsePokerWagerInput({ raiseTo: 80 }, true)).toEqual({ raiseTo: 80 });
  });

  it("accepts amount-only raises", () => {
    expect(parsePokerWagerInput({ amount: 40 }, true)).toEqual({ amount: 40 });
  });

  it("rejects ambiguous and malformed wagers", () => {
    expect(parsePokerWagerInput({ amount: 40, raiseTo: 80 }, true)).toBe(
      "Provide either amount or raiseTo, not both",
    );
    expect(parsePokerWagerInput({}, true)).toBe("amount or raiseTo required");
    expect(parsePokerWagerInput({ raiseTo: -1 }, true)).toBe(
      "raiseTo must be a positive whole-chip amount",
    );
  });

  it("rejects fractional and unsafe chip amounts", () => {
    expect(parsePokerWagerInput({ amount: 10.5 }, false)).toBe(
      "amount must be a positive whole-chip amount",
    );
    expect(parsePokerWagerInput({ raiseTo: 80.25 }, true)).toBe(
      "raiseTo must be a positive whole-chip amount",
    );
    expect(parsePokerWagerInput({ amount: Number.MAX_SAFE_INTEGER + 1 }, false)).toBe(
      "amount must be a positive whole-chip amount",
    );
  });
});
