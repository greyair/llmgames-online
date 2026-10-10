import { knownValue } from "@/domain/view-contracts";
import type { ReactElement } from "react";
import { roughEllipse, roughLine, roughRect, type Pt } from "./sketch";

/* Hand-drawn card art in the style of the landing arcade: pastel fills with
   wobbly ink outlines on a 120x80 stage. Shapes are seeded, so the drawing is
   identical on the server and client, and it never animates, so a page of
   cards costs nothing once painted. Decorative only. */

const W = 120,
  H = 80,
  LINE = 0.8,
  THIN = 0.5;

const c = (name: string) => `var(--palette-${name})`;

const INK = c("ink");

type Style = { stroke?: string | false; lw?: number; alpha?: number };

class Pen {
  readonly parts: ReactElement[] = [];
  private seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  private path(d: string, fill: string | undefined, { stroke, lw = LINE, alpha }: Style) {
    this.parts.push(
      <path
        key={this.parts.length}
        d={d}
        fill={fill ?? "none"}
        stroke={stroke === false ? "none" : (stroke ?? INK)}
        strokeWidth={lw}
        opacity={alpha}
      />,
    );
  }
  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    fill?: string,
    { r = 2, amp = 0.35, ...style }: Style & { r?: number; amp?: number } = {},
  ) {
    this.path(roughRect(x, y, w, h, { seed: this.seed++, amp, r }), fill, style);
  }
  circle(
    cx: number,
    cy: number,
    rx: number,
    ry = rx,
    fill?: string,
    { amp = 0.25, ...style }: Style & { amp?: number } = {},
  ) {
    this.path(roughEllipse(cx, cy, rx, ry, { seed: this.seed++, amp }), fill, style);
  }
  line(a: Pt, b: Pt, { amp = 0.4, ...style }: Style & { amp?: number } = {}) {
    this.path(roughLine(a, b, { seed: this.seed++, amp }), undefined, style);
  }
  drawPath(d: string, fill?: string, style: Style = {}) {
    this.path(d, fill, style);
  }
  flat(x: number, y: number, w: number, h: number, fill: string) {
    this.parts.push(<rect key={this.parts.length} x={x} y={y} width={w} height={h} fill={fill} />);
  }
  text(
    value: string,
    x: number,
    y: number,
    size: number,
    fill: string,
    anchor: "start" | "middle" | "end" = "middle",
  ) {
    this.parts.push(
      <text
        key={this.parts.length}
        x={x}
        y={y}
        fontSize={size}
        fill={fill}
        textAnchor={anchor}
        dominantBaseline="central"
        style={{ fontFamily: "var(--font-ui)", fontWeight: 800 }}
      >
        {value}
      </text>,
    );
  }
}

function connect4(g: Pen) {
  const S = 10,
    X = 25,
    Y = 16,
    R = 3.6;

  const columns = [[1, 2, 1], [2, 1], [1, 2, 2, 1], [2, 1, 1], [1, 2], [2], []];
  g.rect(X - 3, Y - 3, 7 * S + 6, 6 * S + 6, c("c4-frame-light"), { r: 3 });
  columns.forEach((col, x) => {
    for (let r = 0; r < 6; r += 1) {
      const v = col[r] ?? 0;
      g.circle(
        X + x * S + S / 2,
        Y + (5 - r) * S + S / 2,
        R,
        R,
        v === 1 ? c("c4-red") : v === 2 ? c("c4-yellow") : c("card"),
        { lw: v ? LINE : 0.6 },
      );
    }
  });
  g.circle(X + 5 * S + S / 2, Y - 8, R, R, c("c4-red"));
}

function boardDiscs(
  g: Pen,
  rows: string[],
  x: number,
  y: number,
  s: number,
  discs: Record<string, string>,
) {
  rows.forEach((row, r) =>
    [...row].forEach((v, col) => {
      const fill = discs[v];

      if (fill) g.circle(x + col * s + s / 2, y + r * s + s / 2, s * 0.38, s * 0.38, fill);
    }),
  );
}

function reversi(g: Pen) {
  const N = 8,
    S = 8.5,
    X = (W - N * S) / 2,
    Y = (H - N * S) / 2;

  g.rect(X, Y, N * S, N * S, c("reversi-felt"), { r: 2 });

  for (let i = 1; i < N; i += 1) {
    g.line([X + i * S, Y + 1], [X + i * S, Y + N * S - 1], { lw: THIN, alpha: 0.45 });
    g.line([X + 1, Y + i * S], [X + N * S - 1, Y + i * S], { lw: THIN, alpha: 0.45 });
  }

  boardDiscs(
    g,
    [
      "........",
      "..b.....",
      "..bbw...",
      "..bwww..",
      "...wbb..",
      "....bw..",
      ".....w..",
      "........",
    ],
    X,
    Y,
    S,
    { b: c("disc-black"), w: c("disc-white") },
  );
}

