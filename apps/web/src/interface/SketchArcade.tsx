import { z } from "zod";
import { knownValue } from "@/domain/view-contracts";
import { useEffect, useRef } from "react";
import { BATTLESHIP_FLEET } from "@llmgames/game-catalog";
import { roughEllipse, roughLine, roughRect, type Pt } from "./sketch";

/* The hero's playable screen, drawn like the "Under the hood" diagram:
   pastel shapes with wobbly ink outlines that re-seed a few times a second.
   Scenes run on a 120×80 grid scaled to the canvas, play themselves, aim on
   hover and take a turn on click or tap. Colors come from palette tokens. */

export const ARCADE_W = 120;

export const ARCADE_H = 80;

const W = ARCADE_W,
  H = ARCADE_H;

const FRAME_MS = 33;

/** Line re-seeds per second, matching the diagram's boil. */
const BOIL_HZ = 8;

const LINE = 0.8,
  THIN = 0.5;

type RGB = readonly [number, number, number];

type Pointer = { x: number; y: number; inside: boolean };

type Demo = {
  draw(g: Sketch, t: number, dt: number, p: Pointer): void;
  click?(x: number, y: number, t: number): void;
};

const INKS = [
  "ink",
  "card",
  "g900",
  "g850",
  "g800",
  "g700",
  "g400",
  "white",
  "sun",
  "sky",
  "pink",
  "aqua",
  "grass",
  "tomato",
  "c4-frame-light",
  "c4-red",
  "c4-yellow",
  "reversi-felt",
  "disc-black",
  "disc-white",
  "sea",
  "steel",
  "steel-light",
  "peg-red",
  "peg-white",
  "rank-hot",
  "rank-warm",
  "rank-cool",
  "rank-cold",
  "baize",
  "rail",
  "card-red",
  "card-black",
  "card-back",
  "chip-red",
  "chip-blue",
  "maple",
  "walnut",
  "walnut-deep",
  "ebony",
  "ivory",
  "crown",
  "cn-card",
  "cn-red",
  "cn-blue",
  "cn-bystander",
  "cn-assassin",
  "pk-sky",
  "pk-grass",
  "pk-grass-deep",
  "hp-high",
  "hp-mid",
  "hp-low",
  "type-electric",
  "type-fire",
] as const;

type Ink = (typeof INKS)[number];

type Inks = Record<Ink, string>;

function readInks(host: HTMLElement): Inks {
  const probe = document.createElement("canvas").getContext("2d")!;
  const style = getComputedStyle(host);
  const out: Partial<Inks> = {};

  for (const name of INKS) {
    probe.fillStyle = "#000";
    probe.fillStyle = style.getPropertyValue(`--palette-${name}`).trim() || "#000";
    out[name] = String(probe.fillStyle);
  }

  return z.record(z.enum(INKS), z.string()).parse(out);
}

const rgb = (hex: string): RGB =>
  hex.startsWith("#") && hex.length === 7
    ? [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
    : [0, 0, 0];

/** Mixes an ink toward white, for pastel fills. */
const tint = (hex: string, k: number) => {
  const c = rgb(hex);

  return `rgb(${c.map((v) => Math.round(v + (255 - v) * k)).join(",")})`;
};

type Style = { stroke?: string | false; lw?: number; alpha?: number };

class Sketch {
  readonly ctx: CanvasRenderingContext2D;
  readonly ink: string;
  readonly font: string;
  boil = 0;
  private seed = 1;
  constructor(ctx: CanvasRenderingContext2D, ink: string, font: string) {
    this.ctx = ctx;
    this.ink = ink;
    this.font = font;
  }
  begin(boil: number) {
    const { ctx } = this,
      sx = ctx.canvas.width / W,
      sy = ctx.canvas.height / H;

    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.globalAlpha = 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    this.boil = boil;
    this.seed = 1;
  }
  private paint(d: string, fill: string | undefined, { stroke, lw = LINE, alpha = 1 }: Style) {
    const { ctx } = this,
      path = new Path2D(d);

    ctx.globalAlpha = alpha;

    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill(path);
    }

    if (stroke !== false) {
      ctx.strokeStyle = stroke ?? this.ink;
      ctx.lineWidth = lw;
      ctx.stroke(path);
    }

    ctx.globalAlpha = 1;
  }
  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    fill?: string,
    { r = 2, amp = 0.35, ...style }: Style & { r?: number; amp?: number } = {},
  ) {
    if (w <= 0 || h <= 0) return;
    this.paint(roughRect(x, y, w, h, { seed: this.seed++, boil: this.boil, amp, r }), fill, style);
  }
  circle(
    cx: number,
    cy: number,
    rx: number,
    ry = rx,
    fill?: string,
    { amp = 0.25, ...style }: Style & { amp?: number } = {},
  ) {
    if (rx <= 0 || ry <= 0) return;
    this.paint(
      roughEllipse(cx, cy, rx, ry, { seed: this.seed++, boil: this.boil, amp }),
      fill,
      style,
    );
  }
  line(a: Pt, b: Pt, { amp = 0.4, ...style }: Style & { amp?: number } = {}) {
    this.paint(roughLine(a, b, { seed: this.seed++, boil: this.boil, amp }), undefined, style);
  }
  /** Flat fill with no outline, for squares that tile without seams. */
  flat(x: number, y: number, w: number, h: number, fill: string, alpha = 1) {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(x, y, w, h);
    this.ctx.globalAlpha = 1;
  }
  text(
    value: string,
    x: number,
    y: number,
    size: number,
    fill: string,
    align: CanvasTextAlign = "center",
  ) {
    const { ctx } = this;
    ctx.font = `800 ${size}px ${this.font}`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = fill;
    ctx.fillText(value, x, y);
  }
  /** Dark screen with the diagram's dot grid. */
  screen(C: Inks) {
    this.flat(0, 0, W, H, C.g900);
    this.ctx.fillStyle = C.g800;

    for (let y = 3; y < H; y += 6)
      for (let x = 3; x < W; x += 6) {
        this.ctx.beginPath();
        this.ctx.arc(x, y, 0.35, 0, Math.PI * 2);
        this.ctx.fill();
      }
  }
}

