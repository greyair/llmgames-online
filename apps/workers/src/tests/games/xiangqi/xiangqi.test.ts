import { describe, expect, it } from "vitest";

import { xiangqiPlugin } from "../../../games/xiangqi/plugin";
import {
  XIANGQI_DRAW_PLIES,
  XIANGQI_START_FEN,
  fromFen,
  legalMoves,
  legalPairs,
  notationOf,
  parseIccs,
  pseudoTargets,
  resultOf,
  squareIndex,
  squareName,
} from "../../../games/xiangqi/rules";
import type { XiangqiBoard, XiangqiGameState } from "../../../durable-objects/types";

const NOW = 1_800_000_000_000;

/** A started two-seat game, with the board replaced by `fen` when given. */
function table(fen?: string): XiangqiGameState {
  const state = xiangqiPlugin.createInitialState(
    { hostId: "p1", hostName: "P1", turnTime: 30_000 },
    "XQG234",
    0,
  );

  state.status = "playing";
  state.players = [
    { id: "p1", name: "P1" },
    { id: "p2", name: "P2" },
  ];
  state.seats = { p1: 1, p2: 2 };
  state.turnState.phase = "play";

  if (fen) {
    const parsed = fromFen(fen);

    state.board = parsed.board;
    state.turn = parsed.turn;
  }

  state.legal = legalMoves(state.board, state.turn);
  state.turnState.currentPlayerId = state.turn === "r" ? "p1" : "p2";

  return state;
}

/** Apply one move by ICCS points; returns the rejection message when refused. */
function move(state: XiangqiGameState, from: string, to: string): string | null {
  const playerId = state.turnState.currentPlayerId ?? "p1";
  const result = xiangqiPlugin.applyAction(state, playerId, { actionType: "move", data: { from, to } }, NOW);

  return result.ok ? null : result.message;
}

const names = (board: XiangqiBoard, from: string) =>
  pseudoTargets(board, squareIndex(from) ?? 0).map(squareName).sort();

describe("xiangqi move generation", () => {
  it("opens with forty-four moves for Red", () => {
    const start = fromFen(XIANGQI_START_FEN);

    expect(legalPairs(start.board, "r")).toHaveLength(44);
    expect(legalPairs(start.board, "b")).toHaveLength(44);
  });

  it("maps points both ways", () => {
    expect(squareName(25)).toBe("h2");
    expect(squareIndex("h2")).toBe(25);
    expect(squareIndex("a9")).toBe(81);
    expect(squareIndex("j2")).toBeNull();
  });

  it("parses ICCS in the three accepted spellings", () => {
    expect(parseIccs("h2e2")).toEqual({ from: 25, to: 22 });
    expect(parseIccs("h2-e2")).toEqual({ from: 25, to: 22 });
    expect(parseIccs("H2 E2")).toEqual({ from: 25, to: 22 });
    expect(parseIccs("h2h2")).toBeNull();
  });

  it("writes traditional notation with the mover's own numbering", () => {
    const start = fromFen(XIANGQI_START_FEN).board;

    const pair = (from: string, to: string) =>
      notationOf(start, squareIndex(from) ?? 0, squareIndex(to) ?? 0);

    expect(pair("h2", "e2")).toBe("炮二平五");
    expect(pair("b2", "e2")).toBe("炮八平五");
    // Black counts files from its own right, so h9 is file 8 for Black.
    expect(pair("h9", "g7")).toBe("馬8進7");
  });

  it("hobbles the horse when the leg is occupied", () => {
    // Red horse on b0; a Red soldier on c1 blocks the leg, so d1 is lost while
    // the two points reached over b1 stay open.
    const board = fromFen("4k4/9/9/9/9/9/9/9/2P6/RNBAKAB1R w").board;
    const targets = names(board, "b0");

    expect(targets).not.toContain("d1");
    expect(targets).toContain("a2");
    expect(targets).toContain("c2");
    expect(targets).not.toContain("d0");
  });

  it("keeps the elephant on its own side of the river", () => {
    // A Red elephant on c4 has only the two backward points; a6 and e6 are
    // across the river, which an elephant may never cross.
    const board = fromFen("4k4/9/9/9/9/2B6/9/9/9/3K5 w").board;

    expect(names(board, "c4")).toEqual(["a2", "e2"]);
  });

  it("needs exactly one screen for a cannon capture", () => {
    // Red cannon e0, screen e5, target e7: e7 is capturable, the screen is not.
    const board = fromFen("4k4/9/4p4/9/4p4/9/9/9/9/3KC4 w").board;
    const targets = names(board, "e0");

    expect(targets).toContain("e7");
    expect(targets).not.toContain("e5");
    expect(targets).toContain("e4");
  });

  it("refuses to let the generals face each other", () => {
    const board = fromFen("4k4/9/9/9/4R4/9/9/9/9/4K4 w").board;

    // The chariot's own geometry offers the sideways squares; the legality pass
    // removes them because stepping aside would leave the two generals facing.
    expect(names(board, "e5")).toContain("d5");

    const legal = legalMoves(board, "r");

    expect(legal).toContain("e5e6");
    expect(legal).toContain("e5e4");
    expect(legal).not.toContain("e5d5");
  });
});