function checkers(g: Pen) {
  const N = 8,
    S = 8.5,
    X = (W - N * S) / 2,
    Y = (H - N * S) / 2;

  for (let r = 0; r < N; r += 1)
    for (let col = 0; col < N; col += 1)
      g.flat(X + col * S, Y + r * S, S, S, (r + col) % 2 ? c("walnut") : c("maple"));
  g.rect(X, Y, N * S, N * S, undefined, { r: 1.5, lw: 1 });
  boardDiscs(
    g,
    [
      ".w.w.w.w",
      "w...w.w.",
      ".w......",
      "..b.w...",
      ".......b",
      "b.b...b.",
      ".b.b.b.b",
      "b.b.b.b.",
    ],
    X,
    Y,
    S,
    { w: c("ivory"), b: c("ebony") },
  );
  g.circle(X + 4.5 * S, Y + 3.5 * S, S * 0.16, S * 0.16, c("crown"), { lw: THIN });
}

function battleship(g: Pen) {
  const X = 10,
    Y = 8,
    w = 100,
    h = 64;

  g.rect(X, Y, w, h, c("sea"), { r: 3 });

  for (let i = 1; i < 10; i += 1)
    g.line([X + i * 10, Y + 1], [X + i * 10, Y + h - 1], { lw: THIN, alpha: 0.3 });

  for (let i = 1; i < 6; i += 1)
    g.line([X + 1, Y + i * (h / 6)], [X + w - 1, Y + i * (h / 6)], { lw: THIN, alpha: 0.3 });
  g.rect(28, 36, 56, 11, c("steel"), { r: 5 });
  g.rect(46, 28, 18, 9, c("steel-light"), { r: 2 });
  g.circle(36, 41.5, 2.4, 2.4, c("steel-light"));
  g.line([64, 31], [74, 26], { lw: 1.2 });

  for (const [x, y] of [
    [42, 41.5],
    [56, 41.5],
    [70, 41.5],
  ] as const)
    g.circle(x, y, 3, 3, c("peg-red"));

  for (const [x, y] of [
    [20, 18],
    [94, 20],
    [100, 60],
    [22, 62],
    [78, 62],
    [64, 16],
  ] as const)
    g.circle(x, y, 2.6, 2.6, c("peg-white"));
}

function codenames(g: Pen) {
  const cw = 32,
    ch = 20,
    gap = 4,
    X = (W - 3 * cw - 2 * gap) / 2,
    Y = (H - 3 * ch - 2 * gap) / 2;

  const cards = [
    "cn-red",
    "cn-card",
    "cn-blue",
    "cn-card",
    "cn-assassin",
    "cn-red",
    "cn-blue",
    "cn-card",
    "cn-bystander",
  ];

  cards.forEach((card, i) => {
    const x = X + (i % 3) * (cw + gap),
      y = Y + Math.floor(i / 3) * (ch + gap);

    g.rect(x, y, cw, ch, c(card), { r: 2.5 });

    if (card === "cn-card") {
      g.line([x + 7, y + ch / 2], [x + cw - 7, y + ch / 2], { lw: 2 });

      return;
    }

    const figure = card === "cn-assassin" ? c("card") : c("ink");
    g.circle(x + cw / 2, y + 7, 2.8, 2.8, figure, { lw: THIN });
    g.rect(x + cw / 2 - 5, y + 11, 10, 6, figure, { r: 2.5, lw: THIN });
  });
}