const rand = (n: number) => Math.floor(Math.random() * n);

const shuffle = <T,>(items: T[]) => {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = rand(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }

  return items;
};

function connect4(C: Inks): Demo {
  const COLS = 7,
    ROWS = 6,
    S = 10,
    X = (W - COLS * S) / 2,
    Y = 14,
    R = 3.6;

  let board: number[][] = [],
    turn = 1,
    next = 0,
    falling: { c: number; p: number; y: number; v: number } | null = null,
    win: [number, number][] | null = null,
    winAt = 0;

  const reset = () => {
    board = Array.from({ length: COLS }, () => []);
    turn = 1;
    win = null;
  };

  reset();
  const at = (c: number, r: number) => board[c]?.[r] ?? 0;
  const xOf = (c: number) => X + c * S + S / 2;
  const yOf = (r: number) => Y + (ROWS - 1 - r) * S + S / 2;

  const findWin = (c: number, r: number) => {
    const p = at(c, r);

    for (const [dc, dr] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ] as const) {
      const line: [number, number][] = [[c, r]];

      for (const s of [1, -1])
        for (let k = 1; at(c + dc * k * s, r + dr * k * s) === p; k += 1)
          line.push([c + dc * k * s, r + dr * k * s]);

      if (line.length >= 4) return line.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    }

    return null;
  };

  const drop = (c: number) => {
    if (falling || win || c < 0 || c >= COLS || board[c]!.length >= ROWS) return false;
    falling = { c, p: turn, y: Y - 7, v: 0 };

    return true;
  };

  const disc = (p: number) => (p === 1 ? C["c4-red"] : C["c4-yellow"]);

  return {
    draw(g, t, dt, p) {
      if (falling) {
        const f = falling,
          target = yOf(board[f.c]!.length);

        f.v += dt * 320;
        f.y += f.v * dt;

        if (f.y >= target) {
          board[f.c]!.push(f.p);
          win = findWin(f.c, board[f.c]!.length - 1);
          winAt = t;
          turn = 3 - turn;
          falling = null;
          next = t + 0.55;
        }
      } else if (win) {
        if (t > winAt + 1.8) reset();
      } else if (board.every((col) => col.length >= ROWS)) reset();
      else if (t > next) {
        const open = board.map((col, c) => (col.length < ROWS ? c : -1)).filter((c) => c >= 0);
        drop(
          open
            .sort(() => Math.random() - 0.5)
            .sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3) + (Math.random() - 0.5) * 4)[0]!,
        );
      }

      g.screen(C);
      const hover = p.inside && !win ? Math.floor((p.x - X) / S) : -1;
      g.rect(X - 3, Y - 3, COLS * S + 6, ROWS * S + 6, C["c4-frame-light"], { r: 3 });

      for (let c = 0; c < COLS; c += 1)
        for (let r = 0; r < ROWS; r += 1) {
          const v = at(c, r),
            lit = win?.some(([wc, wr]) => wc === c && wr === r) && Math.floor(t * 6) % 2 === 0;

          g.circle(
            xOf(c),
            yOf(r),
            R,
            R,
            lit ? C.sun : v ? disc(v) : c === hover ? tint(C.sun, 0.65) : C.card,
            { lw: v ? LINE : 0.6 },
          );
        }

      if (falling) g.circle(xOf(falling.c), falling.y, R, R, disc(falling.p));

      if (hover >= 0 && hover < COLS && !falling)
        g.circle(xOf(hover), Y - 7, R, R, disc(turn), { alpha: 0.7 });

      if (win) {
        const [a, b] = [win[0]!, win[win.length - 1]!],
          k = Math.min(1, (t - winAt) / 0.4);

        const from: Pt = [xOf(a[0]), yOf(a[1])],
          to: Pt = [xOf(b[0]), yOf(b[1])];

        g.line(from, [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k], {
          lw: 2.2,
        });
      }
    },
    click(x, _y, t) {
      if (drop(Math.floor((x - X) / S))) next = t + 1.4;
    },
  };
}