describe("xiangqi endings", () => {
  it("mates with the generals facing on an open file", () => {
    // Black king d9, Red king d0, nothing between them: Black is in check from
    // the facing rule and every escape is covered.
    const board = fromFen("3k5/9/9/9/9/9/9/9/4R4/3K5 b").board;

    expect(legalPairs(board, "b")).toHaveLength(0);
    expect(resultOf(board, "b", 0)).toEqual({ winner: "r", reason: "checkmate" });
  });

  it("draws after a hundred and twenty quiet plies", () => {
    const board = fromFen(XIANGQI_START_FEN).board;

    expect(resultOf(board, "r", XIANGQI_DRAW_PLIES - 1)).toBeNull();
    expect(resultOf(board, "r", XIANGQI_DRAW_PLIES)).toEqual({ winner: "draw", reason: "quiet" });
  });

  it("draws when neither side keeps an attacking piece", () => {
    const board = fromFen("4k4/9/9/9/9/9/9/9/9/4K4 w").board;

    expect(resultOf(board, "r", 0)).toEqual({ winner: "draw", reason: "no_attackers" });
  });

  it("does not draw while one side still has a chariot", () => {
    const board = fromFen("4k4/9/9/9/9/9/9/9/4R4/4K4 w").board;

    expect(resultOf(board, "r", 0)).toBeNull();
  });
});

describe("xiangqi turn flow", () => {
  it("moves, records the notation and passes the turn", () => {
    const state = table();

    expect(move(state, "h2", "e2")).toBeNull();
    expect(state.turn).toBe("b");
    expect(state.turnState.currentPlayerId).toBe("p2");
    expect(state.last).toEqual({ from: 25, to: 22, iccs: "h2e2", text: "炮二平五" });
    expect(state.quiet).toBe(1);
  });

  it("accepts one ICCS string as well as from and to", () => {
    const state = table();
    const result = xiangqiPlugin.applyAction(state, "p1", { actionType: "move", data: { uci: "h2e2" } }, NOW);

    expect(result.ok).toBe(true);
    expect(state.last?.text).toBe("炮二平五");
  });

  it("refuses a move from the wrong side", () => {
    const state = table();
    const result = xiangqiPlugin.applyAction(state, "p2", { actionType: "move", data: { from: "h9", to: "g7" } }, NOW);

    expect(result).toEqual({ ok: false, message: "Not your turn" });
  });

  it("names a piece that is not on the point", () => {
    const state = table();

    expect(move(state, "e5", "e6")).toBe("There is no piece on e5");
  });

  it("rejects a geometrically impossible move", () => {
    const state = table();

    // The Red chariot on a0 cannot reach b2.
    expect(move(state, "a0", "b2")).toBe("That piece cannot move there");
  });

  it("resets the quiet counter on a capture", () => {
    const state = table("4k4/9/9/9/4p4/9/9/9/4R4/4K4 w");

    state.quiet = 40;
    expect(move(state, "e1", "e5")).toBeNull();
    expect(state.quiet).toBe(0);
    expect(state.captured).toEqual(["p"]);
  });

  it("forfeits the game when the turn clock expires", () => {
    const state = table();
    const effects = xiangqiPlugin.onTurnTimeout?.(state, "p1", NOW) ?? [];

    expect(state.status).toBe("ended");
    expect(state.winner).toBe("p2");
    expect(state.result).toEqual({ winner: "b", reason: "timeout" });
    expect(effects.some((effect) => effect.type === "match_ended")).toBe(true);
  });
});
