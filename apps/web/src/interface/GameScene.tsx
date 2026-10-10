import { knownValue, hasKnownKey } from "@/domain/view-contracts";
import { useId, type ReactElement } from "react";

/* Pixel scenes for the game cards and game pages, drawn on a 96x64 grid with
   crisp edges. Every material is the game's native ink; bevels, glows and
   shadows are translucent tints over flat fills. Decorative only: no match
   state enters here. */

const W = 96,
  H = 64;

type Level = 2 | 4 | 6 | 8 | 10 | 12;

const R = (x: number, y: number, w = 1, h = 1) => `M${x} ${y}h${w}v${h}h${-w}z`;

type Span = [number, number] | null;

/** Pixel spans of a w x h ellipse, one per row, relative to its top-left. */
function spans(w: number, h: number): Span[] {
  const rows: Span[] = [];

  for (let row = 0; row < h; row += 1) {
    const dy = (row + 0.5 - h / 2) / (h / 2);
    const half = (w / 2) * Math.sqrt(Math.max(0, 1 - dy * dy));

    const start = Math.round(w / 2 - half),
      end = Math.round(w / 2 + half);

    rows.push(end > start ? [start, end] : null);
  }

  return rows;
}

function oval(x: number, y: number, w: number, h = w, from = 0, to = h) {
  let path = "";
  spans(w, h).forEach((span, row) => {
    if (span && row >= from && row < to) path += R(x + span[0], y + row, span[1] - span[0], 1);
  });

  return path;
}

/** The part of an ellipse not covered by the same ellipse moved by (dx, dy): a lit or shaded crescent. */
function crescent(x: number, y: number, w: number, h: number, dx: number, dy: number) {
  const rows = spans(w, h);
  let path = "";
  rows.forEach((span, row) => {
    if (!span) return;
    const other = rows[row - dy];
    const [s, e] = span;

    if (!other) {
      path += R(x + s, y + row, e - s, 1);

      return;
    }

    const os = other[0] + dx,
      oe = other[1] + dx;

    if (os > s) path += R(x + s, y + row, Math.min(os, e) - s, 1);

    if (oe < e) path += R(x + Math.max(oe, s), y + row, e - Math.max(oe, s), 1);
  });

  return path;
}

/* 3x5 pixel glyphs for card ranks, suits and rank numbers. */
const font = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  K: ["#.#", "##.", "#..", "##.", "#.#"],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "##."],
  k: ["#..", "#.#", "##.", "#.#", "#.#"],
} satisfies Record<string, string[]>;

const suits = {
  heart: ["##.##", "#####", "#####", ".###.", "..#.."],
  spade: ["..#..", ".###.", "#####", "#####", "..#.."],
  diamond: ["..#..", ".###.", "#####", ".###.", "..#.."],
} satisfies Record<string, string[]>;

function glyph(rows: string[], x: number, y: number) {
  let path = "";
  rows.forEach((row, dy) =>
    [...row].forEach((cell, dx) => {
      if (cell === "#") path += R(x + dx, y + dy);
    }),
  );

  return path;
}

const text = (value: string, x: number, y: number) =>
  [...value].map((char, i) => glyph(knownValue(font, char) ?? [], x + i * 4, y)).join("");

const c = (name: string) => `var(--palette-${name})`;

function F({ d, fill }: { d: string; fill: string }) {
  return <path d={d} style={{ fill }} />;
}

/** A translucent tint: `level` of 16 scales the opacity. */
function T({ d, fill, level = 8 }: { d: string; fill: string; level?: Level }) {
  return <path d={d} style={{ fill, opacity: level / 16 }} />;
}

/** A soft halo of the game's color behind the art. */
function Glow({
  fill,
  x = 4,
  y = 2,
  w = 88,
  h = 64,
}: {
  fill: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}) {
  const id = `glow-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <>
      <radialGradient id={id}>
        <stop offset="0%" style={{ stopColor: fill, stopOpacity: 0.3 }} />
        <stop offset="70%" style={{ stopColor: fill, stopOpacity: 0.12 }} />
        <stop offset="100%" style={{ stopColor: fill, stopOpacity: 0 }} />
      </radialGradient>
      <ellipse
        cx={x + w / 2}
        cy={y + h / 2}
        rx={w / 2}
        ry={h / 2}
        style={{ fill: `url(#${id})` }}
      />
    </>
  );
}

