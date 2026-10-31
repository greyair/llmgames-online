import { describe, expect, it } from "vitest";

import { gomokuPlugin } from "../../../games/gomoku/plugin";
import {
  GOMOKU_SIZE,
  emptyGomokuBoard,
  gomokuCoordinate,
  gomokuWinLine,
  gomokuWinningCells,
  isGomokuBoardFull,
} from "../../../games/gomoku/rules";
import type { GomokuCell, GomokuGameState } from "../../../durable-objects/types";

/** Rule-level tests: the plugin is callable without a room, a socket or a clock. */
function boardFrom(rows: readonly string[], top = 0, left = 0): GomokuCell[][] {
  const board = emptyGomokuBoard();

  rows.forEach((row, rowIndex) =>
    [...row].forEach((cell, colIndex) => {
      if (cell === "1" || cell === "2")
        board[top + rowIndex]![left + colIndex] = cell === "1" ? 1 : 2;
    }),
  );

  return board;
}

function stateWith(board: GomokuCell[][], currentPlayerId = "p1"): GomokuGameState {
  const state = gomokuPlugin.createInitialState(
    { hostId: "p1", hostName: "One" },
    "RULES1",
    1_800_000_000_000,
  );

  state.status = "playing";
  state.players = [
    { id: "p1", name: "One" },
    { id: "p2", name: "Two" },
  ];
  state.seats = { p1: 1, p2: 2 };
  state.board = board;
  state.turnState.currentPlayerId = currentPlayerId;
  state.turnState.phase = "play";
  state.turnState.turnNumber = 3;

  return state;
}

/** Applies a placement at a fixed clock so the rule module sees a stable `now`. */
function place(
  state: GomokuGameState,
  playerId: string,
  data: { row: number; col: number },
) {
  return gomokuPlugin.applyAction(
    state,
    playerId,
    { actionType: "place_stone", data },
    1_800_000_000_000,
  );
}

describe("Gomoku rules", () => {
  it("keeps the 15x15 freestyle geometry", () => {
    const board = emptyGomokuBoard();

    expect(board).toHaveLength(GOMOKU_SIZE);
    expect(board[0]).toHaveLength(GOMOKU_SIZE);
    expect(board.flat().every((cell) => cell === 0)).toBe(true);
    expect(isGomokuBoardFull(board)).toBe(false);
  });

  it("detects horizontal, vertical and both diagonal wins", () => {
    const horizontal = boardFrom(["11111"], 7, 0);

    expect(gomokuWinLine(horizontal, 7, 4)).not.toBeNull();

    const vertical = boardFrom(["2", "2", "2", "2", "2"], 3, 9);

    expect(gomokuWinLine(vertical, 7, 9)).not.toBeNull();

    const diagonal = boardFrom(["1....", ".1...", "..1..", "...1.", "....1"], 5, 5);

    expect(gomokuWinLine(diagonal, 5, 5)).toHaveLength(5);

    const antiDiagonal = boardFrom(["....1", "...1.", "..1..", ".1...", "1...."], 5, 5);

    expect(gomokuWinLine(antiDiagonal, 7, 7)).toHaveLength(5);
  });

  it("counts an overline as a win but not a run of four", () => {
    const six = boardFrom(["111111"], 7, 0);
    const four = boardFrom(["1111"], 7, 0);

    expect(gomokuWinLine(six, 7, 0)).toHaveLength(6);
    expect(gomokuWinLine(four, 7, 3)).toBeNull();
  });

  it("returns the whole run, sorted, regardless of where the scan starts", () => {
    const board = boardFrom(["111111"], 7, 0);

    expect(gomokuWinLine(board, 7, 0)).toEqual([
      { row: 7, col: 0 },
      { row: 7, col: 1 },
      { row: 7, col: 2 },
      { row: 7, col: 3 },
      { row: 7, col: 4 },
      { row: 7, col: 5 },
    ]);
  });

  it("labels points from the bottom and skips the letter I", () => {
    expect(gomokuCoordinate(0, 0)).toBe("A15");
    expect(gomokuCoordinate(14, 0)).toBe("A1");
    expect(gomokuCoordinate(14, 8)).toBe("J1");
    expect(gomokuCoordinate(7, 14)).toBe("P8");
  });

  it("lists the empty points that complete five, for both seats", () => {
    const board = emptyGomokuBoard();

    for (let col = 0; col < 4; col++) board[7]![col] = 1;

    for (let col = 3; col < 7; col++) board[9]![col] = 2;

    expect(gomokuWinningCells(board, 1)).toEqual([{ row: 7, col: 4 }]);
    expect(gomokuWinningCells(board, 2).map((point) => point.col).sort()).toEqual([2, 7]);
  });

  it("places a stone, rejects the occupied point and ends on five", () => {
    const state = stateWith(emptyGomokuBoard());

    const first = place(state, "p1", { row: 7, col: 7 });

    expect(first.ok).toBe(true);
    expect(state.board[7]![7]).toBe(1);
    expect(state.turnState.currentPlayerId).toBe("p2");
    expect(state.lastMove).toEqual({ row: 7, col: 7, seat: 1 });

    const occupied = place(state, "p2", { row: 7, col: 7 });

    expect(occupied).toMatchObject({ ok: false, message: "That point already has a stone" });

    for (let col = 8; col <= 11; col++) {
      place(state, "p2", { row: 0, col });
      place(state, "p1", { row: 7, col });
    }

    expect(state.status).toBe("ended");
    expect(state.winner).toBe("p1");
    expect(state.winLine).toHaveLength(5);
    expect(state.turnState.phase).toBe("ended");
  });

  it("rejects out-of-range points and actions from the wrong seat", () => {
    const state = stateWith(emptyGomokuBoard());

    expect(
      place(state, "p1", { row: 15, col: 0 }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("integers 0–14") });

    expect(
      place(state, "p1", { row: 1.5, col: 0 }),
    ).toMatchObject({ ok: false });

    expect(
      place(state, "p2", { row: 0, col: 0 }),
    ).toMatchObject({ ok: false, message: "Not your turn" });
  });

  it("declares a draw when the last empty point fills the board", () => {
    // A 2-stone-wide brick pattern: the longest run in any direction is two, so
    // filling the board cannot produce a five. The empty corner belongs to
    // black, which is the seat to move.
    const board = Array.from({ length: GOMOKU_SIZE }, (_, row) =>
      Array.from(
        { length: GOMOKU_SIZE },
        (_, col): GomokuCell => ((row + Math.floor(col / 2)) % 2 ? 1 : 2),
      ),
    );

    expect(board[14]![14]).toBe(1);
    board[14]![14] = 0;

    const state = stateWith(board, "p1");
    const result = place(state, "p1", { row: 14, col: 14 });

    expect(result.ok).toBe(true);
    expect(state.status).toBe("ended");
    expect(state.winner).toBe("draw");
    expect(state.winLine).toBeNull();
    expect(isGomokuBoardFull(state.board)).toBe(true);
  });
});