function reversi(C: Inks): Demo {
  const N = 8,
    S = 8,
    X = (W - N * S) / 2,
    Y = (H - N * S) / 2;

  const cells = Array.from({ length: N * N }, () => {
    const c = Math.random() < 0.78 ? 1 + rand(2) : 0;

    return { c, from: c, at: -9 };
  });

  let next = 0.6;

  const wave = (cx: number, cy: number, t: number) =>
    cells.forEach((cell, i) => {
      const d = Math.hypot((i % N) - cx, Math.floor(i / N) - cy);

      if (!cell.c || d > 2.6) return;
      cell.from = cell.c;
      cell.c = 3 - cell.c;
      cell.at = t + d * 0.08;
    });

  return {
    draw(g, t, _dt, p) {
      if (t > next) {
        wave(rand(N), rand(N), t);
        next = t + 1.2;
      }

      g.screen(C);
      g.rect(X - 2, Y - 2, N * S + 4, N * S + 4, tint(C["reversi-felt"], 0.25), { r: 3 });

      const hx = Math.floor((p.x - X) / S),
        hy = Math.floor((p.y - Y) / S);

      if (p.inside && hx >= 0 && hy >= 0 && hx < N && hy < N)
        g.flat(X + hx * S, Y + hy * S, S, S, C.sun, 0.55);

      for (let i = 1; i < N; i += 1) {
        g.line([X + i * S, Y], [X + i * S, Y + N * S], { lw: THIN, alpha: 0.45, amp: 0.3 });
        g.line([X, Y + i * S], [X + N * S, Y + i * S], { lw: THIN, alpha: 0.45, amp: 0.3 });
      }

      cells.forEach((cell, i) => {
        const age = (t - cell.at) / 0.3;
        const shown = age < 0.5 ? cell.from : cell.c;

        if (!shown) return;
        const squeeze = age >= 0 && age < 1 ? Math.max(0.12, Math.abs(Math.cos(age * Math.PI))) : 1;
        g.circle(
          X + (i % N) * S + S / 2,
          Y + Math.floor(i / N) * S + S / 2,
          2.9 * squeeze,
          2.9,
          shown === 1 ? C["disc-black"] : C["disc-white"],
          { lw: 0.6 },
        );
      });
    },
    click(x, y, t) {
      wave(Math.floor((x - X) / S), Math.floor((y - Y) / S), t);
      next = t + 1.8;
    },
  };
}

