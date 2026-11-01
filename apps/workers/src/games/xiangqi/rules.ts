/**
 * Xiangqi rules, ported from West Window's `xiangqi-rules.ts` (MIT, SerenQi).
 *
 * Board: 90 points, index = rank * 9 + file. File 0..8 is ICCS a..i from Red's
 * left to right; rank 0 is Red's back rank and rank 9 is Black's. Red holds
 * ranks 0-4 and the river runs between ranks 4 and 5. Pieces are single letters
 * and "" is empty: uppercase Red, lowercase Black — R/r 車, N/n 馬, B/b 相象,
 * A/a 仕士, K/k 帥將, C/c 炮砲, P/p 兵卒.
 *
 * Everything here is pure. Xiangqi has no hidden state, so a room can always be
 * rebuilt from its own persisted board.
 */

import type { XiangqiBoard, XiangqiSide } from "../../durable-objects/types";

export const XIANGQI_FILES = "abcdefghi";

export const XIANGQI_START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w";

export const XIANGQI_POINTS = 90;

export const XIANGQI_RANKS = 10;

/** Plies without a capture before the game is drawn. */
export const XIANGQI_DRAW_PLIES = 120;

const ORTHO: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const DIAG: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const fileOf = (point: number): number => point % 9;

const rankOf = (point: number): number => Math.floor(point / 9);

const point = (file: number, rank: number): number => rank * 9 + file;

const onBoard = (file: number, rank: number): boolean =>
  file >= 0 && file < 9 && rank >= 0 && rank < 10;

const inPalace = (file: number, rank: number, red: boolean): boolean =>
  file >= 3 && file <= 5 && (red ? rank <= 2 : rank >= 7);

const ownHalf = (rank: number, red: boolean): boolean => (red ? rank <= 4 : rank >= 5);

export const isRedPiece = (piece: string): boolean => piece !== "" && piece === piece.toUpperCase();

export const sideOfPiece = (piece: string): XiangqiSide | null =>
  piece === "" ? null : isRedPiece(piece) ? "r" : "b";

const isEnemy = (piece: string, red: boolean): boolean => piece !== "" && isRedPiece(piece) !== red;

export const otherSide = (side: XiangqiSide): XiangqiSide => (side === "r" ? "b" : "r");

/** "h2" for a point index. */
export const squareName = (index: number): string =>
  `${XIANGQI_FILES.charAt(fileOf(index))}${rankOf(index)}`;

export const iccsOf = (from: number, to: number): string =>
  `${squareName(from)}${squareName(to)}`;

/** Point index for a name like "h2", or null when the name is not a point. */
export function squareIndex(name: string): number | null {
  const match = /^([a-i])([0-9])$/i.exec(name.trim());

  if (!match) return null;

  const file = XIANGQI_FILES.indexOf(match[1]!.toLowerCase());
  const rank = Number(match[2]);

  if (file < 0 || rank > 9) return null;

  return point(file, rank);
}

/** Parses "h2e2", "h2-e2" or "H2 E2". */
export function parseIccs(text: string): { from: number; to: number } | null {
  const match = /^\s*([a-i])\s*([0-9])\s*[-\s]?\s*([a-i])\s*([0-9])\s*$/i.exec(text);

  if (!match) return null;

  const from = squareIndex(`${match[1]}${match[2]}`);
  const to = squareIndex(`${match[3]}${match[4]}`);

  if (from === null || to === null || from === to) return null;

  return { from, to };
}