function poker(g: Pen) {
  g.circle(60, 60, 58, 24, c("rail"));
  g.circle(60, 60, 51, 19, c("baize"));

  const card = (x: number, y: number, rot: number, rank: string, suit: string, red: boolean) => {
    const parts = new Pen(x * 7 + y);
    parts.rect(0, 0, 20, 28, c("card"), { r: 2.5 });
    parts.text(rank, 4.5, 5.5, 6, red ? c("card-red") : c("card-black"));
    parts.text(suit, 10, 16, 11, red ? c("card-red") : c("card-black"));
    g.parts.push(
      <g key={g.parts.length} transform={`translate(${x} ${y}) rotate(${rot} 10 14)`}>
        {parts.parts}
      </g>,
    );
  };

  card(30, 10, -10, "A", "♠", false);
  card(50, 6, 0, "K", "♥", true);
  card(70, 10, 10, "Q", "♦", true);
  g.rect(14, 50, 14, 20, c("card-back"), { r: 2 });

  for (let i = 0; i < 4; i += 1) g.circle(94, 66 - i * 3, 7, 2.6, c("chip-red"), { lw: 0.6 });

  for (let i = 0; i < 2; i += 1) g.circle(106, 68 - i * 3, 6, 2.3, c("chip-blue"), { lw: 0.6 });
}

function contexto(g: Pen) {
  const bars: [number, string, string][] = [
    [100, "rank-hot", "1"],
    [86, "rank-warm", "12"],
    [72, "rank-warm", "48"],
    [58, "rank-cool", "203"],
    [44, "rank-cold", "917"],
  ];

  bars.forEach(([w, ink, rank], i) => {
    const y = 8 + i * 13.5;
    g.rect(10, y, w, 10, c(ink), { r: 2 });
    g.line([15, y + 5], [15 + w * 0.32, y + 5], { lw: 1.8 });
    g.text(rank, 10 + w - 4, y + 5.3, 6, INK, "end");
  });
}

function pokemon(g: Pen) {
  g.circle(70, 64, 44, 11, c("pk-grass"));
  g.circle(70, 66, 30, 6, c("pk-grass-deep"), { stroke: false, alpha: 0.6 });

  const cx = 70,
    cy = 40,
    r = 18;

  g.circle(cx, cy, r, r, c("card"), { lw: 1 });
  g.drawPath(`M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}Z`, c("hp-low"), { lw: 1 });
  g.line([cx - r, cy], [cx + r, cy], { lw: 2.4 });
  g.circle(cx, cy, 5.2, 5.2, c("card"), { lw: 1.2 });
  g.circle(cx, cy, 2.2, 2.2, c("card"), { lw: THIN });
  g.rect(6, 8, 38, 17, c("card"), { r: 2.5 });
  g.line([10, 13], [28, 13], { lw: 1.6 });
  g.rect(10, 18, 30, 3.5, c("g400"), { r: 1.5, lw: THIN });
  g.rect(10, 18, 20, 3.5, c("hp-high"), { r: 1.5, lw: THIN });
  g.drawPath("M104 6L96 19H101L97 30L108 15H102L106 6Z", c("type-electric"));
}

/* `board` is the main piece of each drawing as [x, y, w, h]. Cropped art
   scales every board to the same width and shows only its top, so the card's
   bottom edge cuts each one at the same place. */
type Box = [number, number, number, number];

const scenes = {
  connect4: { seed: 11, board: [22, 13, 76, 66], draw: connect4 },
  reversi: { seed: 23, board: [26, 6, 68, 68], draw: reversi },
  checkers: { seed: 37, board: [26, 6, 68, 68], draw: checkers },
  battleship: { seed: 41, board: [10, 8, 100, 64], draw: battleship },
  codenames: { seed: 53, board: [8, 6, 104, 68], draw: codenames },
  poker: { seed: 67, board: [8, 4, 104, 80], draw: poker },
  contexto: { seed: 79, board: [10, 8, 100, 64], draw: contexto },
  pokemon: { seed: 83, board: [6, 6, 108, 70], draw: pokemon },
} satisfies Record<string, { seed: number; board: Box; draw: (g: Pen) => void }>;

export const hasSketchScene = (id: string) => id in scenes;

const CROP_PAD = 0.06,
  CROP_RATIO = 0.56;

export function SketchScene({
  id,
  className,
  crop = false,
}: {
  id: string;
  className?: string;
  crop?: boolean;
}) {
  const scene = knownValue(scenes, id);

  if (!scene) return null;
  const g = new Pen(scene.seed);
  scene.draw(g);

  const [bx, by, bw] = scene.board,
    pad = bw * CROP_PAD,
    vw = bw + pad * 2;

  const viewBox = crop ? `${bx - pad} ${by - pad} ${vw} ${vw * CROP_RATIO}` : `0 0 ${W} ${H}`;

  return (
    <svg
      className={["sketch-scene", className].filter(Boolean).join(" ")}
      data-game={id}
      data-crop={crop || undefined}
      viewBox={viewBox}
      strokeLinecap="round"
      strokeLinejoin="round"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {g.parts}
    </svg>
  );
}