/** Your own sea, with the real polyomino fleet, under incoming fire that hunts around each hit. */
function battleship(C: Inks): Demo {
  const N = 10,
    S = 7,
    X = 24,
    Y = 5,
    B = N * S;

  type Ship = { cells: [number, number][]; sunk: number };

  type Shot = { r: number; c: number; hit: boolean; at: number };

  let ships: Ship[] = [],
    shots: Shot[] = [],
    next = 0.5,
    over = 0;

  const key = (r: number, c: number) => r * N + c;

  const shipAt = (r: number, c: number) =>
    ships.find((ship) => ship.cells.some(([sr, sc]) => sr === r && sc === c));

  const shot = (r: number, c: number) => shots.find((item) => item.r === r && item.c === c);

  const reset = () => {
    shots = [];
    over = 0;
    ships = [];
    const taken = new Set<number>();

    for (const spec of BATTLESHIP_FLEET)
      for (let attempt = 0; attempt < 200; attempt += 1) {
        let cells = spec.shape.map(({ dr, dc }): [number, number] => [dr, dc]);

        for (let k = rand(4); k > 0; k -= 1) cells = cells.map(([r, c]) => [c, -r]);

        const minR = Math.min(...cells.map(([r]) => r)),
          minC = Math.min(...cells.map(([, c]) => c));

        const h = Math.max(...cells.map(([r]) => r)) - minR + 1,
          w = Math.max(...cells.map(([, c]) => c)) - minC + 1;

        const r0 = rand(N - h + 1),
          c0 = rand(N - w + 1);

        cells = cells.map(([r, c]) => [r - minR + r0, c - minC + c0]);

        // Keep a one-cell lane around every hull so each silhouette reads on its own.
        if (
          cells.some(([r, c]) =>
            [-1, 0, 1].some((dr) => [-1, 0, 1].some((dc) => taken.has(key(r + dr, c + dc)))),
          )
        )
          continue;
        cells.forEach(([r, c]) => taken.add(key(r, c)));
        ships.push({ cells, sunk: -1 });
        break;
      }
  };

  reset();

  const fire = (r: number, c: number, t: number) => {
    if (over || r < 0 || c < 0 || r >= N || c >= N || shot(r, c)) return false;
    const ship = shipAt(r, c);
    shots.push({ r, c, hit: Boolean(ship), at: t });

    if (ship && ship.cells.every(([sr, sc]) => shot(sr, sc))) ship.sunk = t;

    if (ships.every((item) => item.sunk >= 0)) over = t;

    return true;
  };

  const aim = (): [number, number] => {
    const open = shots
      .filter((item) => item.hit && shipAt(item.r, item.c)!.sunk < 0)
      .flatMap((item): [number, number][] => [
        [item.r - 1, item.c],
        [item.r + 1, item.c],
        [item.r, item.c - 1],
        [item.r, item.c + 1],
      ])
      .filter(([r, c]) => r >= 0 && c >= 0 && r < N && c < N && !shot(r, c));

    if (open.length) return open[rand(open.length)]!;
    const free: [number, number][] = [];

    for (let r = 0; r < N; r += 1)
      for (let c = 0; c < N; c += 1) if ((r + c) % 2 === 0 && !shot(r, c)) free.push([r, c]);

    return free[rand(free.length)] ?? [rand(N), rand(N)];
  };

  const sea = tint(C.sea, 0.45),
    hull = tint(C.steel, 0.35);

  return {
    draw(g, t, _dt, p) {
      if (over && t > over + 2.2) reset();

      if (!over && t > next) {
        const [r, c] = aim();
        fire(r, c, t);
        next = t + 0.7;
      }

      g.screen(C);
      g.rect(X - 2, Y - 2, B + 4, B + 4, sea, { r: 3 });

      for (let i = 1; i < N; i += 1) {
        g.line([X + i * S, Y], [X + i * S, Y + B], { lw: THIN, alpha: 0.22, amp: 0.3 });
        g.line([X, Y + i * S], [X + B, Y + i * S], { lw: THIN, alpha: 0.22, amp: 0.3 });
      }

      for (const ship of ships) {
        const own = (r: number, c: number) => ship.cells.some(([sr, sc]) => sr === r && sc === c),
          sunk = ship.sunk >= 0;

        // Outlines sit on the cell edges so inner corners of each polyomino meet cleanly.
        ship.cells.forEach(([r, c]) => g.flat(X + c * S, Y + r * S, S, S, sunk ? C.g400 : hull));
        ship.cells.forEach(([r, c], i) => {
          const x0 = X + c * S,
            x1 = x0 + S,
            y0 = Y + r * S,
            y1 = y0 + S,
            style = { lw: 0.6, amp: 0.25 };

          if (!own(r - 1, c)) g.line([x0, y0], [x1, y0], style);

          if (!own(r + 1, c)) g.line([x0, y1], [x1, y1], style);

          if (!own(r, c - 1)) g.line([x0, y0], [x0, y1], style);

          if (!own(r, c + 1)) g.line([x1, y0], [x1, y1], style);

          if (i === 0)
            g.circle((x0 + x1) / 2, (y0 + y1) / 2, 1.1, 1.1, sunk ? C.g700 : C["steel-light"], {
              lw: 0.45,
            });
        });

        if (sunk && t - ship.sunk < 1) {
          const [r, c] = ship.cells[0]!,
            k = t - ship.sunk;

          g.circle(X + c * S + 3.5, Y + r * S + 3.5, k * 28, k * 28, undefined, {
            stroke: C.sun,
            lw: 1,
            alpha: 1 - k,
          });
        }
      }

      for (const item of shots) {
        const x = X + item.c * S + S / 2,
          y = Y + item.r * S + S / 2,
          age = t - item.at;

        if (age < 0.18) {
          g.rect(x - 3, y - 3, 6, 6, C.sun, { r: 1, lw: 0.5 });
          continue;
        }

        if (item.hit) {
          g.circle(x, y, 2.2, 2.2, C["peg-red"], { lw: 0.55 });
          g.line([x - 1.2, y - 1.2], [x + 1.2, y + 1.2], { lw: 0.55, amp: 0.15 });
          g.line([x + 1.2, y - 1.2], [x - 1.2, y + 1.2], { lw: 0.55, amp: 0.15 });
        } else {
          g.circle(x, y, 1.3, 1.3, C["peg-white"], { lw: 0.45 });

          if (age < 0.9)
            g.circle(x, y, 2 + age * 8, 2 + age * 8, undefined, {
              stroke: C.white,
              lw: 0.5,
              alpha: 1 - age / 0.9,
            });
        }
      }

      // Fleet tray on the left: one bar per ship, struck through once sunk.
      ships.forEach((ship, i) => {
        const len = ship.cells.length * 2 + 2,
          x = X - 6 - len,
          y = Y + 6 + i * 10,
          sunk = ship.sunk >= 0;

        g.rect(x, y, len, 4.5, sunk ? C["peg-red"] : hull, { r: 2, lw: 0.55, amp: 0.2 });

        if (sunk) g.line([x - 1, y + 2.25], [x + len + 1, y + 2.25], { lw: 0.7 });
      });

      // Radar scope on the right.
      const rx = X + B + 13,
        ry = H / 2,
        a = t * 2;

      g.circle(rx, ry, 9, 9, tint(C.aqua, 0.55), { amp: 0.3 });
      g.circle(rx, ry, 5, 5, undefined, { lw: THIN, alpha: 0.35 });
      g.line([rx, ry], [rx + Math.cos(a) * 8.4, ry + Math.sin(a) * 8.4], { lw: 0.7, amp: 0.2 });
      const last = shots[shots.length - 1];

      if (last && t - last.at < 1.2)
        g.circle(
          rx + (last.c - 4.5) * 1.5,
          ry + (last.r - 4.5) * 1.5,
          1,
          1,
          last.hit ? C["peg-red"] : C.white,
          { lw: 0.4 },
        );

      if (p.inside) {
        const c = Math.floor((p.x - X) / S),
          r = Math.floor((p.y - Y) / S);

        if (c >= 0 && r >= 0 && c < N && r < N) {
          g.line([X, Y + r * S + S / 2], [X + B, Y + r * S + S / 2], {
            stroke: C.sun,
            lw: THIN,
            alpha: 0.6,
          });
          g.line([X + c * S + S / 2, Y], [X + c * S + S / 2, Y + B], {
            stroke: C.sun,
            lw: THIN,
            alpha: 0.6,
          });
          g.rect(X + c * S, Y + r * S, S, S, undefined, { stroke: C.sun, r: 1, lw: 0.8 });
        }
      }
    },
    click(x, y, t) {
      if (fire(Math.floor((y - Y) / S), Math.floor((x - X) / S), t)) next = t + 1.6;
    },
  };
}