/** A shaded sphere-like disc: base, lower-right shade, upper-left glint. */
function Disc({
  x,
  y,
  d,
  base,
  deep,
  light,
  h = d,
}: {
  x: number;
  y: number;
  d: number;
  base: string;
  deep: string;
  light: string;
  h?: number;
}) {
  const k = Math.max(1, Math.round(d / 5));

  return (
    <>
      <F d={oval(x, y, d, h)} fill={base} />
      <T d={crescent(x, y, d, h, -k, -k)} fill={deep} level={10} />
      <T d={crescent(x, y, d, h, k, k)} fill={light} level={6} />
    </>
  );
}

function Connect4() {
  const map = [".......", ".......", "....R..", "...RY..", "..RYY..", ".RYRYRY"];

  const fx = 18,
    fy = 10,
    fw = 60,
    fh = 50;

  let holes = "";
  const discs: { x: number; y: number; red: boolean }[] = [];
  map.forEach((line, row) =>
    [...line].forEach((cell, col) => {
      const x = fx + 3 + col * 8,
        y = fy + 2 + row * 8;

      if (cell === ".") holes += oval(x, y, 6);
      else discs.push({ x, y, red: cell === "R" });
    }),
  );

  return (
    <>
      <Glow fill={c("c4-frame-light")} />
      <F d={R(14, 6, 4, 58) + R(78, 6, 4, 58)} fill={c("c4-frame-deep")} />
      <F d={R(8, 60, 16, 4) + R(72, 60, 16, 4)} fill={c("c4-frame-deep")} />
      <T d={R(14, 6, 2, 58) + R(78, 6, 2, 58)} fill={c("c4-frame-light")} level={6} />
      <F d={R(fx, fy, fw, fh)} fill={c("c4-frame")} />
      <T d={R(fx, fy, fw, 2) + R(fx, fy, 2, fh)} fill={c("c4-frame-light")} level={10} />
      <F d={R(fx, fy + fh - 2, fw, 2)} fill={c("c4-frame-deep")} />
      <T d={R(fx + fw - 3, fy, 3, fh)} fill={c("c4-frame-deep")} level={8} />
      <F d={holes} fill={c("g950")} />
      <T d={holes} fill={c("c4-frame-deep")} level={6} />
      {discs.map(({ x, y, red }) => (
        <Disc
          key={`${x}:${y}`}
          x={x}
          y={y}
          d={6}
          base={c(red ? "c4-red" : "c4-yellow")}
          deep={c(red ? "c4-red-deep" : "c4-yellow-deep")}
          light={c("white")}
        />
      ))}
      <T d={R(fx + 4, fy + 2 + 5 * 8 + 2, 34, 1)} fill={c("white")} level={2} />
      <g className="scene-move">
        <Disc
          x={fx + 3 + 3 * 8}
          y={1}
          d={6}
          base={c("c4-yellow")}
          deep={c("c4-yellow-deep")}
          light={c("white")}
        />
      </g>
    </>
  );
}

