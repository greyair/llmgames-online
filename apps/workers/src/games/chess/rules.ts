/**
 * Chess rules, ported from West Window's `chess-rules.ts` (MIT, SerenQi).
 *
 * Pure, and deliberately so: a position is a 64-character board plus the side to
 * move, the castling rights and an en-passant square. Chess has no hidden state,
 * so a room can be rebuilt from its own persisted state at any point — there is
 * nothing to seed, shuffle or reseal.
 *
 * Board layout, FEN order: index = row * 8 + col, row 0 is rank 8 (Black's back
 * rank), col 0 is file a. So 0 = a8, 7 = h8, 56 = a1, 63 = h1. Uppercase letters
 * are White, lowercase Black, "." is empty.
 */

import type { ChessColor } from "../../durable-objects/types";

export const FILES = "abcdefgh";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const CHESS_SQUARES = 64;

/** Relative material value, used only for the display tally. */
const VALUE = new Map<string, number>([
  ["p", 1],
  ["n", 3],
  ["b", 3],
  ["r", 5],
  ["q", 9],
  ["k", 0],
]);

/** Rook squares whose departure or capture revokes a castling right. */
const CORNER_RIGHT = new Map<number, string>([
  [63, "K"],
  [56, "Q"],
  [7, "k"],
  [0, "q"],
]);

const KNIGHT: readonly (readonly [number, number])[] = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
];

const KING: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

const ORTH: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const DIAG: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

export interface ChessPos {
  /** 64 one-character strings. */
  b: string[];
  turn: ChessColor;
  castling: string;
  ep: number | null;
}

/** `flag`: 1 double pawn push, 2 en passant, 4 castling. */
export interface ChessMove {
  from: number;
  to: number;
  promo?: string;
  flag: number;
}

export const squareName = (sq: number): string => `${FILES[sq & 7]}${8 - (sq >> 3)}`;

/** Square index for a name like "e4", or null when the name is not a square. */
export function squareIndex(name: string): number | null {
  const match = /^([a-h])([1-8])$/i.exec(name.trim());

  if (!match) return null;

  return (8 - Number(match[2])) * 8 + FILES.indexOf(match[1]!.toLowerCase());
}

export const isWhitePiece = (piece: string): boolean => piece !== "." && piece < "a";

export const colorOfPiece = (piece: string): ChessColor | null =>
  piece === "." ? null : isWhitePiece(piece) ? "w" : "b";

export const pieceLetter = (color: ChessColor, type: string): string =>
  color === "w" ? type.toUpperCase() : type.toLowerCase();

export const otherColor = (color: ChessColor): ChessColor => (color === "w" ? "b" : "w");

export const uciOf = (m: ChessMove): string =>
  squareName(m.from) + squareName(m.to) + (m.promo ?? "");

/** True when `sq` is attacked by any piece of colour `by`. */
export function attacked(b: string[], sq: number, by: ChessColor): boolean {
  const r = sq >> 3;
  const f = sq & 7;
  const pawn = pieceLetter(by, "p");
  const pawnRow = by === "w" ? r + 1 : r - 1;

  if (pawnRow >= 0 && pawnRow < 8) {
    if (f > 0 && b[pawnRow * 8 + f - 1] === pawn) return true;

    if (f < 7 && b[pawnRow * 8 + f + 1] === pawn) return true;
  }

  const knight = pieceLetter(by, "n");

  for (const [dr, df] of KNIGHT) {
    const rr = r + dr;
    const ff = f + df;

    if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 && b[rr * 8 + ff] === knight) return true;
  }

  const king = pieceLetter(by, "k");

  for (const [dr, df] of KING) {
    const rr = r + dr;
    const ff = f + df;

    if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 && b[rr * 8 + ff] === king) return true;
  }

  const queen = pieceLetter(by, "q");

  for (const [dirs, slider] of [
    [ORTH, pieceLetter(by, "r")],
    [DIAG, pieceLetter(by, "b")],
  ] as const) {
    for (const [dr, df] of dirs) {
      let rr = r + dr;
      let ff = f + df;

      while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
        const piece = b[rr * 8 + ff]!;

        if (piece !== ".") {
          if (piece === slider || piece === queen) return true;

          break;
        }

        rr += dr;
        ff += df;
      }
    }
  }

  return false;
}