/** Points the piece on `from` may move to by its own geometry, ignoring checks. */
export function pseudoTargets(board: XiangqiBoard, from: number): number[] {
  const piece = board[from] ?? "";

  if (piece === "") return [];

  const red = isRedPiece(piece);
  const f0 = fileOf(from);
  const r0 = rankOf(from);
  const out: number[] = [];

  const add = (file: number, rank: number) => {
    if (!onBoard(file, rank)) return;

    const target = board[point(file, rank)] ?? "";

    if (target === "" || isEnemy(target, red)) out.push(point(file, rank));
  };

  switch (piece.toLowerCase()) {
    case "k":
      for (const [df, dr] of ORTHO) if (inPalace(f0 + df, r0 + dr, red)) add(f0 + df, r0 + dr);

      break;

    case "a":
      for (const [df, dr] of DIAG) if (inPalace(f0 + df, r0 + dr, red)) add(f0 + df, r0 + dr);

      break;

    case "b":
      // Two points diagonally, never across the river, blocked by a filled eye.
      for (const [df, dr] of DIAG) {
        const file = f0 + 2 * df;
        const rank = r0 + 2 * dr;

        if (onBoard(file, rank) && ownHalf(rank, red) && (board[point(f0 + df, r0 + dr)] ?? "") === "")
          add(file, rank);
      }

      break;

    case "n":
      // One orthogonal step (the leg) then one outward diagonal, blocked by a
      // piece standing on the leg.
      for (const [df, dr] of ORTHO) {
        const legFile = f0 + df;
        const legRank = r0 + dr;

        if (!onBoard(legFile, legRank) || (board[point(legFile, legRank)] ?? "") !== "") continue;

        if (df !== 0) {
          add(f0 + 2 * df, r0 + 1);
          add(f0 + 2 * df, r0 - 1);
        } else {
          add(f0 + 1, r0 + 2 * dr);
          add(f0 - 1, r0 + 2 * dr);
        }
      }

      break;

    case "r":
      for (const [df, dr] of ORTHO) {
        for (let file = f0 + df, rank = r0 + dr; onBoard(file, rank); file += df, rank += dr) {
          const target = board[point(file, rank)] ?? "";

          if (target === "") {
            out.push(point(file, rank));

            continue;
          }

          if (isEnemy(target, red)) out.push(point(file, rank));

          break;
        }
      }

      break;

    case "c":
      // Slides like a chariot, but captures only over exactly one screen.
      for (const [df, dr] of ORTHO) {
        let screen = false;

        for (let file = f0 + df, rank = r0 + dr; onBoard(file, rank); file += df, rank += dr) {
          const target = board[point(file, rank)] ?? "";

          if (!screen) {
            if (target === "") out.push(point(file, rank));
            else screen = true;
          } else if (target !== "") {
            if (isEnemy(target, red)) out.push(point(file, rank));

            break;
          }
        }
      }

      break;

    case "p": {
      const forward = red ? 1 : -1;

      add(f0, r0 + forward);

      // Sideways only after crossing the river.
      if (!ownHalf(r0, red)) {
        add(f0 - 1, r0);
        add(f0 + 1, r0);
      }

      break;
    }
  }

  return out;
}

/** Point of `side`'s general, or -1. */
export function generalAt(board: XiangqiBoard, side: XiangqiSide): number {
  const letter = side === "r" ? "K" : "k";
  const first = side === "r" ? 0 : 7;

  for (let rank = first; rank < first + 3; rank += 1)
    for (let file = 3; file <= 5; file += 1)
      if (board[point(file, rank)] === letter) return point(file, rank);

  return -1;
}

/** True when the general on `k` is attacked by the other side (flying general included). */
function attacked(board: XiangqiBoard, k: number, red: boolean): boolean {
  const kf = fileOf(k);
  const kr = rankOf(k);
  const chariot = red ? "r" : "R";
  const cannon = red ? "c" : "C";
  const horse = red ? "n" : "N";
  const soldier = red ? "p" : "P";
  const general = red ? "k" : "K";

  for (const [df, dr] of ORTHO) {
    let screen = false;

    for (let file = kf + df, rank = kr + dr; onBoard(file, rank); file += df, rank += dr) {
      const target = board[point(file, rank)] ?? "";

      if (target === "") continue;

      if (!screen) {
        // A general facing down the file is the flying-general rule.
        if (target === chariot || (target === general && df === 0)) return true;

        screen = true;
      } else {
        if (target === cannon) return true;

        break;
      }
    }
  }

  for (const [df, dr] of DIAG) {
    const legFile = kf + df;
    const legRank = kr + dr;

    if (!onBoard(legFile, legRank) || (board[point(legFile, legRank)] ?? "") !== "") continue;

    if (onBoard(kf + 2 * df, kr + dr) && board[point(kf + 2 * df, kr + dr)] === horse) return true;

    if (onBoard(kf + df, kr + 2 * dr) && board[point(kf + df, kr + 2 * dr)] === horse) return true;
  }

  // A soldier steps forward onto the general, or sideways once it has crossed.
  const back = red ? 1 : -1;

  if (onBoard(kf, kr + back) && board[point(kf, kr + back)] === soldier) return true;

  for (const df of [-1, 1])
    if (onBoard(kf + df, kr) && board[point(kf + df, kr)] === soldier && !ownHalf(kr, !red)) return true;

  return false;
}

