import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  phase: number;
  color: string;
  round: boolean;
  life: number;
};

// Canvas cannot resolve var(), so the palette is read from the result stage once.
function palette(): string[] {
  const source = document.querySelector(".match-result") ?? document.documentElement;
  const style = getComputedStyle(source);
  const read = (name: string) => style.getPropertyValue(name).trim();

  const colors = [
    "--palette-tomato",
    "--palette-sun",
    "--palette-sky",
    "--palette-grass",
    "--palette-pink",
    "--palette-tangerine",
  ].flatMap((name) => {
    const color = read(name);

    return color ? [color] : [];
  });

  return colors.length ? colors : ["white"];
}

/** A short two-cannon burst in the game's hue that settles off the bottom of the screen. */
export function VictoryConfetti() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current,
      context = element?.getContext("2d");

    if (!element || !context) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let width = 0,
      height = 0,
      last = 0,
      raf = 0,
      elapsed = 0,
      complete = false;

    let pieces: Piece[] = [];
    const colors = palette();
    const random = (min: number, max: number) => min + Math.random() * (max - min);

    const burst = (originX: number, direction: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + direction * random(0.15, 0.75),
          speed = random(0.55, 1.05) * Math.max(height, 520);

        pieces.push({
          x: originX,
          y: height + 8,
          vx: Math.cos(angle) * speed * 0.62,
          vy: Math.sin(angle) * speed,
          size: random(5, 10),
          angle: random(0, Math.PI * 2),
          spin: random(-9, 9),
          phase: random(0, Math.PI * 2),
          color: colors[i % colors.length] ?? "white",
          round: Math.random() < 0.3,
          life: 0,
        });
      }
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);

      // Pieces snap to a 4px grid and flutter by changing height, so the burst reads as pixels.
      for (const piece of pieces) {
        const size = Math.max(4, Math.round(piece.size / 4) * 4);

        const flutter = Math.max(
          4,
          Math.round((size * Math.abs(Math.cos(piece.life * 7 + piece.phase))) / 4) * 4,
        );

        context.globalAlpha = Math.max(0, Math.min(1, 2.6 - piece.life * 0.9));
        context.fillStyle = piece.color;
        context.fillRect(
          Math.round(piece.x / 4) * 4,
          Math.round(piece.y / 4) * 4,
          piece.round ? size : size * 1.5,
          piece.round ? size : flutter,
        );
      }
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000 || 0, 1 / 30);
      last = now;
      elapsed += dt;

      if (elapsed > 0.42 && elapsed - dt <= 0.42) {
        burst(width * 0.5, Math.random() < 0.5 ? -1 : 1, Math.round(Math.min(70, width / 14)));
      }

      for (const piece of pieces) {
        piece.life += dt;
        piece.vx *= Math.pow(0.35, dt);
        piece.vy = piece.vy * Math.pow(0.42, dt) + height * 0.9 * dt;
        piece.vx += Math.sin(piece.life * 3 + piece.phase) * 30 * dt;
        piece.x += piece.vx * dt;
        piece.y += piece.vy * dt;
        piece.angle += piece.spin * dt;
      }

      pieces = pieces.filter((piece) => piece.y < height + 30 && piece.life < 3.2);
      complete = elapsed > 0.5 && pieces.length === 0;
      element.dataset.phase = complete ? "finished" : "falling";
      draw();

      if (!document.hidden && !complete) raf = requestAnimationFrame(frame);
    };

    const stop = () => cancelAnimationFrame(raf);

    const start = () => {
      stop();
      last = performance.now();

      if (motion.matches) {
        pieces = [];
        complete = true;
        element.dataset.phase = "finished";
        context.clearRect(0, 0, width, height);

        return;
      }

      if (!document.hidden && !complete) raf = requestAnimationFrame(frame);
    };

    resize();
    const count = Math.round(Math.min(110, Math.max(50, width / 12)));
    burst(width * 0.04, 1, count);
    burst(width * 0.96, -1, count);
    start();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", start);
    motion.addEventListener("change", start);

    return () => {
      stop();
      pieces = [];
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", start);
      motion.removeEventListener("change", start);
    };
  }, []);

  return typeof document === "undefined"
    ? null
    : createPortal(
        <canvas ref={canvas} className="victory-confetti" aria-hidden="true" />,
        document.body,
      );
}