export const kingSquare = (b: string[], color: ChessColor): number =>
  b.indexOf(pieceLetter(color, "k"));

export const inCheck = (p: ChessPos): boolean => {
  const king = kingSquare(p.b, p.turn);

  return king >= 0 && attacked(p.b, king, otherColor(p.turn));
};

/** Moves that obey the piece's geometry but may leave the mover's king in check. */
export function pseudoMoves(p: ChessPos): ChessMove[] {
  const { b, turn } = p;
  const out: ChessMove[] = [];
  const enemy = otherColor(turn);

  const push = (from: number, to: number, flag = 0) => out.push({ from, to, flag });

  const pushPawn = (from: number, to: number, flag = 0) => {
    const targetRow = to >> 3;

    if (targetRow === 0 || targetRow === 7) {
      for (const promo of ["q", "r", "b", "n"]) out.push({ from, to, promo, flag });

      return;
    }

    push(from, to, flag);
  };

  for (let sq = 0; sq < CHESS_SQUARES; sq++) {
    const piece = b[sq]!;

    if (colorOfPiece(piece) !== turn) continue;

    const r = sq >> 3;
    const f = sq & 7;
    const type = piece.toLowerCase();

    if (type === "p") {
      const dir = turn === "w" ? -1 : 1;
      const r1 = r + dir;

      if (r1 < 0 || r1 > 7) continue;

      if (b[r1 * 8 + f] === ".") {
        pushPawn(sq, r1 * 8 + f);

        const startRow = turn === "w" ? 6 : 1;

        if (r === startRow && b[(r + 2 * dir) * 8 + f] === ".") push(sq, (r + 2 * dir) * 8 + f, 1);
      }

      for (const df of [-1, 1]) {
        const ff = f + df;

        if (ff < 0 || ff > 7) continue;

        const to = r1 * 8 + ff;

        if (colorOfPiece(b[to]!) === enemy) pushPawn(sq, to);
        else if (to === p.ep) push(sq, to, 2);
      }
    } else if (type === "n" || type === "k") {
      for (const [dr, df] of type === "n" ? KNIGHT : KING) {
        const rr = r + dr;
        const ff = f + df;

        if (rr < 0 || rr > 7 || ff < 0 || ff > 7) continue;

        const to = rr * 8 + ff;

        if (colorOfPiece(b[to]!) !== turn) push(sq, to);
      }

      if (type === "k") addCastles(p, sq, out);
    } else {
      const dirs = type === "r" ? ORTH : type === "b" ? DIAG : [...ORTH, ...DIAG];

      for (const [dr, df] of dirs) {
        let rr = r + dr;
        let ff = f + df;

        while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
          const to = rr * 8 + ff;
          const color = colorOfPiece(b[to]!);

          if (color === turn) break;

          push(sq, to);

          if (color) break;

          rr += dr;
          ff += df;
        }
      }
    }
  }

  return out;
}