function Checkers() {
  const sx = 8,
    sy = 8,
    size = 10;

  let light = "",
    dark = "";

  for (let row = 0; row < 6; row += 1)
    for (let col = 0; col < 8; col += 1) {
      const square = R(sx + col * size, sy + row * size, size, size);

      if ((row + col) % 2) dark += square;
      else light += square;
    }

  const men: [number, number, "ebony" | "ivory", boolean?][] = [
    [0, 1, "ebony"],
    [0, 3, "ebony"],
    [0, 7, "ebony"],
    [1, 0, "ebony"],
    [1, 4, "ebony"],
    [2, 5, "ebony"],
    [3, 2, "ivory", true],
    [4, 1, "ivory"],
    [4, 5, "ivory"],
    [5, 2, "ivory"],
    [5, 6, "ivory"],
    [4, 7, "ivory"],
  ];

  return (
    <>
      <Glow fill={c("maple")} />
      <F d={R(sx - 4, sy - 4, 8 * size + 8, 6 * size + 8)} fill={c("walnut-deep")} />
      <T d={R(sx - 4, sy - 4, 8 * size + 8, 2)} fill={c("walnut")} level={8} />
      <F d={light} fill={c("maple")} />
      <T d={light} fill={c("maple-deep")} level={4} />
      <F d={dark} fill={c("walnut")} />
      <T d={dark} fill={c("walnut-deep")} level={6} />
      <T
        d={
          R(sx + 3 * size, sy + 2 * size, size, size) + R(sx + 1 * size, sy + 4 * size, size, size)
        }
        fill={c("crown")}
        level={6}
      />
      {men.map(([row, col, wood, king]) => {
        const x = sx + col * size + 1,
          y = sy + row * size + 1;

        const base = c(wood),
          rim = c(wood === "ebony" ? "ebony-light" : "ivory-deep");

        return (
          <g key={`${row}:${col}`} className={king ? "scene-move" : undefined}>
            <T d={oval(x + 1, y + 2, 8, 8)} fill={c("black")} level={8} />
            <F d={oval(x, y, 8)} fill={rim} />
            <F d={oval(x + 1, y + 1, 6)} fill={base} />
            <T d={crescent(x, y, 8, 8, 2, 2)} fill={c("white")} level={wood === "ebony" ? 4 : 6} />
            {king && (
              <F
                d={
                  R(x + 2, y + 4, 4, 2) + R(x + 2, y + 3) + R(x + 5, y + 3) + R(x + 3, y + 2, 2, 2)
                }
                fill={c("crown")}
              />
            )}
          </g>
        );
      })}
    </>
  );
}

function Reversi() {
  const bx = 10,
    by = 4,
    size = 9;

  const map = ["........", "..b.....", "..bbw...", "..bwwb..", "...wbw..", "....b...", "........"];
  let lines = "";

  for (let i = 0; i <= 8; i += 1) lines += R(bx + i * size, by, 1, 7 * size);

  for (let i = 0; i <= 7; i += 1) lines += R(bx, by + i * size, 8 * size + 1, 1);

  const legal = [
    [1, 4],
    [5, 2],
    [2, 6],
  ];

  return (
    <>
      <Glow fill={c("reversi-felt")} />
      <F d={R(bx - 3, by - 3, 8 * size + 7, 7 * size + 6)} fill={c("reversi-felt-deep")} />
      <F d={R(bx, by, 8 * size + 1, 7 * size)} fill={c("reversi-felt")} />
      <T d={R(bx, by, 8 * size + 1, 7 * size)} fill={c("reversi-felt-deep")} level={4} />
      <F d={lines} fill={c("reversi-line")} />
      {legal.map(([row, col]) => (
        <T
          key={`${row}:${col}`}
          d={R(bx + col! * size + 3, by + row! * size + 3, 4, 4)}
          fill={c("white")}
          level={8}
        />
      ))}
      {map.flatMap((line, row) =>
        [...line].map((cell, col) => {
          if (cell === ".") return null;

          const x = bx + col * size + 1,
            y = by + row * size + 1,
            black = cell === "b";

          return (
            <Disc
              key={`${row}:${col}`}
              x={x}
              y={y}
              d={8}
              base={c(black ? "disc-black" : "disc-white")}
              deep={c(black ? "black" : "disc-white-deep")}
              light={c(black ? "disc-black-light" : "white")}
            />
          );
        }),
      )}
      <g className="scene-move">
        <F d={oval(bx + 6 * size + 3, by + 4 * size + 1, 4, 8, 0, 4)} fill={c("disc-white")} />
        <F d={oval(bx + 6 * size + 3, by + 4 * size + 1, 4, 8, 4, 8)} fill={c("disc-black")} />
      </g>
    </>
  );
}

function Card({
  x,
  y,
  rank,
  suit,
  red,
}: {
  x: number;
  y: number;
  rank: string;
  suit: string;
  red: boolean;
}) {
  const ink = c(red ? "card-red" : "card-black");
  const body = R(x + 1, y, 16, 24) + R(x, y + 1, 18, 22);

  return (
    <>
      <T d={R(x + 2, y + 2, 18, 24)} fill={c("black")} level={8} />
      <F d={body} fill={c("card")} />
      <T d={R(x + 16, y + 1, 2, 22) + R(x + 1, y + 22, 16, 2)} fill={c("g400")} level={6} />
      <F
        d={
          glyph(knownValue(font, rank)!, x + 2, y + 2) +
          glyph(knownValue(suits, suit)!, x + 6, y + 10)
        }
        fill={ink}
      />
      <T d={glyph(knownValue(suits, suit)!, x + 6, y + 10)} fill={c("white")} level={2} />
    </>
  );
}

