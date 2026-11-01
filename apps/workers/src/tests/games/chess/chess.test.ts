import { describe, expect, it } from "vitest";

import { chessPlugin } from "../../../games/chess/plugin";
import {
  START_FEN,
  fromFen,
  legalMoves,
  play,
  repetitionKey,
  squareIndex,
  squareName,
  toPos,
  uciOf,
} from "../../../games/chess/rules";
import type { ChessGameState } from "../../../durable-objects/types";

const NOW = 1_800_000_000_000;

/** Legal moves of a position written as FEN, in UCI. */
function movesOf(fen: string): string[] {
  const parsed = fromFen(fen);

  return legalMoves(toPos(parsed)).map(uciOf).sort();
}

/** Leaf count to `depth`, the standard check on a move generator. */
function perft(fen: string, depth: number): number {
  const walk = (pos: ReturnType<typeof toPos>, left: number): number => {
    const legal = legalMoves(pos);

    if (left <= 1) return legal.length;

    return legal.reduce((total, candidate) => total + walk(play(pos, candidate), left - 1), 0);
  };

  return depth <= 0 ? 1 : walk(toPos(fromFen(fen)), depth);
}

/** A started two-seat game, with the board replaced by `fen` when given. */
function table(fen?: string): ChessGameState {
  const state = chessPlugin.createInitialState(
    { hostId: "p1", hostName: "P1", turnTime: 30_000 },
    "CHS234",
    0,
  );

  state.status = "playing";
  state.players = [
    { id: "p1", name: "P1" },
    { id: "p2", name: "P2" },
  ];
  state.seats = { p1: 1, p2: 2 };
  state.turnState.currentPlayerId = "p1";
  state.turnState.phase = "play";

  if (fen) {
    const parsed = fromFen(fen);

    state.board = parsed.board;
    state.turn = parsed.turn;
    state.castling = parsed.castling;
    state.ep = parsed.ep;
    state.halfmove = parsed.halfmove;
    state.fullmove = parsed.fullmove;
  }

  const opening = legalMoves(toPos(state));

  state.legal = opening.map(uciOf);
  // Seed the repetition history the way `start` does, so a shuffle can reach
  // its third occurrence inside a test.
  state.history = [repetitionKey(toPos(state), opening)];
  state.turnState.currentPlayerId = state.turn === "w" ? "p1" : "p2";

  return state;
}

/** Apply one move by algebraic squares and return the rejection message when refused. */
function move(state: ChessGameState, from: string, to: string, promotion?: string): string | null {
  const playerId = state.turnState.currentPlayerId ?? "p1";
  const data = promotion ? { from, to, promotion } : { from, to };
  const result = chessPlugin.applyAction(state, playerId, { actionType: "move", data }, NOW);

  return result.ok ? null : result.message;
}

/** Play a list of moves in sequence, failing the test on the first rejection. */
function playLine(state: ChessGameState, line: readonly string[]): void {
  for (const entry of line) {
    const error = move(state, entry.slice(0, 2), entry.slice(2, 4), entry.slice(4) || undefined);

    expect(error, `move ${entry}`).toBeNull();
  }
}

describe("chess move generation", () => {
  it("opens with twenty moves", () => {
    expect(movesOf(START_FEN)).toHaveLength(20);
  });

  it("maps squares both ways", () => {
    expect(squareName(0)).toBe("a8");
    expect(squareName(63)).toBe("h1");
    expect(squareIndex("e4")).toBe(36);
    expect(squareIndex("e9")).toBeNull();
  });

  it("counts the perft of the opening position", () => {
    // 400 and 8902 are the standard published figures. A generator that
    // mishandles en passant, castling or pins drifts by depth 3.
    expect(perft(START_FEN, 2)).toBe(400);
    expect(perft(START_FEN, 3)).toBe(8902);
  });

  it("counts the perft of the Kiwipete position", () => {
    // Kiwipete is the usual second check: it has castling both ways, an
    // en-passant capture and several pins in the same tree.
    const kiwipete = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";

    expect(perft(kiwipete, 1)).toBe(48);
    expect(perft(kiwipete, 2)).toBe(2039);
  });
});