/** King-side and queen-side castles for the king on `sq`, when they are legal. */
function addCastles(p: ChessPos, sq: number, out: ChessMove[]): void {
  const home = p.turn === "w" ? 60 : 4;

  if (sq !== home || !p.castling) return;

  const [kingSide, queenSide] = p.turn === "w" ? ["K", "Q"] : ["k", "q"];
  const rook = pieceLetter(p.turn, "r");
  const enemy = otherColor(p.turn);
  const { b } = p;

  if (
    p.castling.includes(kingSide) &&
    b[home + 1] === "." &&
    b[home + 2] === "." &&
    b[home + 3] === rook &&
    !attacked(b, home, enemy) &&
    !attacked(b, home + 1, enemy) &&
    !attacked(b, home + 2, enemy)
  ) {
    out.push({ from: sq, to: home + 2, flag: 4 });
  }

  if (
    p.castling.includes(queenSide) &&
    b[home - 1] === "." &&
    b[home - 2] === "." &&
    b[home - 3] === "." &&
    b[home - 4] === rook &&
    !attacked(b, home, enemy) &&
    !attacked(b, home - 1, enemy) &&
    !attacked(b, home - 2, enemy)
  ) {
    out.push({ from: sq, to: home - 2, flag: 4 });
  }
}

export function boardAfter(b: string[], m: ChessMove): string[] {
  const next = b.slice();
  const piece = next[m.from]!;
  const color = colorOfPiece(piece)!;

  next[m.to] = m.promo ? pieceLetter(color, m.promo) : piece;
  next[m.from] = ".";

  // An en-passant capture removes a pawn that is not on the destination square.
  if (m.flag & 2) next[(m.from & ~7) | (m.to & 7)] = ".";

  if (m.flag & 4) {
    const kingSide = m.to > m.from;
    const rookFrom = kingSide ? m.from + 3 : m.from - 4;
    const rookTo = kingSide ? m.from + 1 : m.from - 1;

    next[rookTo] = next[rookFrom]!;
    next[rookFrom] = ".";
  }

  return next;
}

/** A pseudo-legal move is legal when it does not leave the mover's own king attacked. */
export function isSafe(p: ChessPos, m: ChessMove): boolean {
  const next = boardAfter(p.b, m);
  const king = kingSquare(next, p.turn);

  return king < 0 || !attacked(next, king, otherColor(p.turn));
}

export function legalMoves(p: ChessPos): ChessMove[] {
  return pseudoMoves(p).filter((m) => isSafe(p, m));
}

export function hasLegalMove(p: ChessPos): boolean {
  return pseudoMoves(p).some((m) => isSafe(p, m));
}

export function play(p: ChessPos, m: ChessMove): ChessPos {
  const piece = p.b[m.from]!;
  let castling = p.castling;

  if (piece === "K") castling = castling.replace(/[KQ]/g, "");

  if (piece === "k") castling = castling.replace(/[kq]/g, "");

  for (const sq of [m.from, m.to]) {
    const right = CORNER_RIGHT.get(sq);

    if (right) castling = castling.replace(right, "");
  }

  return {
    b: boardAfter(p.b, m),
    turn: otherColor(p.turn),
    castling,
    ep: m.flag & 1 ? (m.from + m.to) >> 1 : null,
  };
}

/** Standard algebraic notation without the check/mate suffix. */
export function sanBase(p: ChessPos, m: ChessMove, legal: readonly ChessMove[]): string {
  if (m.flag & 4) return m.to > m.from ? "O-O" : "O-O-O";

  const piece = p.b[m.from]!;
  const type = piece.toUpperCase();
  const capture = p.b[m.to] !== "." || (m.flag & 2) !== 0;
  const dest = squareName(m.to);

  if (type === "P")
    return (
      (capture ? `${FILES[m.from & 7]}x` : "") + dest + (m.promo ? `=${m.promo.toUpperCase()}` : "")
    );

  const rivals = legal.filter((other) => other.to === m.to && other.from !== m.from && p.b[other.from] === piece);

  if (rivals.length === 0) return type + (capture ? "x" : "") + dest;

  const sameFile = rivals.some((other) => (other.from & 7) === (m.from & 7));
  const sameRank = rivals.some((other) => other.from >> 3 === m.from >> 3);

  const disambiguation = !sameFile
    ? FILES[m.from & 7]!
    : !sameRank
      ? String(8 - (m.from >> 3))
      : squareName(m.from);

  return type + disambiguation + (capture ? "x" : "") + dest;
}