function Chips({
  x,
  y,
  count,
  color,
  deep,
}: {
  x: number;
  y: number;
  count: number;
  color: string;
  deep: string;
}) {
  return (
    <>
      <T d={oval(x - 1, y + 1, 14, 5)} fill={c("black")} level={8} />
      {Array.from({ length: count }, (_, i) => {
        const top = y - i * 2;

        return (
          <g key={i}>
            <F d={oval(x, top, 12, 5)} fill={deep} />
            <F d={oval(x, top - 1, 12, 5)} fill={color} />
            <F
              d={R(x + 2, top + 1, 1, 2) + R(x + 9, top + 1, 1, 2) + R(x + 5, top + 3, 2, 1)}
              fill={c("chip-white")}
            />
          </g>
        );
      })}
      <T d={oval(x + 3, y - count * 2 + 1, 6, 2)} fill={c("chip-white")} level={8} />
    </>
  );
}

function Poker() {
  return (
    <>
      <Glow fill={c("baize-line")} />
      <F d={oval(-14, 18, 124, 76)} fill={c("rail")} />
      <T d={oval(-14, 18, 124, 76, 0, 3)} fill={c("rail-light")} level={8} />
      <F d={oval(-8, 24, 112, 64)} fill={c("baize")} />
      <T d={oval(-8, 24, 112, 64)} fill={c("baize-deep")} level={4} />
      <T d={crescent(-2, 30, 100, 56, 0, 2)} fill={c("baize-line")} level={8} />
      <F d={R(13, 15, 16, 24) + R(12, 16, 18, 22)} fill={c("card-back")} />
      <T d={R(14, 17, 14, 20)} fill={c("card-back-deep")} level={8} />
      <Card x={24} y={10} rank="A" suit="spade" red={false} />
      <Card x={40} y={6} rank="K" suit="heart" red />
      <Card x={56} y={10} rank="Q" suit="diamond" red />
      <Chips x={12} y={50} count={3} color={c("chip-black")} deep={c("black")} />
      <Chips x={70} y={52} count={5} color={c("chip-red")} deep={c("card-back-deep")} />
      <g className="scene-move">
        <Chips x={82} y={46} count={2} color={c("chip-blue")} deep={c("sky-deep")} />
      </g>
    </>
  );
}

function Battleship() {
  const sx = 6,
    sy = 4,
    size = 8;

  let grid = "";

  for (let i = 0; i <= 11; i += 1) grid += R(sx + i * size, sy, 1, 64);

  for (let i = 0; i <= 8; i += 1) grid += R(sx, sy + i * size, 88, 1);

  const hull: [number, number][] = [
    [20, 66],
    [19, 69],
    [18, 71],
    [19, 70],
    [21, 67],
    [24, 63],
  ];

  let ship = "",
    keel = "";

  hull.forEach(([from, to], i) => {
    if (i < 4) ship += R(from, 30 + i, to - from, 1);
    else keel += R(from, 30 + i, to - from, 1);
  });

  const misses = [
    [14, 12],
    [78, 14],
    [30, 50],
    [62, 50],
    [86, 38],
  ];

  return (
    <>
      <Glow fill={c("sea-light")} />
      <F d={R(sx, sy, 88, 64)} fill={c("sea")} />
      <T d={R(sx, sy + 32, 88, 32)} fill={c("sea-deep")} level={8} />
      <T d={grid} fill={c("sea-light")} level={10} />
      <T
        d={R(10, 22, 6, 1) + R(66, 8, 8, 1) + R(40, 44, 10, 1) + R(76, 58, 6, 1) + R(18, 56, 6, 1)}
        fill={c("sea-foam")}
        level={10}
      />
      <T d={R(16, 37, 58, 2)} fill={c("sea-foam")} level={6} />
      <F d={ship} fill={c("steel")} />
      <F d={keel} fill={c("steel-deep")} />
      <T d={R(18, 32, 54, 2)} fill={c("steel-deep")} level={6} />
      <F d={R(20, 30, 46, 1)} fill={c("steel-light")} />
      <F d={R(32, 25, 14, 5) + R(50, 27, 8, 3) + R(38, 20, 3, 5)} fill={c("steel")} />
      <T d={R(32, 25, 14, 1) + R(50, 27, 8, 1)} fill={c("steel-light")} level={12} />
      <F d={R(58, 28, 6, 1)} fill={c("steel-deep")} />
      <T d={oval(38, 22, 16, 16)} fill={c("tangerine")} level={2} />
      <Disc x={42} y={27} d={6} base={c("peg-red")} deep={c("tomato-deep")} light={c("white")} />
      <Disc x={26} y={27} d={6} base={c("peg-red")} deep={c("tomato-deep")} light={c("white")} />
      {misses.map(([x, y]) => (
        <Disc
          key={`${x}:${y}`}
          x={x!}
          y={y!}
          d={5}
          base={c("peg-white")}
          deep={c("steel-light")}
          light={c("white")}
        />
      ))}
      <g className="scene-move">
        <Disc x={54} y={14} d={6} base={c("peg-red")} deep={c("tomato-deep")} light={c("white")} />
      </g>
    </>
  );
}