function contexto(C: Inks): Demo {
  type Bar = { score: number; w: number; y: number; born: number };

  let bars: Bar[] = [],
    round = 0,
    next = 0.2,
    won = 0;

  const guess = (t: number) => {
    round += 1;
    const score = Math.min(1, 0.2 + Math.random() * 0.55 + round * 0.035);
    bars.push({ score, w: 0, y: H, born: t });
    bars.sort((a, b) => b.score - a.score);
    bars = bars.slice(0, 7);

    if (score >= 0.985) won = t;
  };

  const ink = (s: number) =>
    s >= 0.985
      ? C.sun
      : s > 0.8
        ? C["rank-hot"]
        : s > 0.6
          ? C["rank-warm"]
          : s > 0.4
            ? C["rank-cool"]
            : C["rank-cold"];

  return {
    draw(g, t, dt, p) {
      if (won && t > won + 1.8) {
        bars = [];
        round = 0;
        won = 0;
      }

      if (!won && t > next) {
        guess(t);
        next = t + 1.1;
      }

      g.screen(C);
      bars.forEach((bar, i) => {
        bar.w += (bar.score * 88 - bar.w) * Math.min(1, dt * 6);
        bar.y += (6 + i * 10 - bar.y) * Math.min(1, dt * 8);

        const y = bar.y,
          c = ink(bar.score),
          hot = p.inside && p.y >= y && p.y < y + 8;

        g.rect(6, y, 14, 8, hot ? C.sun : C.card, { r: 2, lw: 0.6 });
        g.line([9, y + 4], [17, y + 4], { lw: 0.7, alpha: 0.7, amp: 0.5 });
        g.rect(23, y, Math.max(3, bar.w), 8, c, { r: 3, lw: 0.6 });

        if (hot)
          g.rect(21.5, y - 1.5, Math.max(3, bar.w) + 3, 11, undefined, {
            stroke: C.sun,
            r: 4,
            lw: 0.7,
          });

        if (t - bar.born < 0.5) {
          const k = (t - bar.born) * 2;
          g.circle(23 + bar.w, y + 4, k * 12, k * 12, undefined, {
            stroke: c,
            lw: 0.6,
            alpha: 1 - k,
          });
        }
      });

      if (won)
        for (let k = 0; k < 4; k += 1) {
          const r = ((t - won) * 50 + k * 14) % 70;
          g.circle(64, 40, r, r, undefined, { stroke: C.sun, lw: 0.8, alpha: 0.6 });
        }
    },
    click(_x, _y, t) {
      if (!won) {
        guess(t);
        next = t + 1.6;
      }
    },
  };
}

const SUITS = ["♥", "♦", "♠", "♣"] as const;

const RANKS = ["A", "K", "Q", "J", "10", "9", "7"] as const;

function poker(C: Inks): Demo {
  let dealt = 0,
    hand: { suit: (typeof SUITS)[number]; rank: string }[] = [];

  const deal = (t: number) => {
    dealt = t;
    hand = Array.from({ length: 5 }, () => ({
      suit: SUITS[rand(4)]!,
      rank: RANKS[rand(RANKS.length)]!,
    }));
  };

  deal(0);

  return {
    draw(g, t, _dt, p) {
      if (t > dealt + 5) deal(t);
      g.screen(C);
      g.circle(60, 43, 56, 32, tint(C.rail, 0.2), { amp: 0.5 });
      g.circle(60, 43, 49, 26, tint(C.baize, 0.2), { amp: 0.5, lw: 0.6 });

      for (let i = 0; i < 5; i += 1) {
        const age = (t - dealt - 0.3 - i * 0.28) / 0.3;

        const x = 24 + i * 15,
          hover = p.inside && p.x >= x && p.x < x + 12 && p.y >= 28 && p.y < 46,
          y = 29 - (hover ? 3 : 0);

        const squeeze =
            age < 0 ? 1 : age < 1 ? Math.max(0.1, Math.abs(Math.cos(age * Math.PI))) : 1,
          face = age >= 0.5;

        const w = 12 * squeeze,
          x0 = x + (12 - w) / 2;

        if (!face) {
          g.rect(x0, y, w, 17, C["card-back"], { r: 2, lw: 0.6 });

          if (w > 5)
            g.rect(x0 + 2, y + 2, w - 4, 13, undefined, { stroke: C.card, r: 1.5, lw: 0.45 });
          continue;
        }

        const card = hand[i]!,
          red = card.suit === "♥" || card.suit === "♦",
          ink = red ? C["card-red"] : C["card-black"];

        g.rect(x0, y, w, 17, C.card, { r: 2, lw: 0.6 });

        if (squeeze > 0.7) {
          g.text(card.suit, x + 6, y + 10, 8, ink);
          g.text(card.rank, x + 1.8, y + 3.4, 3.6, ink, "left");
        }
      }

      for (const [sx, n, chip] of [
        [18, 5 + Math.floor(Math.sin(t) * 2 + 2), C["chip-red"]],
        [102, 4 + Math.floor(Math.cos(t * 0.8) * 2 + 2), C["chip-blue"]],
      ] as const)
        for (let k = 0; k < n; k += 1)
          g.circle(sx, 68 - k * 2, 5, 2, k === n - 1 ? tint(chip, 0.45) : chip, {
            lw: 0.5,
            amp: 0.15,
          });
    },
    click(_x, _y, t) {
      deal(t);
    },
  };
}