export function sanOf(p: ChessPos, m: ChessMove, legal: readonly ChessMove[]): string {
  const next = play(p, m);
  const suffix = inCheck(next) ? (hasLegalMove(next) ? "+" : "#") : "";

  return sanBase(p, m, legal) + suffix;
}

/** True when neither side can possibly mate: bare kings, one minor, or same-colour bishops. */
export function insufficientMaterial(b: string[]): boolean {
  const minors: { type: string; sq: number }[] = [];

  for (let sq = 0; sq < CHESS_SQUARES; sq++) {
    const type = b[sq]!.toLowerCase();

    if (type === "." || type === "k") continue;

    if (type !== "b" && type !== "n") return false;

    minors.push({ type, sq });
  }

  if (minors.length <= 1) return true;

  if (minors.every((minor) => minor.type === "b")) {
    const shade = (sq: number) => ((sq >> 3) + (sq & 7)) & 1;

    return minors.every((minor) => shade(minor.sq) === shade(minors[0]!.sq));
  }

  return false;
}

/** Material on the board (P1 N3 B3 R5 Q9), for the tally the board shows. */
export function material(board: string) {
  const tally = { w: 0, b: 0 };

  for (const piece of board) {
    const color = colorOfPiece(piece);

    if (color) tally[color] += VALUE.get(piece.toLowerCase()) ?? 0;
  }

  return tally;
}

export const toPos = (state: {
  board: string;
  turn: ChessColor;
  castling: string;
  ep: number | null;
}): ChessPos => ({ b: state.board.split(""), turn: state.turn, castling: state.castling, ep: state.ep });

/**
 * Repetition key: placement, side to move, castling, and the en-passant square
 * only when a capture there is actually legal — otherwise two positions that
 * differ merely by an unusable ep target would count as distinct.
 */
export function repetitionKey(p: ChessPos, legal: readonly ChessMove[]): string {
  const ep = p.ep !== null && legal.some((m) => m.flag & 2) ? squareName(p.ep) : "-";

  return `${p.b.join("")} ${p.turn} ${p.castling || "-"} ${ep}`;
}

export function fenOf(state: {
  board: string;
  turn: ChessColor;
  castling: string;
  ep: number | null;
  halfmove: number;
  fullmove: number;
}): string {
  const rows: string[] = [];

  for (let r = 0; r < 8; r++) {
    let row = "";
    let empty = 0;

    for (let f = 0; f < 8; f++) {
      const piece = state.board[r * 8 + f]!;

      if (piece === ".") empty += 1;
      else {
        if (empty) row += empty;
        empty = 0;
        row += piece;
      }
    }

    rows.push(row + (empty || ""));
  }

  const ep = state.ep === null ? "-" : squareName(state.ep);

  return `${rows.join("/")} ${state.turn} ${state.castling || "-"} ${ep} ${state.halfmove} ${state.fullmove}`;
}

/** The six FEN fields, minus the bookkeeping a room keeps beside them. */
export interface ChessStart {
  board: string;
  turn: ChessColor;
  castling: string;
  ep: number | null;
  halfmove: number;
  fullmove: number;
}

/** Build a starting position from a FEN string. Only the six standard fields are read. */
export function fromFen(fen: string): ChessStart {
  const parts = fen.trim().split(/\s+/);
  const rows = (parts[0] ?? "").split("/");

  if (rows.length !== 8) throw new Error(`Bad FEN: ${fen}`);

  let board = "";

  for (const row of rows) {
    let line = "";

    for (const ch of row) {
      if (/[1-8]/.test(ch)) line += ".".repeat(Number(ch));
      else if (/[pnbrqk]/i.test(ch)) line += ch;
      else line += "?";
    }

    if (line.length !== 8 || line.includes("?")) throw new Error(`Bad FEN: ${fen}`);

    board += line;
  }

  const rights = (parts[2] ?? "-").replace(/[^KQkq]/g, "");
  const epName = parts[3] && parts[3] !== "-" ? parts[3] : null;

  return {
    board,
    turn: parts[1] === "b" ? "b" : "w",
    castling: ["K", "Q", "k", "q"]
      .filter((right) => rights.includes(right))
      .join(""),
    ep: epName === null ? null : squareIndex(epName),
    halfmove: Number(parts[4] ?? 0) || 0,
    fullmove: Number(parts[5] ?? 1) || 1,
  };
}

