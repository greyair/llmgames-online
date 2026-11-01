/**
 * Go rules, ported from West Window's `state.ts` / `board.ts` / `coords.ts` /
 * `score.ts` (MIT, SerenQi).
 *
 * The board is a flat array of 0 (empty), 1 (black) and 2 (white) indexed
 * `y * size + x`, with y counted from the top. Coordinates shown to players are
 * GTP: columns A..T skipping I, rows counted from the bottom, so on a 9×9 board
 * A9 is the top-left point and J1 the bottom-right.
 *
 * Everything here is pure and size-agnostic. The plugin fixes the size, so
 * enabling 13×13 later is a constant, not a rewrite.
 */

export const GO_EMPTY = 0;

export const GO_BLACK = 1;

export const GO_WHITE = 2;

export type GoColor = 1 | 2;

export const GO_COLUMNS = "ABCDEFGHJKLMNOPQRST";

export const GO_SIZES: readonly number[] = [9, 13, 19];

export const GO_KOMI = 7.5;

export const GO_DEFAULT_SIZE = 9;

export const otherColor = (color: GoColor): GoColor => (color === GO_BLACK ? GO_WHITE : GO_BLACK);

export const isColor = (value: number): value is GoColor => value === GO_BLACK || value === GO_WHITE;

const neighborCache = new Map<number, readonly number[][]>();

/** Orthogonal neighbours of every point, built once per board size. */
export function neighbors(size: number): readonly number[][] {
  const cached = neighborCache.get(size);

  if (cached) return cached;

  const built: number[][] = [];

  for (let point = 0; point < size * size; point += 1) {
    const x = point % size;
    const y = Math.floor(point / size);
    const list: number[] = [];

    if (y > 0) list.push(point - size);

    if (x < size - 1) list.push(point + 1);

    if (y < size - 1) list.push(point + size);

    if (x > 0) list.push(point - 1);

    built.push(list);
  }

  neighborCache.set(size, built);

  return built;
}

/** GTP name of a point, e.g. "D4". */
export function toGtp(point: number, size: number): string {
  const x = point % size;
  const y = Math.floor(point / size);

  return `${GO_COLUMNS.charAt(x)}${size - y}`;
}

/** Point index for a GTP name, or null when malformed or off the board. */
export function fromGtp(text: string, size: number): number | null {
  const match = /^\s*([A-HJ-Ta-hj-t])\s*(\d{1,2})\s*$/.exec(text);

  if (!match) return null;

  const x = GO_COLUMNS.indexOf(match[1]!.toUpperCase());
  const row = Number(match[2]);

  if (x < 0 || x >= size || row < 1 || row > size) return null;

  return (size - row) * size + x;
}

/** Star points (hoshi) for the supported sizes. */
export function starPoints(size: number): number[] {
  const grid = (coords: readonly number[]) =>
    coords.flatMap((y) => coords.map((x) => y * size + x));

  if (size === 19) return grid([3, 9, 15]);

  if (size === 13) return [...grid([3, 9]), 6 * size + 6];

  if (size === 9) return [...grid([2, 6]), 4 * size + 4];

  return [];
}

export interface GoGroup {
  color: GoColor;
  stones: number[];
  liberties: number[];
}

/** Flood-fills the chain containing `start`. */
export function groupAt(cells: readonly number[], size: number, start: number): GoGroup {
  const color = cells[start] ?? GO_EMPTY;
  const around = neighbors(size);
  const stones: number[] = [];
  const liberties = new Set<number>();
  const seen = new Uint8Array(size * size);
  const stack = [start];

  seen[start] = 1;

  while (stack.length > 0) {
    const point = stack.pop()!;

    stones.push(point);

    for (const neighbour of around[point] ?? []) {
      const cell = cells[neighbour] ?? GO_EMPTY;

      if (cell === GO_EMPTY) liberties.add(neighbour);
      else if (cell === color && !seen[neighbour]) {
        seen[neighbour] = 1;
        stack.push(neighbour);
      }
    }
  }

  return { color: isColor(color) ? color : GO_BLACK, stones, liberties: [...liberties] };
}

/** Every chain on the board. */
export function allGroups(cells: readonly number[], size: number): GoGroup[] {
  const seen = new Uint8Array(size * size);
  const out: GoGroup[] = [];

  for (let point = 0; point < size * size; point += 1) {
    if ((cells[point] ?? GO_EMPTY) === GO_EMPTY || seen[point]) continue;

    const group = groupAt(cells, size, point);

    for (const stone of group.stones) seen[stone] = 1;

    out.push(group);
  }

  return out;
}

export const positionKey = (cells: readonly number[]): string => cells.join("");