/** True when both generals share a file with nothing between them. */
export function generalsFace(board: XiangqiBoard): boolean {
  const red = generalAt(board, "r");
  const black = generalAt(board, "b");

  if (red < 0 || black < 0 || fileOf(red) !== fileOf(black)) return false;

  for (let i = red + 9; i < black; i += 9) if ((board[i] ?? "") !== "") return false;

  return true;
}

export function inCheck(board: XiangqiBoard, side: XiangqiSide): boolean {
  const general = generalAt(board, side);

  return general >= 0 && attacked(board, general, side === "r");
}

/** Why a pseudo-legal move is still illegal, or null when it is legal. */
export type XiangqiProblem = "faces" | "check" | null;

function exposes(board: XiangqiBoard, from: number, to: number): XiangqiProblem {
  const piece = board[from] ?? "";
  const side: XiangqiSide = isRedPiece(piece) ? "r" : "b";
  const captured = board[to] ?? "";

  board[to] = piece;
  board[from] = "";

  const problem: XiangqiProblem = generalsFace(board)
    ? "faces"
    : inCheck(board, side)
      ? "check"
      : null;

  board[from] = piece;
  board[to] = captured;

  return problem;
}

/** Every legal move for `side` as `[from, to]` pairs. */
export function legalPairs(board: XiangqiBoard, side: XiangqiSide): [number, number][] {
  const work = board.slice();
  const out: [number, number][] = [];
  const red = side === "r";

  for (let i = 0; i < XIANGQI_POINTS; i += 1) {
    const piece = work[i] ?? "";

    if (piece === "" || isRedPiece(piece) !== red) continue;

    for (const target of pseudoTargets(work, i))
      if (exposes(work, i, target) === null) out.push([i, target]);
  }

  return out;
}

export const legalMoves = (board: XiangqiBoard, side: XiangqiSide): string[] =>
  legalPairs(board, side).map(([from, to]) => iccsOf(from, to));

/** Board after `from` → `to`, as a new array. */
export function play(board: XiangqiBoard, from: number, to: number): XiangqiBoard {
  const next = board.slice();

  next[to] = next[from] ?? "";
  next[from] = "";

  return next;
}

export interface XiangqiStart {
  board: XiangqiBoard;
  turn: XiangqiSide;
}

/** Standard xiangqi FEN: Black's back rank first, then "w"/"r" for Red or "b" for Black. */
export function fromFen(fen: string): XiangqiStart {
  const [placement = "", side = "w"] = fen.trim().split(/\s+/);
  const rows = placement.split("/");

  if (rows.length !== 10) throw new Error(`Bad xiangqi FEN: ${fen}`);

  const board: XiangqiBoard = new Array<string>(XIANGQI_POINTS).fill("");

  rows.forEach((row, index) => {
    const rank = 9 - index;
    let file = 0;

    for (const ch of row) {
      if (/[1-9]/.test(ch)) {
        file += Number(ch);

        continue;
      }

      if (!/[rnbakcpRNBAKCP]/.test(ch) || file > 8) throw new Error(`Bad xiangqi FEN: ${fen}`);

      board[point(file, rank)] = ch;
      file += 1;
    }

    if (file !== 9) throw new Error(`Bad xiangqi FEN: ${fen}`);
  });

  return { board, turn: side.toLowerCase() === "b" ? "b" : "r" };
}

/** The character a player sees on the piece: 帥仕相馬車炮兵 for Red, 將士象馬車砲卒 for Black. */
export function glyphOf(piece: string): string {
  const red = isRedPiece(piece);

  const forms = new Map<string, readonly [string, string]>([
    ["k", ["帥", "將"]],
    ["a", ["仕", "士"]],
    ["b", ["相", "象"]],
    ["n", ["馬", "馬"]],
    ["r", ["車", "車"]],
    ["c", ["炮", "砲"]],
    ["p", ["兵", "卒"]],
  ]);

  const pair = forms.get(piece.toLowerCase());

  return pair ? (red ? pair[0] : pair[1]) : "?";
}