function checkers(C: Inks): Demo {
  const N = 8,
    S = 8,
    X = (W - N * S) / 2,
    Y = (H - N * S) / 2;

  type Piece = {
    r: number;
    c: number;
    side: 1 | 2;
    fr: number;
    fc: number;
    at: number;
    king: boolean;
  };

  let pieces: Piece[] = [],
    ghosts: { r: number; c: number; side: 1 | 2; at: number }[] = [],
    next = 0.5;

  const reset = () => {
    pieces = [];

    for (let r = 0; r < N; r += 1)
      for (let c = 0; c < N; c += 1)
        if ((r + c) % 2 === 1 && (r < 3 || r > 4) && Math.random() < 0.8)
          pieces.push({ r, c, side: r < 3 ? 1 : 2, fr: r, fc: c, at: -9, king: false });
  };

  reset();
  const occupant = (r: number, c: number) => pieces.find((p) => p.r === r && p.c === c);

  const hop = (piece: Piece, t: number) => {
    const options: { r: number; c: number; jump?: Piece }[] = [];

    for (const dr of [-1, 1])
      for (const dc of [-1, 1]) {
        const r = piece.r + dr,
          c = piece.c + dc,
          r2 = piece.r + dr * 2,
          c2 = piece.c + dc * 2;

        const mid = occupant(r, c);

        if (
          mid &&
          mid.side !== piece.side &&
          r2 >= 0 &&
          r2 < N &&
          c2 >= 0 &&
          c2 < N &&
          !occupant(r2, c2)
        )
          options.push({ r: r2, c: c2, jump: mid });
        else if (!mid && r >= 0 && r < N && c >= 0 && c < N) options.push({ r, c });
      }

    const pick = options.find((o) => o.jump) ?? options[rand(options.length)];

    if (!pick) return false;
    piece.fr = piece.r;
    piece.fc = piece.c;
    piece.r = pick.r;
    piece.c = pick.c;
    piece.at = t;

    if (pick.r === 0 || pick.r === N - 1) piece.king = true;

    if (pick.jump) {
      pieces = pieces.filter((p) => p !== pick.jump);
      ghosts.push({ ...pick.jump, at: t + 0.2 });
    }

    return true;
  };

  const light = tint(C.maple, 0.2),
    dark = tint(C.walnut, 0.15);

  const piece = (g: Sketch, x: number, y: number, side: 1 | 2, alpha = 1) => {
    g.circle(x, y, 3.1, 3.1, side === 1 ? C.ebony : C.ivory, { lw: 0.6, alpha });
    g.circle(x, y, 1.7, 1.7, undefined, { stroke: side === 1 ? C.g700 : C.g400, lw: 0.4, alpha });
  };

  return {
    draw(g, t, _dt, p) {
      if (t > next) {
        for (let k = 0; k < 6 && !hop(pieces[rand(pieces.length)]!, t); k += 1);
        next = t + 0.75;

        if (pieces.length < 7) reset();
      }

      g.screen(C);
      g.rect(X - 3, Y - 3, N * S + 6, N * S + 6, C["walnut-deep"], { r: 3 });

      for (let r = 0; r < N; r += 1)
        for (let c = 0; c < N; c += 1)
          g.flat(X + c * S, Y + r * S, S, S, (r + c) % 2 ? dark : light);
      g.rect(X, Y, N * S, N * S, undefined, { r: 0.5, lw: 0.6, amp: 0.25 });

      const hr = Math.floor((p.y - Y) / S),
        hc = Math.floor((p.x - X) / S);

      if (p.inside && occupant(hr, hc))
        g.rect(X + hc * S, Y + hr * S, S, S, undefined, { stroke: C.sun, r: 1, lw: 0.8 });
      ghosts = ghosts.filter((gh) => t - gh.at < 0.6);

      for (const gh of ghosts)
        piece(
          g,
          X + gh.c * S + S / 2,
          Y + gh.r * S + S / 2,
          gh.side,
          1 - Math.max(0, t - gh.at) / 0.6,
        );

      for (const item of pieces) {
        const k = Math.min(1, Math.max(0, (t - item.at) / 0.35));

        const x = X + (item.fc + (item.c - item.fc) * k) * S + S / 2,
          y = Y + (item.fr + (item.r - item.fr) * k) * S + S / 2,
          lift = Math.sin(k * Math.PI) * 5;

        if (lift > 0.5) g.circle(x + 1, y + 1, 3, 3, g.ink, { stroke: false, alpha: 0.3 });
        piece(g, x, y - lift, item.side);

        if (item.king) g.circle(x, y - lift, 1.1, 1.1, C.crown, { lw: 0.4 });
      }
    },
    click(x, y, t) {
      const r = Math.floor((y - Y) / S),
        c = Math.floor((x - X) / S);

      const item =
        occupant(r, c) ??
        pieces
          .slice()
          .sort((a, b) => Math.hypot(a.r - r, a.c - c) - Math.hypot(b.r - r, b.c - c))[0];

      if (item && hop(item, t)) next = t + 1.2;
    },
  };
}

