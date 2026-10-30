import { KNOWN_GAME_TYPES } from "@llmgames/game-catalog";

import { describe, expect, it } from "vitest";

import { boardFor } from "../../src/game-ui/boardRegistry";

/**
 * The board registry replaces the `if (state.type === ...)` chain, so it must
 * cover every shipped game and still resolve unknown ids to "no board".
 */
describe("board registry", () => {
  it("registers a lazy renderer for every known game", () => {
    for (const id of KNOWN_GAME_TYPES) expect(boardFor(id)).not.toBeNull();
  });

  it("returns null instead of guessing for an unknown or missing id", () => {
    expect(boardFor("not-a-game")).toBeNull();
    expect(boardFor(undefined)).toBeNull();
  });

  it("lets two games share one board implementation", () => {
    expect(boardFor("connect4")).toBe(boardFor("reversi"));
    expect(boardFor("connect4")).not.toBe(boardFor("checkers"));
  });
});
