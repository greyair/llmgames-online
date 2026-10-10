// Hand-drawn SVG paths, ported from the launch video (videos/launch-2026/src/lib.js).
// Every shape is seeded, so server and client render identical markup. `boil`
// re-seeds the wobble a few times a second to keep lines alive while animating.
export type Pt = [number, number];

type Rough = { seed: number; boil?: number; amp?: number };

export const f = (n: number) => (Math.round(n * 10) / 10).toString();

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const ease = {
  outCubic: (x: number) => 1 - (1 - x) ** 3,
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  outBack: (x: number, s = 1.70158) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2,
};

/** Eased 0→1 progress of t across [a, b]. */
export const tw = (t: number, a: number, b: number, e = ease.outCubic) =>
  e(clamp((t - a) / (b - a)));

/** Damped spring response to a step at time 0, t in seconds. */
export function spring(t: number, freq = 2.6, damp = 0.42) {
  if (t <= 0) return 0;

  const w = 2 * Math.PI * freq,
    wd = w * Math.sqrt(1 - damp * damp);

  return 1 - Math.exp(-damp * w * t) * (Math.cos(wd * t) + ((damp * w) / wd) * Math.sin(wd * t));
}

function rng(seed: number) {
  let a = seed >>> 0 || 1;

  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(...n: number[]) {
  let h = 2166136261;

  for (const v of n) {
    h ^= Math.floor(v * 997) | 0;
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

const R = (seed: number, boil = 0) => rng(hash(seed, boil));

export function spline(pts: readonly Pt[], closed = false) {
  const n = pts.length;
  const get = (i: number) => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)]!;
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;

  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = get(i - 1),
      p1 = get(i),
      p2 = get(i + 1),
      p3 = get(i + 2);

    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)},${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)},${f(p2[0])} ${f(p2[1])}`;
  }

  return closed ? d + "Z" : d;
}

export function roughRect(
  x: number,
  y: number,
  w: number,
  h: number,
  { seed, boil, amp = 1.5, r = 10 }: Rough & { r?: number },
) {
  const q = R(seed, boil),
    j = () => (q() - 0.5) * 2 * amp;

  r = Math.min(r, w / 3, h / 3);

  const X = x + w,
    Y = y + h;

  return (
    `M${f(x + r + j())} ${f(y + j())}` +
    `C${f(x + w * 0.33)} ${f(y + j())},${f(x + w * 0.66)} ${f(y + j())},${f(X - r + j())} ${f(y + j())}` +
    `Q${f(X + j() * 0.4)} ${f(y + j() * 0.4)},${f(X + j())} ${f(y + r + j())}` +
    `C${f(X + j())} ${f(y + h * 0.33)},${f(X + j())} ${f(y + h * 0.66)},${f(X + j())} ${f(Y - r + j())}` +
    `Q${f(X + j() * 0.4)} ${f(Y + j() * 0.4)},${f(X - r + j())} ${f(Y + j())}` +
    `C${f(x + w * 0.66)} ${f(Y + j())},${f(x + w * 0.33)} ${f(Y + j())},${f(x + r + j())} ${f(Y + j())}` +
    `Q${f(x + j() * 0.4)} ${f(Y + j() * 0.4)},${f(x + j())} ${f(Y - r + j())}` +
    `C${f(x + j())} ${f(y + h * 0.66)},${f(x + j())} ${f(y + h * 0.33)},${f(x + j())} ${f(y + r + j())}` +
    `Q${f(x + j() * 0.4)} ${f(y + j() * 0.4)},${f(x + r + j())} ${f(y + j())}Z`
  );
}

export function roughEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  { seed, boil, amp = 1, n = 9 }: Rough & { n?: number },
) {
  const q = R(seed, boil),
    pts: Pt[] = [];

  const off = q() * Math.PI * 2;

  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2,
      k = 1 + ((q() - 0.5) * 2 * amp) / Math.max(rx, ry);

    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }

  return spline(pts, true);
}

export function roughLine(a: Pt, b: Pt, { seed, boil, amp = 2 }: Rough) {
  const q = R(seed, boil),
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    len = Math.hypot(dx, dy) || 1;

  const nx = -dy / len,
    ny = dx / len,
    k = (q() - 0.5) * 2 * amp,
    k2 = (q() - 0.5) * amp;

  return `M${f(a[0] + (q() - 0.5) * amp)} ${f(a[1] + (q() - 0.5) * amp)}C${f(a[0] + dx * 0.33 + nx * k)} ${f(a[1] + dy * 0.33 + ny * k)},${f(a[0] + dx * 0.66 + nx * k2)} ${f(a[1] + dy * 0.66 + ny * k2)},${f(b[0] + (q() - 0.5) * amp)} ${f(b[1] + (q() - 0.5) * amp)}`;
}

/** Point on the quadratic curve a → b bent through control c. */
export const quad = (a: Pt, c: Pt, b: Pt, t: number): Pt => [
  (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
  (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
];

/** Unit tangent of the same curve. */
export function quadTangent(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const x = 2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]),
    y = 2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1]),
    l = Math.hypot(x, y) || 1;

  return [x / l, y / l];
}

/** A wobbly hand-drawn quadratic curve. Endpoints stay put so arrows meet their cards. */
export function roughCurve(
  a: Pt,
  c: Pt,
  b: Pt,
  { seed, boil, amp = 2, n = 6 }: Rough & { n?: number },
) {
  const q = R(seed, boil),
    pts: Pt[] = [];

  for (let i = 0; i <= n; i++) {
    const t = i / n,
      [x, y] = quad(a, c, b, t),
      [tx, ty] = quadTangent(a, c, b, t),
      k = i === 0 || i === n ? 0 : (q() - 0.5) * 2 * amp;

    pts.push([x - ty * k, y + tx * k]);
  }

  return spline(pts);
}