function codenames(C: Inks): Demo {
  const TW = 20,
    TH = 12.6,
    GAP = 2,
    X = (W - 5 * TW - 4 * GAP) / 2,
    Y = (H - 5 * TH - 4 * GAP) / 2;

  let key: number[] = [],
    shown: number[] = [],
    words: number[] = [],
    next = 0.4,
    done = 0;

  const reset = () => {
    key = shuffle([...Array(9).fill(1), ...Array(8).fill(2), ...Array(7).fill(3), 4]);
    shown = Array(25).fill(-1);
    words = Array.from({ length: 25 }, () => 7 + rand(7));
    done = 0;
  };

  reset();

  const reveal = (i: number, t: number) => {
    if (i >= 0 && i < 25 && shown[i]! < 0) shown[i] = t;
  };

  const team = (k: number) =>
    k === 1 ? C["cn-red"] : k === 2 ? C["cn-blue"] : k === 3 ? C["cn-bystander"] : C["cn-assassin"];

  return {
    draw(g, t, _dt, p) {
      const count = shown.filter((s) => s >= 0).length;

      if (!done && count >= 15) done = t;

      if (done && t > done + 1.6) reset();

      if (!done && t > next) {
        const hidden = shown.map((s, i) => (s < 0 ? i : -1)).filter((i) => i >= 0);
        reveal(hidden[rand(hidden.length)]!, t);
        next = t + 0.55;
      }

      g.screen(C);

      for (let i = 0; i < 25; i += 1) {
        const x = X + (i % 5) * (TW + GAP),
          row = Y + Math.floor(i / 5) * (TH + GAP);

        const hover = p.inside && p.x >= x && p.x < x + TW && p.y >= row && p.y < row + TH,
          y = row - (hover && shown[i]! < 0 ? 1 : 0);

        const age = shown[i]! < 0 ? -1 : (t - shown[i]!) / 0.45,
          k = Math.min(1, Math.max(0, age * 1.7));

        g.rect(x, y, TW, TH, C["cn-card"], { r: 2, lw: 0.6 });

        if (k > 0) g.rect(x, y, TW, TH, team(key[i]!), { r: 2, lw: 0.6, alpha: k });
        g.line([x + (TW - words[i]!) / 2, y + TH / 2], [x + (TW + words[i]!) / 2, y + TH / 2], {
          lw: 0.9,
          amp: 0.3,
          stroke: key[i] === 4 && k > 0.5 ? C.white : g.ink,
          alpha: 0.75,
        });

        if (key[i] === 4 && age > 1) {
          const r = ((age - 1) * 14) % 30;
          g.circle(x + TW / 2, y + TH / 2, r, r, undefined, {
            stroke: C.tomato,
            lw: 0.7,
            alpha: 0.6,
          });
        }

        if (hover)
          g.rect(x - 1, y - 1, TW + 2, TH + 2, undefined, { stroke: C.sun, r: 2.5, lw: 0.8 });
      }
    },
    click(x, y, t) {
      reveal(Math.floor((x - X) / (TW + GAP)) + Math.floor((y - Y) / (TH + GAP)) * 5, t);
      next = t + 1.2;
    },
  };
}

function pokemon(C: Inks): Demo {
  const mons = [
    { x: 34, y: 53, r: 8, hp: 1, flash: -9 },
    { x: 88, y: 27, r: 6.5, hp: 1, flash: -9 },
  ];

  let shot: { from: number; at: number; ink: string } | null = null,
    turn = 0,
    next = 0.8,
    faint = -1,
    faintAt = 0;

  const attack = (from: number, t: number) => {
    if (shot || faint >= 0) return false;
    shot = { from, at: t, ink: from === 0 ? C["type-electric"] : C["type-fire"] };

    return true;
  };

  const ball = (g: Sketch, cx: number, cy: number, r: number, alpha: number, flash: boolean) => {
    const { ctx } = g;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    g.flat(cx - r, cy - r, r * 2, r * 2, C.white, alpha);
    g.flat(cx - r, cy - r, r * 2, r * 0.9, C["c4-red"], alpha);
    ctx.restore();
    g.line([cx - r, cy - r * 0.1], [cx + r, cy - r * 0.1], { lw: 0.7, alpha, amp: 0.2 });
    g.circle(cx, cy, r, r, flash ? C.white : undefined, { alpha: flash ? alpha * 0.7 : alpha });
    g.circle(cx, cy - r * 0.1, r * 0.3, r * 0.3, C.white, { lw: 0.6, alpha });
  };

  return {
    draw(g, t, _dt, p) {
      if (faint >= 0 && t > faintAt + 1.8) {
        mons.forEach((m) => {
          m.hp = 1;
        });
        faint = -1;
      }

      if (!shot && faint < 0 && t > next) {
        attack(turn, t);
        turn = 1 - turn;
      }

      g.flat(0, 0, W, 50, tint(C["pk-sky"], 0.2));
      g.flat(0, 50, W, 30, tint(C["pk-grass"], 0.15));
      g.line([-2, 50], [W + 2, 50], { lw: 0.6, amp: 0.6 });

      for (const [x, y, rx] of [
        [34, 61, 21],
        [88, 34, 17],
      ] as const)
        g.circle(x, y, rx, 4, C["pk-grass-deep"], { amp: 0.4 });
      mons.forEach((m, i) => {
        const hit = t - m.flash < 0.4,
          wob = shot ? 0 : Math.sin(t * 3 + i) * 0.8,
          sink = faint === i ? Math.min(1, (t - faintAt) / 0.8) : 0;

        ball(g, m.x + (hit ? Math.sin(t * 60) * 1.5 : 0), m.y + wob + sink * 6, m.r, 1 - sink, hit);

        const bx = i === 0 ? 70 : 6,
          by = i === 0 ? 67 : 5;

        g.rect(bx, by, 44, 7, C.card, { r: 3, lw: 0.6 });
        g.rect(
          bx + 1.5,
          by + 1.6,
          Math.max(0.1, 41 * m.hp),
          3.8,
          m.hp > 0.5 ? C["hp-high"] : m.hp > 0.2 ? C["hp-mid"] : C["hp-low"],
          { r: 1.9, lw: 0.45, amp: 0.15 },
        );
      });

      if (shot) {
        const k = (t - shot.at) / 0.5,
          a = mons[shot.from]!,
          b = mons[1 - shot.from]!;

        for (let s = 5; s >= 0; s -= 1) {
          const q = Math.max(0, k - s * 0.05),
            arc = Math.sin(q * Math.PI) * 10,
            r = 2.8 - s * 0.4;

          g.circle(a.x + (b.x - a.x) * q, a.y + (b.y - a.y) * q - arc, r, r, shot.ink, {
            lw: 0.5,
            alpha: 1 - s * 0.16,
          });
        }

        if (k >= 1) {
          b.hp = Math.max(0, b.hp - (0.22 + Math.random() * 0.2));
          b.flash = t;
          shot = null;
          next = t + 1;

          if (b.hp <= 0) {
            faint = mons.indexOf(b);
            faintAt = t;
          }
        }
      }

      if (p.inside) {
        const r = 3 + Math.sin(t * 8) * 0.6;
        g.circle(p.x, p.y, r, r, undefined, { lw: 0.6, alpha: 0.8 });
      }
    },
    click(_x, _y, t) {
      if (attack(0, t)) {
        turn = 1;
        next = t + 1.4;
      }
    },
  };
}

