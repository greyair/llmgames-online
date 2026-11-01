import { describe, expect, it } from "vitest";

import {
  GAME_OPTIONS,
  gameOptionNumber,
  gameOptionValue,
  gameOptionsFor,
  resolveGameOptions,
} from "@llmgames/game-catalog";

/**
 * C2 option contract.
 *
 * The browser lobby and MCP `room_create` both call `resolveGameOptions`, so
 * these assertions define what both creation paths accept.
 */

describe("declared options", () => {
  it("declares the three games that ship options and nothing else", () => {
    expect(Object.keys(GAME_OPTIONS).sort()).toEqual(["aeroplane", "go", "monopoly"]);
  });

  it("returns no options for a game that declares none", () => {
    expect(gameOptionsFor("connect4")).toEqual([]);
    expect(gameOptionsFor("not-a-game")).toEqual([]);
  });

  it("keeps every default inside its own choice list", () => {
    for (const specs of Object.values(GAME_OPTIONS)) {
      for (const spec of specs ?? [])
        expect(spec.choices.map((choice) => choice.value)).toContain(spec.default);
    }
  });
});

describe("resolving a creation request", () => {
  it("fills every declared key with its default when nothing is sent", () => {
    expect(resolveGameOptions("go", undefined)).toEqual({ ok: true, options: { size: "9" } });
    expect(resolveGameOptions("aeroplane", undefined)).toEqual({
      ok: true,
      options: { takeoff: "6" },
    });
    expect(resolveGameOptions("monopoly", undefined)).toEqual({
      ok: true,
      options: { rounds: "0" },
    });
  });

  it("accepts every declared value", () => {
    for (const size of ["9", "13", "19"])
      expect(resolveGameOptions("go", { size })).toEqual({ ok: true, options: { size } });

    for (const takeoff of ["6", "56"])
      expect(resolveGameOptions("aeroplane", { takeoff })).toEqual({
        ok: true,
        options: { takeoff },
      });

    for (const rounds of ["20", "40", "0"])
      expect(resolveGameOptions("monopoly", { rounds })).toEqual({ ok: true, options: { rounds } });
  });

  it("refuses an undeclared value with a message naming the legal ones", () => {
    const result = resolveGameOptions("go", { size: "11" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("9, 13, 19");
  });

  it("refuses an undeclared key instead of ignoring it", () => {
    expect(resolveGameOptions("go", { komi: "7" }).ok).toBe(false);
  });

  it("refuses options for a game that declares none", () => {
    const result = resolveGameOptions("connect4", { size: "13" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("does not accept rule options");
  });

  it("keeps defaults for keys the caller omitted", () => {
    expect(resolveGameOptions("go", {})).toEqual({ ok: true, options: { size: "9" } });
  });
});

describe("reading a resolved option", () => {
  it("falls back to the declared default for an older room with no options", () => {
    expect(gameOptionValue("go", undefined, "size")).toBe("9");
    expect(gameOptionNumber("go", undefined, "size")).toBe(9);
    expect(gameOptionNumber("monopoly", undefined, "rounds")).toBe(0);
  });

  it("returns the room's value once one is stored", () => {
    expect(gameOptionNumber("go", { size: "19" }, "size")).toBe(19);
    expect(gameOptionValue("aeroplane", { takeoff: "56" }, "takeoff")).toBe("56");
  });

  it("answers null for a key the game never declared", () => {
    expect(gameOptionValue("go", { size: "9" }, "handicap")).toBeNull();
    expect(gameOptionNumber("connect4", undefined, "size")).toBe(0);
  });
});