function Codenames() {
  const layout = [
    ["red", "word", "blue"],
    ["word", "assassin", "red"],
    ["blue", "bystander", "word"],
  ];

  const colors = {
    red: [c("cn-red"), c("cn-red-deep")],
    blue: [c("cn-blue"), c("cn-blue-deep")],
    assassin: [c("cn-assassin"), c("black")],
    bystander: [c("cn-bystander"), c("cn-bystander-deep")],
    word: [c("cn-card"), c("cn-card-deep")],
  } satisfies Record<string, [string, string]>;

  return (
    <>
      <Glow fill={c("cn-red")} w={44} x={4} />
      <Glow fill={c("cn-blue")} w={44} x={48} />
      {layout.flatMap((row, r) =>
        row.map((kind, col) => {
          const x = 8 + col * 28,
            y = 6 + r * 20;

          const [base, deep] = knownValue(colors, kind)!;
          const agent = kind === "red" || kind === "blue";

          return (
            <g key={`${r}:${col}`} className={r === 1 && col === 2 ? "scene-move" : undefined}>
              <T d={R(x + 2, y + 2, 24, 16)} fill={c("black")} level={8} />
              <F d={R(x + 1, y, 22, 16) + R(x, y + 1, 24, 14)} fill={base} />
              <T d={R(x, y + 10, 24, 5) + R(x + 1, y + 15, 22, 1)} fill={deep} level={8} />
              <T d={R(x + 1, y + 1, 22, 1)} fill={c("white")} level={6} />
              {kind === "word" && (
                <F d={R(x + 4, y + 8, 16, 2) + R(x + 4, y + 4, 6, 1)} fill={c("ink")} />
              )}
              {kind === "bystander" && <T d={R(x + 4, y + 8, 16, 2)} fill={c("ink")} level={10} />}
              {agent && (
                <F
                  d={oval(x + 9, y + 3, 6, 6) + R(x + 7, y + 9, 10, 4) + R(x + 8, y + 8, 8, 1)}
                  fill={c("white")}
                />
              )}
              {agent && <T d={R(x + 7, y + 11, 10, 2)} fill={deep} level={8} />}
              {kind === "assassin" && (
                <F
                  d={
                    R(x + 8, y + 4) +
                    R(x + 15, y + 4) +
                    R(x + 9, y + 5) +
                    R(x + 14, y + 5) +
                    R(x + 10, y + 6, 4, 2) +
                    R(x + 9, y + 8) +
                    R(x + 14, y + 8) +
                    R(x + 8, y + 9) +
                    R(x + 15, y + 9)
                  }
                  fill={c("tomato")}
                />
              )}
            </g>
          );
        }),
      )}
    </>
  );
}