const DEMOS = {
  connect4,
  reversi,
  battleship,
  contexto,
  poker,
  checkers,
  codenames,
  pokemon,
} satisfies Record<string, (c: Inks) => Demo>;

export const ARCADE_GAMES = Object.keys(DEMOS);

/** The playable screen. `game` picks the scene; `onPlay` fires on the first click so the host can stop auto-advancing. */
export function SketchArcade({
  game,
  onPlay,
  className,
}: {
  game: string;
  onPlay?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const play = useRef(onPlay);
  useEffect(() => {
    play.current = onPlay;
  }, [onPlay]);

  useEffect(() => {
    const canvas = ref.current,
      ctx = canvas?.getContext("2d");

    const make = knownValue(DEMOS, game);

    if (!canvas || !ctx || !make) return;
    const inks = readInks(canvas);
    const sketch = new Sketch(ctx, inks.ink, getComputedStyle(canvas).fontFamily || "sans-serif");
    const demo = make(inks);
    const pointer: Pointer = { x: 0, y: 0, inside: false };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const start = performance.now();

    let frame = 0,
      last = start,
      visible = true;

    const clock = (now: number) => (reduced.matches ? 2.4 : (now - start) / 1000);

    const paint = (t: number, dt: number) => {
      sketch.begin(reduced.matches ? 0 : Math.floor(t * BOIL_HZ));
      demo.draw(sketch, t, dt, pointer);
    };

    const render = (now: number) => {
      paint(clock(now), Math.min(0.05, (now - last) / 1000));
      last = now;
    };

    const fit = () => {
      const box = canvas.getBoundingClientRect(),
        dpr = Math.min(2, window.devicePixelRatio || 1);

      const w = Math.max(W, Math.round(box.width * dpr)),
        h = Math.max(H, Math.round(box.height * dpr));

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        render(performance.now());
      }
    };

    const loop = (now: number) => {
      frame = 0;

      if (!visible || document.hidden) return;

      if (now - last >= FRAME_MS) render(now);

      if (!reduced.matches) frame = requestAnimationFrame(loop);
    };

    const wake = () => {
      if (!frame && visible && !document.hidden) frame = requestAnimationFrame(loop);
    };

    const local = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();

      return {
        x: ((event.clientX - box.left) / box.width) * W,
        y: ((event.clientY - box.top) / box.height) * H,
      };
    };

    const move = (event: PointerEvent) => {
      Object.assign(pointer, local(event), { inside: true });

      if (reduced.matches) render(performance.now());
    };

    const leave = () => {
      pointer.inside = false;

      if (reduced.matches) render(performance.now());
    };

    const down = (event: PointerEvent) => {
      const at = local(event);
      Object.assign(pointer, at, { inside: event.pointerType === "mouse" });
      demo.click?.(at.x, at.y, clock(performance.now()));
      play.current?.();

      if (reduced.matches) for (let k = 0; k <= 24; k += 1) paint(2.4 + k * 0.05, 0.05);
    };

    const seen = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      wake();
    });

    const resize = new ResizeObserver(fit);
    const page = () => wake();
    fit();
    render(start);
    seen.observe(canvas);
    resize.observe(canvas);
    canvas.addEventListener("pointermove", move, { passive: true });
    canvas.addEventListener("pointerleave", leave, { passive: true });
    canvas.addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("visibilitychange", page);
    reduced.addEventListener("change", page);
    wake();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      seen.disconnect();
      resize.disconnect();
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointerdown", down);
      document.removeEventListener("visibilitychange", page);
      reduced.removeEventListener("change", page);
    };
  }, [game]);

  return (
    <canvas
      ref={ref}
      className={className}
      width={W}
      height={H}
      data-dither-touch="off"
      aria-hidden="true"
    />
  );
}