export type GoIllegal =
  | "not_playing"
  | "wrong_turn"
  | "off_board"
  | "occupied"
  | "suicide"
  | "ko";

export interface GoPosition {
  size: number;
  cells: number[];
  /** 1-based move number that placed each stone, 0 when empty. */
  playedAt: number[];
  toPlay: GoColor;
  history: readonly string[];
}

export type GoStep =
  | { ok: true; cells: number[]; playedAt: number[]; captured: number[]; key: string }
  | { ok: false; reason: GoIllegal };

/**
 * Place one stone. Never mutates `position`.
 *
 * Captures are resolved neighbour by neighbour before the played stone is
 * checked for suicide, which is the order the rules need: a move that fills its
 * own last liberty is legal when it takes the surrounding chain with it.
 */
export function playStone(position: GoPosition, color: GoColor, point: number, moveNumber: number): GoStep {
  const { size } = position;

  if (!Number.isInteger(point) || point < 0 || point >= size * size)
    return { ok: false, reason: "off_board" };

  if ((position.cells[point] ?? GO_EMPTY) !== GO_EMPTY) return { ok: false, reason: "occupied" };

  const cells = position.cells.slice();
  const playedAt = position.playedAt.slice();

  cells[point] = color;
  playedAt[point] = moveNumber;

  const enemy = otherColor(color);
  const captured: number[] = [];

  for (const neighbour of neighbors(size)[point] ?? []) {
    if (cells[neighbour] !== enemy) continue;

    const group = groupAt(cells, size, neighbour);

    if (group.liberties.length > 0) continue;

    for (const stone of group.stones) {
      cells[stone] = GO_EMPTY;
      playedAt[stone] = 0;
      captured.push(stone);
    }
  }

  if (captured.length === 0 && groupAt(cells, size, point).liberties.length === 0)
    return { ok: false, reason: "suicide" };

  const key = positionKey(cells);

  // Positional superko: a move that rebuilds any earlier board is refused.
  if (position.history.includes(key)) return { ok: false, reason: "ko" };

  return { ok: true, cells, playedAt, captured, key };
}

export interface GoScore {
  black: number;
  white: number;
  komi: number;
  /** 1 black, 2 white, 0 draw. */
  winner: number;
  margin: number;
  blackStones: number;
  whiteStones: number;
  blackTerritory: number;
  whiteTerritory: number;
}

/**
 * Area scoring (Chinese rules): stones on the board plus empty regions that
 * touch exactly one colour. Points listed in `dead` are lifted first.
 */
export function areaScore(
  cells: readonly number[],
  size: number,
  dead: readonly number[],
  komi: number,
): GoScore {
  const board = cells.slice();

  for (const point of dead) board[point] = GO_EMPTY;

  const around = neighbors(size);
  const seen = new Uint8Array(size * size);
  let blackStones = 0;
  let whiteStones = 0;
  let blackTerritory = 0;
  let whiteTerritory = 0;

  for (const cell of board) {
    if (cell === GO_BLACK) blackStones += 1;
    else if (cell === GO_WHITE) whiteStones += 1;
  }

  for (let start = 0; start < size * size; start += 1) {
    if ((board[start] ?? GO_EMPTY) !== GO_EMPTY || seen[start]) continue;

    const region: number[] = [];
    let borders = 0;
    const stack = [start];

    seen[start] = 1;

    while (stack.length > 0) {
      const point = stack.pop()!;

      region.push(point);

      for (const neighbour of around[point] ?? []) {
        const cell = board[neighbour] ?? GO_EMPTY;

        if (cell === GO_EMPTY) {
          if (!seen[neighbour]) {
            seen[neighbour] = 1;
            stack.push(neighbour);
          }
        } else {
          borders |= cell;
        }
      }
    }

    if (borders === GO_BLACK || borders === GO_WHITE) {
      if (borders === GO_BLACK) blackTerritory += region.length;
      else whiteTerritory += region.length;
    }
  }

  const black = blackStones + blackTerritory;
  const white = whiteStones + whiteTerritory + komi;
  const margin = Math.abs(black - white);

  return {
    black,
    white,
    komi,
    winner: black > white ? GO_BLACK : white > black ? GO_WHITE : 0,
    margin,
    blackStones,
    whiteStones,
    blackTerritory,
    whiteTerritory,
  };
}

/** Points where `color` could legally play right now, as indices. */
export function legalPoints(position: GoPosition, color: GoColor): number[] {
  const out: number[] = [];

  for (let point = 0; point < position.size * position.size; point += 1) {
    if ((position.cells[point] ?? GO_EMPTY) !== GO_EMPTY) continue;

    const step = playStone(position, color, point, position.playedAt.length);

    if (step.ok) out.push(point);
  }

  return out;
}