function Contexto() {
  const rows: [string, number, string][] = [
    ["1", 76, "rank-hot"],
    ["12", 64, "rank-hot"],
    ["48", 52, "rank-warm"],
    ["203", 40, "rank-warm"],
    ["917", 28, "rank-cool"],
    ["4k", 16, "rank-cold"],
  ];

  return (
    <>
      <Glow fill={c("rank-hot")} />
      {rows.map(([rank, length, heat], i) => {
        const y = 4 + i * 10,
          x = 6;

        return (
          <g key={rank} className={i === 0 ? "scene-move" : undefined}>
            <F d={R(x + 1, y, 82, 8) + R(x, y + 1, 84, 6)} fill={c("g850")} />
            <F d={R(x + 1, y, length - 6, 8) + R(x, y + 1, length - 5, 6)} fill={c(heat)} />
            <T d={R(x + length - 6, y, 6, 8)} fill={c(heat)} level={8} />
            <T d={R(x + length - 1, y + 1, 4, 6)} fill={c(heat)} level={2} />
            <T d={R(x + 1, y + 5, length - 7, 3)} fill={c("black")} level={4} />
            <F d={R(x + 4, y + 3, Math.min(length - 12, 12 + (i % 3) * 4), 2)} fill={c("ink")} />
            <F
              d={text(rank, x + 82 - rank.length * 4, y + 2)}
              fill={c(i === 0 ? "white" : "g400")}
            />
          </g>
        );
      })}
    </>
  );
}

function Pokemon() {
  const bx = 52,
    by = 8,
    d = 30,
    band = 14;

  return (
    <>
      <Glow fill={c("pk-sky-deep")} />
      <F d={oval(30, 40, 62, 18)} fill={c("pk-grass")} />
      <T d={crescent(30, 40, 62, 18, 0, -4)} fill={c("pk-grass-deep")} level={10} />
      <T d={oval(36, 42, 50, 10)} fill={c("pk-ground")} level={4} />
      <T d={oval(bx + 2, by + d - 6, d - 2, 10)} fill={c("black")} level={10} />
      <F d={oval(bx, by, d, d, 0, band)} fill={c("hp-low")} />
      <F d={oval(bx, by, d, d, band + 2, d)} fill={c("g50")} />
      <F d={oval(bx, by, d, d, band, band + 2)} fill={c("ink")} />
      <T d={crescent(bx, by, d, d, -4, -4)} fill={c("black")} level={8} />
      <T d={crescent(bx, by, d, d, 4, 4)} fill={c("white")} level={6} />
      <F d={oval(bx + 10, by + 10, 10, 10)} fill={c("ink")} />
      <F d={oval(bx + 12, by + 12, 6, 6)} fill={c("g50")} />
      <T d={oval(bx + 12, by + 12, 6, 6, 3, 6)} fill={c("g400")} level={8} />
      <F d={R(4, 10, 40, 16)} fill={c("g850")} />
      <F d={R(8, 13, 18, 2)} fill={c("g200")} />
      <F d={R(8, 19, 32, 3)} fill={c("g700")} />
      <F d={R(8, 19, 22, 3)} fill={c("hp-high")} />
      <T d={R(26, 19, 4, 3)} fill={c("hp-mid")} level={8} />
      <F d={R(4, 44, 22, 10)} fill={c("g850")} />
      <F d={R(7, 49, 16, 2)} fill={c("g700")} />
      <F d={R(7, 49, 6, 2)} fill={c("hp-low")} />
      <g className="scene-move">
        <F
          d={R(86, 4, 4, 2) + R(84, 6, 4, 2) + R(82, 8, 8, 2) + R(86, 10, 2, 2) + R(84, 12, 2, 2)}
          fill={c("type-electric")}
        />
      </g>
    </>
  );
}

const scenes = {
  connect4: Connect4,
  checkers: Checkers,
  reversi: Reversi,
  poker: Poker,
  battleship: Battleship,
  codenames: Codenames,
  contexto: Contexto,
  pokemon: Pokemon,
} satisfies Record<string, () => ReactElement>;

export function GameScene({ id, className }: { id: string; className?: string }) {
  const Scene = hasKnownKey(scenes, id) ? scenes[id] : undefined;

  return (
    <svg
      className={["game-scene", className].filter(Boolean).join(" ")}
      data-game={id}
      viewBox={`0 0 ${W} ${H}`}
      {...{ "shapeRendering": "crispEdges" }}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {Scene ? <Scene /> : <T d={R(0, 0, W, H)} fill="var(--game)" level={4} />}
    </svg>
  );
}