describe("chess special rules", () => {
  it("castles the king and moves the rook with it", () => {
    const state = table("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");

    expect(move(state, "e1", "g1")).toBeNull();
    expect(state.board.slice(60, 64)).toBe(".RK.");
    expect(state.castling).toBe("kq");
  });

  it("refuses to castle through an attacked square", () => {
    const state = table("r3k2r/8/8/8/8/8/6r1/R3K2R w KQkq - 0 1");

    // g1 is attacked by the rook on g2, so the short castle is not offered…
    expect(state.legal).not.toContain("e1g1");
    // …while the long one still is.
    expect(state.legal).toContain("e1c1");
    expect(move(state, "e1", "g1")).toBe("You cannot castle now");
  });

  it("captures en passant and removes the passed pawn", () => {
    const state = table("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");

    expect(move(state, "e5", "d6")).toBeNull();
    // The captured pawn stood on d5, not on d6.
    expect(state.board[27]).toBe(".");
    expect(state.board[19]).toBe("P");
  });

  it("promotes to a queen by default and to the piece asked for", () => {
    const queen = table("8/4P3/8/8/8/8/8/K6k w - - 0 1");

    expect(move(queen, "e7", "e8")).toBeNull();
    expect(queen.board[4]).toBe("Q");

    const knight = table("8/4P3/8/8/8/8/8/K6k w - - 0 1");

    expect(move(knight, "e7", "e8", "n")).toBeNull();
    expect(knight.board[4]).toBe("N");
  });

  it("refuses a move that leaves the king in check", () => {
    const pinned = table("4r2k/8/8/8/4N3/8/8/4K3 w - - 0 1");

    // The white knight blocks the rook on the e-file, so stepping aside is a
    // knight move that exposes the king.
    expect(move(pinned, "e4", "d2")).toBe("That leaves your king in check");

    const checked = table("4k3/8/8/8/8/8/4R3/4K3 b - - 0 1");

    // The black king is already in check, so the message says so.
    expect(move(checked, "e8", "e7")).toBe("That does not get your king out of check");
  });

  it("mates with a back-rank rook", () => {
    const state = table("6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1");

    expect(move(state, "e1", "e8")).toBeNull();
    expect(state.status).toBe("ended");
    expect(state.result).toEqual({ winner: "w", reason: "checkmate" });
    expect(state.winner).toBe("p1");
    expect(state.last?.san).toBe("Re8#");
  });

  it("draws by stalemate when the king has no move and is not in check", () => {
    const state = table("7k/8/5Q2/8/8/8/8/K7 w - - 0 1");

    // Qg6 covers g7, h7 and g8 without checking h8: the black king is stuck.
    expect(move(state, "f6", "g6")).toBeNull();
    expect(state.result).toEqual({ winner: "draw", reason: "stalemate" });
  });

  it("draws after a hundred plies without a capture or pawn move", () => {
    const state = table("7k/5Q2/8/8/8/8/8/K7 w - - 99 60");

    // Any knight-less shuffle keeps the counter climbing; Qf7 is check, so use
    // a quiet queen move that does not reset the counter.
    expect(move(state, "f7", "g7")).toBeNull();
    expect(state.halfmove).toBe(100);
    expect(state.result).toEqual({ winner: "draw", reason: "fifty_move" });
  });

  it("draws by threefold repetition", () => {
    const state = table();

    // Knight shuffle: Nf3 Nf6 Ng1 Ng8 returns to the starting position twice
    // more, which is the third occurrence of the key.
    playLine(state, ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"]);

    expect(state.result).toEqual({ winner: "draw", reason: "repetition" });
  });

  it("draws with a bare king against a king and bishop", () => {
    const state = table("4k3/8/8/8/8/8/8/2B1K3 w - - 0 1");

    // King and bishop against a bare king can never mate, so the move that
    // ends the shuffle also ends the match.
    expect(move(state, "c1", "b2")).toBeNull();
    expect(state.result).toEqual({ winner: "draw", reason: "insufficient_material" });
  });
});

describe("chess turn flow", () => {
  it("passes the turn and keeps the move log", () => {
    const state = table();

    expect(move(state, "e2", "e4")).toBeNull();
    expect(state.turn).toBe("b");
    expect(state.turnState.currentPlayerId).toBe("p2");
    expect(state.fullmove).toBe(1);
    expect(state.last).toEqual({ from: 52, to: 36, uci: "e2e4", san: "e4" });
    expect(state.ep).toBe(44);
  });

  it("accepts one UCI string as well as from and to", () => {
    const state = table();

    const result = chessPlugin.applyAction(
      state,
      "p1",
      { actionType: "move", data: { uci: "e2e4" } },
      NOW,
    );

    expect(result.ok).toBe(true);
    expect(state.last?.uci).toBe("e2e4");
  });

  it("refuses a move from the wrong colour", () => {
    const state = table();

    // Seat p2 is Black, and it is White's move.
    const result = chessPlugin.applyAction(
      state,
      "p2",
      { actionType: "move", data: { from: "e7", to: "e5" } },
      NOW,
    );

    expect(result).toEqual({ ok: false, message: "Not your turn" });
  });

  it("reports a square that holds no piece", () => {
    const state = table();

    expect(move(state, "e4", "e5")).toBe("There is no piece on e4");
  });

  it("records captures on the capturing side", () => {
    const state = table("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2");

    expect(move(state, "e4", "d5")).toBeNull();
    expect(state.captured.w).toBe("p");
    expect(state.captured.b).toBe("");
    // A capture resets the fifty-move clock and the repetition history.
    expect(state.halfmove).toBe(0);
    expect(state.history).toHaveLength(1);
  });

  it("forfeits the game when the turn clock expires", () => {
    const state = table();

    const effects = chessPlugin.onTurnTimeout?.(state, "p1", NOW) ?? [];

    expect(state.status).toBe("ended");
    expect(state.winner).toBe("p2");
    expect(state.result).toEqual({ winner: "b", reason: "timeout" });
    expect(effects.some((effect) => effect.type === "match_ended")).toBe(true);
  });

  it("hides the repetition keys from the projection", () => {
    const state = table();

    move(state, "e2", "e4");

    const projected = chessPlugin.projectState?.(state, "p1") ?? {};
    const rewatched = chessPlugin.rewatchView?.(state) ?? {};

    expect("history" in projected).toBe(false);
    expect("history" in rewatched).toBe(false);
    expect("board" in projected).toBe(true);
  });
});
