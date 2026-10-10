import { describe, expect, it } from "vitest";
import {
  applyReversiMove,
  countReversiDiscs,
  createInitialReversiBoard,
  getReversiFlips,
  getReversiLegalMoves,
  REVERSI_SIZE,
} from "../../../durable-objects/ReversiRoom";
import type { ReversiCell } from "../../../durable-objects/types";

describe("Reversi rules", () => {
  it("creates the standard opening and four black legal moves", () => {
    const board = createInitialReversiBoard();

    expect(board).toHaveLength(8);
    expect(board.every((row) => row.length === 8)).toBe(true);
    expect(countReversiDiscs(board)).toEqual({ 1: 2, 2: 2 });
    expect(getReversiLegalMoves(board, 1)).toEqual([
      { row: 2, col: 3, flipCount: 1 },
      { row: 3, col: 2, flipCount: 1 },
      { row: 4, col: 5, flipCount: 1 },
      { row: 5, col: 4, flipCount: 1 },
    ]);
  });

  it("places a disc and flips the bracketed line", () => {
    const board = createInitialReversiBoard();
    const flips = applyReversiMove(board, 2, 3, 1);

    expect(flips).toEqual([{ row: 3, col: 3 }]);
    expect(board[2]![3]).toBe(1);
    expect(board[3]![3]).toBe(1);
    expect(countReversiDiscs(board)).toEqual({ 1: 4, 2: 1 });
  });

  it("flips every bracketed direction in one move", () => {
    const board: ReversiCell[][] = Array.from({ length: REVERSI_SIZE }, () =>
      Array<ReversiCell>(REVERSI_SIZE).fill(0),
    );

    const directions = [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1],
    ] as const;

    for (const [dr, dc] of directions) {
      board[3 + dr]![3 + dc] = 2;
      board[3 + dr * 2]![3 + dc * 2] = 1;
    }

    expect(getReversiFlips(board, 3, 3, 1)).toHaveLength(8);
    expect(applyReversiMove(board, 3, 3, 1)).toHaveLength(8);
    expect(countReversiDiscs(board)).toEqual({ 1: 17, 2: 0 });
  });

  it("rejects placements that do not bracket an opponent", () => {
    const board = createInitialReversiBoard();

    expect(applyReversiMove(board, 0, 0, 1)).toEqual([]);
    expect(board[0]![0]).toBe(0);
    expect(getReversiFlips(board, 3, 3, 1)).toEqual([]);
  });

  it("finds no legal moves on a completed board", () => {
    const board = Array.from({ length: REVERSI_SIZE }, () =>
      Array<ReversiCell>(REVERSI_SIZE).fill(1),
    );

    expect(getReversiLegalMoves(board, 1)).toEqual([]);
    expect(getReversiLegalMoves(board, 2)).toEqual([]);
    expect(countReversiDiscs(board)).toEqual({ 1: 64, 2: 0 });
  });

  it("detects a forced pass when only one color has a legal move", () => {
    const board = Array.from({ length: REVERSI_SIZE }, () =>
      Array<ReversiCell>(REVERSI_SIZE).fill(1),
    );

    board[0]![0] = 0;
    board[0]![1] = 2;

    expect(getReversiLegalMoves(board, 1)).toEqual([{ row: 0, col: 0, flipCount: 1 }]);
    expect(getReversiLegalMoves(board, 2)).toEqual([]);
  });
});
