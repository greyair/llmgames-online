import { describe, it, expect } from "vitest";
import {
  createInitialCheckersBoard,
  countCheckersPieces,
  getCheckersLegalMoves,
} from "../../../durable-objects/CheckersRoom";
import type { CheckersCell } from "../../../durable-objects/types";

const empty = (): CheckersCell[][] =>
  Array.from({ length: 8 }, () => Array<CheckersCell>(8).fill(0));

describe("American checkers rules", () => {
  it("starts with 12 men per side, seven forward moves, on dark squares", () => {
    const b = createInitialCheckersBoard();
    expect(countCheckersPieces(b)).toEqual({ 1: 12, 2: 12 });
    expect(getCheckersLegalMoves(b, 1)).toHaveLength(7);
    expect(getCheckersLegalMoves(b, 2)).toHaveLength(7);
    b.forEach((line, r) =>
      line.forEach((p, c) => {
        if (p) expect((r + c) % 2).toBe(1);
      }),
    );
  });
  it("requires captures globally and allows either capture without a longest-path rule", () => {
    const b = empty();
    b[5]![2] = 1;
    b[4]![1] = 2;
    b[4]![3] = 2;
    b[5]![6] = 1;
    expect(getCheckersLegalMoves(b, 1)).toEqual([
      { fromRow: 5, fromCol: 2, row: 3, col: 0, capture: { row: 4, col: 1 } },
      { fromRow: 5, fromCol: 2, row: 3, col: 4, capture: { row: 4, col: 3 } },
    ]);
  });
  it("men cannot move or capture backward; kings can, without flying", () => {
    const b = empty();
    b[3]![2] = 1;
    b[4]![3] = 2;
    expect(getCheckersLegalMoves(b, 1).every((m) => m.row < 3)).toBe(true);
    b[3]![2] = 3;
    expect(getCheckersLegalMoves(b, 1)).toEqual([
      { fromRow: 3, fromCol: 2, row: 5, col: 4, capture: { row: 4, col: 3 } },
    ]);
    b[4]![3] = 0;
    expect(getCheckersLegalMoves(b, 1)).toHaveLength(4);
  });
  it("locks a jump chain to one piece and forbids ordinary moves in that chain", () => {
    const b = empty();
    b[3]![2] = 1;
    b[2]![3] = 2;
    b[5]![6] = 1;
    b[4]![5] = 2;
    expect(getCheckersLegalMoves(b, 1, { row: 3, col: 2 })).toEqual([
      { fromRow: 3, fromCol: 2, row: 1, col: 4, capture: { row: 2, col: 3 } },
    ]);
    b[2]![3] = 0;
    expect(getCheckersLegalMoves(b, 1, { row: 3, col: 2 })).toEqual([]);
  });
  it("does not wrap board edges or jump a friendly piece", () => {
    const b = empty();
    b[5]![0] = 1;
    b[4]![1] = 1;
    expect(getCheckersLegalMoves(b, 1).filter((m) => m.fromRow === 5)).toEqual([]);
  });
});
