import { useEffect, useRef } from "react";

/* Pastel ordered-dither lights behind the landing hero. Three soft blobs
   drift slowly; the pointer carries a bloom in the ink of the game the
   headline is showing, and a press sends a ring of dots outward. */

const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

export type DitherBlob = {
  ink: string;
  x: number;
  y: number;
  r: number;
  dx: number;
  dy: number;
  speed: number;
  peak: number;
};

const HERO_BLOBS: readonly DitherBlob[] = [
  { ink: "--palette-sky", x: 0.88, y: 0.1, r: 0.4, dx: 0.06, dy: 0.05, speed: 0.00011, peak: 0.6 },
  {
    ink: "--palette-tangerine",
    x: 0.96,
    y: 0.98,
    r: 0.44,
    dx: 0.05,
    dy: 0.04,
    speed: 0.00008,
    peak: 0.62,
  },
  {
    ink: "--palette-pink",
    x: 0.76,
    y: 1.08,
    r: 0.26,
    dx: 0.07,
    dy: 0.03,
    speed: 0.00013,
    peak: 0.45,
  },
];

const RIPPLE_MS = 900;

const FRAME_MS = 33;

/** Drifting pastel halftone lights for a hero panel. Blob inks are CSS custom
    property names; the canvas fills its positioned parent. */
export function HeroDither({
  blobs = HERO_BLOBS,
  className = "landing-hero-dither",
}: { blobs?: readonly DitherBlob[]; className?: string } = {}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const BLOBS = blobs;

  useEffect(() => {
    const canvas = ref.current;
    const hero = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");

    if (!canvas || !hero || !ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const root = getComputedStyle(document.documentElement);
    const inks = BLOBS.map((blob) => root.getPropertyValue(blob.ink).trim());
    const pointer = { x: 0, y: 0, cx: 0, cy: 0, level: 0, inside: false, ink: inks[0]! };
    const ripples: { x: number; y: number; start: number; ink: string }[] = [];

    let cell = 6,
      cols = 0,
      rows = 0,
      frame = 0,
      last = 0,
      visible = true;

    const resize = () => {
      const px = parseFloat(root.getPropertyValue("--px"));
      cell = (Number.isFinite(px) && px > 0 ? px : 3) * 2;
      const box = hero.getBoundingClientRect();
      cols = Math.max(1, Math.ceil(box.width / cell));
      rows = Math.max(1, Math.ceil(box.height / cell));
      // Each dot is one canvas pixel with a one-pixel gap, a small halftone dot rather than a full cell.
      canvas.width = cols * 2;
      canvas.height = rows * 2;
    };

    const gameInk = () => {
      const active = hero.querySelector<HTMLElement>(".landing-rotator > [data-active=true]");

      return active ? getComputedStyle(active).color : inks[0]!;
    };

    const draw = (now: number) => {
      const w = cols * cell,
        h = rows * cell,
        span = Math.max(w, h);

      pointer.cx += (pointer.x - pointer.cx) * 0.12;
      pointer.cy += (pointer.y - pointer.cy) * 0.12;
      pointer.level += ((pointer.inside ? 1 : 0) - pointer.level) * 0.08;

      while (ripples.length && now - ripples[0]!.start > RIPPLE_MS) ripples.shift();
      const t = reduced.matches ? 0 : now;

      const lights: { x: number; y: number; r: number; peak: number; ink: string }[] = BLOBS.map(
        (blob, i) => ({
          x: (blob.x + Math.sin(t * blob.speed + i * 2.1) * blob.dx) * w,
          y: (blob.y + Math.cos(t * blob.speed * 1.3 + i) * blob.dy) * h,
          r: blob.r * span,
          peak: blob.peak,
          ink: inks[i]!,
        }),
      );

      if (pointer.level > 0.01)
        lights.push({
          x: pointer.cx,
          y: pointer.cy,
          r: Math.min(220, span * 0.22),
          peak: 0.7 * pointer.level,
          ink: pointer.ink,
        });

      const rings = ripples.map((ripple) => {
        const p = (now - ripple.start) / RIPPLE_MS;

        return {
          x: ripple.x,
          y: ripple.y,
          r: span * 0.7 * (1 - (1 - p) ** 3),
          amp: (1 - p) * 0.7,
          ink: ripple.ink,
        };
      });

      ctx.clearRect(0, 0, cols * 2, rows * 2);
      let fill = "";

      for (let row = 0; row < rows; row += 1) {
        const y = (row + 0.5) * cell;

        for (let col = 0; col < cols; col += 1) {
          const x = (col + 0.5) * cell;

          let best = 0,
            ink = "";

          for (const light of lights) {
            const falloff = 1 - Math.hypot(x - light.x, y - light.y) / light.r;

            if (falloff <= 0) continue;
            const tone = light.peak * falloff * falloff;

            if (tone > best) {
              best = tone;
              ink = light.ink;
            }
          }

          for (const ring of rings) {
            const tone =
              ring.amp * (1 - Math.abs(Math.hypot(x - ring.x, y - ring.y) - ring.r) / 28);

            if (tone > best) {
              best = tone;
              ink = ring.ink;
            }
          }

          if (best <= 0 || best <= (BAYER8[(row % 8) * 8 + (col % 8)]! + 0.5) / 64) continue;

          if (ink !== fill) {
            ctx.fillStyle = ink;
            fill = ink;
          }

          ctx.fillRect(col * 2, row * 2, 1, 1);
        }
      }
    };

    const loop = (now: number) => {
      frame = 0;

      if (!visible) return;

      if (now - last >= FRAME_MS) {
        last = now;
        draw(now);
      }

      if (!reduced.matches) frame = requestAnimationFrame(loop);
    };

    const wake = () => {
      if (!frame && visible && !reduced.matches) frame = requestAnimationFrame(loop);
    };

    const local = (event: PointerEvent) => {
      const box = hero.getBoundingClientRect();

      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    const move = (event: PointerEvent) => {
      if (reduced.matches || event.pointerType !== "mouse") return;
      const at = local(event);

      if (!pointer.inside) {
        pointer.cx = at.x;
        pointer.cy = at.y;
        pointer.ink = gameInk();
      }

      pointer.x = at.x;
      pointer.y = at.y;
      pointer.inside = true;
      wake();
    };

    const leave = () => {
      pointer.inside = false;
      wake();
    };

    const down = (event: PointerEvent) => {
      if (reduced.matches) return;
      const at = local(event);
      ripples.push({ ...at, start: performance.now(), ink: gameInk() });
      wake();
    };

    const recolor = () => {
      pointer.ink = gameInk();
    };

    const rotator = new MutationObserver(recolor);
    const words = hero.querySelector(".landing-rotator");

    if (words)
      rotator.observe(words, { subtree: true, attributes: true, attributeFilter: ["data-active"] });

    const sizer = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });

    const seen = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      wake();
    });

    const motion = () => {
      draw(performance.now());
      wake();
    };

    resize();
    draw(performance.now());
    sizer.observe(hero);
    seen.observe(hero);
    hero.addEventListener("pointermove", move, { passive: true });
    hero.addEventListener("pointerleave", leave, { passive: true });
    hero.addEventListener("pointerdown", down, { passive: true });
    reduced.addEventListener("change", motion);
    wake();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      rotator.disconnect();
      sizer.disconnect();
      seen.disconnect();
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", leave);
      hero.removeEventListener("pointerdown", down);
      reduced.removeEventListener("change", motion);
    };
  }, [BLOBS]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