const CHINESE_NUMERALS = "一二三四五六七八九";

/** File number counted from the mover's own right: 一..九 for Red, 1..9 for Black. */
function fileLabel(file: number, red: boolean): string {
  return red ? CHINESE_NUMERALS.charAt(8 - file) : String(file + 1);
}

function countLabel(count: number, red: boolean): string {
  return red ? CHINESE_NUMERALS.charAt(count - 1) : String(count);
}

/**
 * Traditional notation of `from` → `to` on the board *before* the move, e.g.
 * 炮二平五, 馬8進7, 前車進一. Two or more identical pieces on one file are named
 * 前/後 or 前中後 rather than by file, which is the part that makes the notation
 * readable to a player and useless to re-implement from memory.
 */
export function notationOf(board: XiangqiBoard, from: number, to: number): string {
  const piece = board[from] ?? "";
  const red = isRedPiece(piece);
  const kind = piece.toLowerCase();
  const f0 = fileOf(from);
  const r0 = rankOf(from);
  const f1 = fileOf(to);
  const r1 = rankOf(to);
  const forward = red ? r1 > r0 : r1 < r0;
  const action = r1 === r0 ? "平" : forward ? "進" : "退";

  const target =
    action === "平" || "nba".includes(kind)
      ? fileLabel(f1, red)
      : countLabel(Math.abs(r1 - r0), red);

  const glyph = glyphOf(piece);
  const sameFile: number[] = [];

  for (let rank = 0; rank < XIANGQI_RANKS; rank += 1)
    if (board[point(f0, rank)] === piece) sameFile.push(rank);

  if (sameFile.length < 2 || kind === "a" || kind === "b")
    return `${glyph}${fileLabel(f0, red)}${action}${target}`;

  if (red) sameFile.reverse();

  const index = sameFile.indexOf(r0);

  const position =
    sameFile.length === 2 ? (index === 0 ? "前" : "後") : sameFile.length === 3 ? "前中後".charAt(index) : countLabel(index + 1, red);

  if (kind === "p") {
    // Two files each holding two or more soldiers: name the file, not the piece.
    const crowded = Array.from({ length: 9 }, (_, file) => file).filter((file) => {
      let count = 0;

      for (let rank = 0; rank < XIANGQI_RANKS; rank += 1) if (board[point(file, rank)] === piece) count += 1;

      return count >= 2;
    });

    if (crowded.length > 1) return `${position}${fileLabel(f0, red)}${action}${target}`;
  }

  return `${position}${glyph}${action}${target}`;
}

/** True when a side still holds a piece that could ever deliver mate. */
export function hasAttackingMaterial(board: XiangqiBoard, side: XiangqiSide): boolean {
  const red = side === "r";

  return board.some((piece) => {
    if (piece === "" || isRedPiece(piece) !== red) return false;

    const kind = piece.toLowerCase();

    return kind === "r" || kind === "n" || kind === "c" || kind === "p";
  });
}

export interface XiangqiEnding {
  winner: XiangqiSide | "draw";
  reason: "checkmate" | "stalemate" | "quiet" | "no_attackers";
}

/** The ending the position implies for `side` to move, or null while play continues. */
export function resultOf(
  board: XiangqiBoard,
  side: XiangqiSide,
  quiet: number,
): XiangqiEnding | null {
  if (legalPairs(board, side).length === 0)
    return inCheck(board, side)
      ? { winner: otherSide(side), reason: "checkmate" }
      : { winner: otherSide(side), reason: "stalemate" };

  if (quiet >= XIANGQI_DRAW_PLIES) return { winner: "draw", reason: "quiet" };

  // Both sides must be unable to attack: one chariot is still enough to mate.
  if (!hasAttackingMaterial(board, "r") && !hasAttackingMaterial(board, "b"))
    return { winner: "draw", reason: "no_attackers" };

  return null;
}