export interface ChessEnding {
  winner: ChessColor | "draw";
  reason: "checkmate" | "stalemate" | "fifty_move" | "repetition" | "insufficient_material";
}

/** The ending a position already implies, or null while play continues. */
export function resultOf(
  p: ChessPos,
  legal: readonly ChessMove[],
  halfmove: number,
  history: readonly string[],
): ChessEnding | null {
  if (legal.length === 0)
    return inCheck(p)
      ? { winner: otherColor(p.turn), reason: "checkmate" }
      : { winner: "draw", reason: "stalemate" };

  if (insufficientMaterial(p.b)) return { winner: "draw", reason: "insufficient_material" };

  if (halfmove >= 100) return { winner: "draw", reason: "fifty_move" };

  const key = history[history.length - 1];

  if (key !== undefined && history.filter((entry) => entry === key).length >= 3)
    return { winner: "draw", reason: "repetition" };

  return null;
}

/** The legal move between two squares, or the reason it is not available. */
export function findMove(
  p: ChessPos,
  legal: readonly ChessMove[],
  from: number,
  to: number,
  promo: string | null,
): { ok: true; move: ChessMove } | { ok: false; message: string } {
  const candidates = legal.filter((m) => m.from === from && m.to === to);

  if (candidates.length === 0) return { ok: false, message: whyIllegal(p, from, to) };

  const first = candidates[0]!;

  if (first.promo) {
    const chosen = candidates.find((m) => m.promo === (promo ?? "q"));

    if (!chosen) return { ok: false, message: "Promotion must be one of q, r, b or n" };

    return { ok: true, move: chosen };
  }

  if (promo) return { ok: false, message: "That move is not a promotion" };

  return { ok: true, move: first };
}

/** The English rejection a client shows when `from` → `to` is not legal. */
export function whyIllegal(p: ChessPos, from: number, to: number): string {
  const pseudo = pseudoMoves(p).find((m) => m.from === from && m.to === to);

  if (pseudo) return inCheck(p) ? "That does not get your king out of check" : "That leaves your king in check";

  const type = p.b[from]!.toLowerCase();

  if (type === "k" && Math.abs(to - from) === 2 && from >> 3 === to >> 3) return "You cannot castle now";

  if (colorOfPiece(p.b[to]!) === p.turn) return "That square holds your own piece";

  return inCheck(p) ? "That does not get your king out of check" : "That piece cannot move there";
}

/**
 * One UCI move ("e2e4", "e7e8q") into a legal move.
 *
 * Castling is the king's own two-square move, and a promotion without a suffix
 * is taken to mean a queen — the same default the source module used.
 */
export function parseUci(
  p: ChessPos,
  legal: readonly ChessMove[],
  text: string,
): { ok: true; move: ChessMove } | { ok: false; message: string } {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(text.trim().replace(/[-x:=]/g, ""));

  if (!match) return { ok: false, message: `Not a move: ${text.trim()}` };

  const from = squareIndex(match[1]!);
  const to = squareIndex(match[2]!);

  if (from === null || to === null) return { ok: false, message: `Not a move: ${text.trim()}` };

  if (p.b[from] === ".") return { ok: false, message: `There is no piece on ${match[1]!.toLowerCase()}` };

  if (colorOfPiece(p.b[from]!) !== p.turn) return { ok: false, message: "That piece is not yours" };

  return findMove(p, legal, from, to, match[3]?.toLowerCase() ?? null);
}
