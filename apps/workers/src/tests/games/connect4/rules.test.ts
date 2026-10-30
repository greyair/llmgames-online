import { describe, expect, it } from "vitest";

import { connect4Plugin } from "../../../games/connect4/plugin";
import {
  CONNECT4_COLS,
  CONNECT4_ROWS,
  dropInColumn,
  emptyConnect4Board,
  hasConnect4,
  isConnect4BoardFull,
} from "../../../games/connect4/rules";
import type { Connect4Cell, Connect4GameState } from "../../../durable-objects/types";

/** Rule-level tests: the plugin is callable without a room, a socket or a clock. */
function boardFrom(rows: readonly string[]): Connect4Cell[][] {
  return rows.map((row) =>
    [...row].map((cell): Connect4Cell => (cell === "1" ? 1 : cell === "2" ? 2 : 0)),
  );
}

function stateWith(board: Connect4Cell[][], currentPlayerId = "p1"): Connect4GameState {
  const state = connect4Plugin.createInitialState(
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

describe("Connect 4 rules", () => {
  it("keeps the public 6x7 geometry and drops discs to the lowest free cell", () => {
    const board = emptyConnect4Board();

    expect(board).toHaveLength(CONNECT4_ROWS);
    expect(board[0]).toHaveLength(CONNECT4_COLS);
    expect(dropInColumn(board, 3, 1)).toBe(5);
    expect(dropInColumn(board, 3, 2)).toBe(4);
    expect(board[4]![3]).toBe(2);
    expect(dropInColumn(board, CONNECT4_COLS, 1)).toBeNull();
    expect(dropInColumn(board, -1, 1)).toBeNull();
  });

  it("detects horizontal, vertical and both diagonal wins", () => {
    const horizontal = boardFrom(["0000000", "0000000", "0000000", "0000000", "0000000", "1111000"]);

    expect(hasConnect4(horizontal, 5, 3)).toBe(true);
    expect(hasConnect4(horizontal, 5, 0)).toBe(true);
    expect(hasConnect4(horizontal, 5, 4)).toBe(false);

    const vertical = boardFrom(["0000000", "0000000", "2000000", "2000000", "2000000", "2000000"]);

    expect(hasConnect4(vertical, 2, 0)).toBe(true);

    const diagonal = boardFrom(["0000000", "0000000", "1000000", "0100000", "0010000", "0001000"]);

    expect(hasConnect4(diagonal, 5, 3)).toBe(true);

    const antiDiagonal = boardFrom(["0000000", "0000000", "0001000", "0010000", "0100000", "1000000"]);

    expect(hasConnect4(antiDiagonal, 5, 0)).toBe(true);
  });

  it("reports a full board and no false win for three in a row", () => {
    const three = boardFrom(["0000000", "0000000", "0000000", "0000000", "0000000", "1110000"]);
    const full = boardFrom(["1221221", "2112112", "1221221", "2112112", "1221221", "2112112"]);

    expect(hasConnect4(three, 5, 2)).toBe(false);
    expect(isConnect4BoardFull(three)).toBe(false);
    expect(isConnect4BoardFull(full)).toBe(true);
  });

  it("declares a draw when the last free cell completes the board without a line", () => {
    const state = stateWith(
      boardFrom(["0222112", "2111222", "2122211", "1211122", "2212221", "1212211"]),
    );

    const result = connect4Plugin.applyAction(state, "p1", { actionType: "drop_disc", data: { col: 0 } }, 1_800_000_000_500);

    expect(result.ok).toBe(true);
    expect(state.board[0]![0]).toBe(1);
    expect(state.winner).toBe("draw");
    expect(state.status).toBe("ended");
    expect(state.turnState.phase).toBe("ended");

    if (!result.ok) throw new Error("expected an accepted move");

    expect(result.effects).toEqual([
      { type: "event", event: "drop_disc", data: { playerId: "p1", seat: 1, col: 0, row: 0 } },
      { type: "stop_timers" },
      { type: "event", event: "game_ended", data: { reason: "draw", winner: "draw" } },
      { type: "match_ended", reason: "draw" },
    ]);
  });

  it("rejects a move from the wrong seat without mutating the board", () => {
    const state = stateWith(emptyConnect4Board(), "p1");
    const before = JSON.stringify(state);

    const result = connect4Plugin.applyAction(
      state,
      "p2",
      { actionType: "drop_disc", data: { col: 0 } },
      1_800_000_000_500,
    );

    expect(result).toEqual({ ok: false, message: "Not your turn" });
    expect(JSON.stringify(state)).toBe(before);
  });
});
