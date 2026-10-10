/* A faint ordered-dither patch drawn under the pointer on interactive
   surfaces: it follows the cursor while hovering and rings outward on press.
   One small canvas per active host, at one canvas pixel per dither cell.
   Hosts may set --touch-ink, --touch-ripple-ink and --touch-alpha; they are
   read every frame, so state selectors can recolor a patch while it is live.
   --touch-knockout:1 keeps the dots off the host's text and icons so the
   patch frames the content instead of running behind it. Descendants marked
   [data-dither-skip] are always left clear (for example a current nav link). */

const HOSTS =
  ".ui-button,.desk-player,.lobby-member,.result-player,.segmented button,.ui-tabs-trigger,.game-tile,.library-filters button,.typesafe-help-button,.series-icon-button,.landing-arcade-picker button,[data-dither-touch]";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const HOVER_ALPHA = 0.16;

const RIPPLE_MS = 460;

type Ripple = { x: number; y: number; start: number; reach: number };

type Touch = {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  cx: number;
  cy: number;
  hover: boolean;
  level: number;
  ripples: Ripple[];
};

const touches = new Map<HTMLElement, Touch>();

let frame = 0;

function hostFor(target: EventTarget | null) {
  const host = target instanceof Element ? target.closest<HTMLElement>(HOSTS) : null;

  if (!host || host.closest("[data-dither-touch=off]")) return null;

  if (
    (host instanceof HTMLButtonElement && host.disabled) ||
    host.getAttribute("aria-disabled") === "true" ||
    host.hasAttribute("data-disabled")
  )
    return null;

  return host;
}

function cellSize() {
  const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--px"));

  return Number.isFinite(px) && px > 0 ? px : 3;
}

function touchFor(host: HTMLElement, x: number, y: number) {
  let touch = touches.get(host);

  if (!touch) {
    const canvas = document.createElement("canvas");
    canvas.className = "dither-touch";
    canvas.setAttribute("aria-hidden", "true");
    host.classList.add("dither-touch-host");
    host.append(canvas);
    touch = { host, canvas, x, y, cx: x, cy: y, hover: false, level: 0, ripples: [] };
    touches.set(host, touch);
  }

  return touch;
}

function release(touch: Touch) {
  touch.canvas.remove();
  touch.host.classList.remove("dither-touch-host");
  touches.delete(touch.host);
}

type Hole = { l: number; t: number; r: number; b: number };

/** Boxes around the host's in-flow content (text and icons), in host-local pixels, padded by one dither cell. */
function contentHoles(host: HTMLElement, canvas: HTMLCanvasElement, box: DOMRect, pad: number) {
  const holes: Hole[] = [];

  for (const node of host.childNodes) {
    if (node === canvas) continue;
    let rect: DOMRect;

    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      rect = range.getBoundingClientRect();
    } else if (node instanceof Element) {
      // Absolute children are decoration (indicators, wipes), not content.
      if (getComputedStyle(node).position === "absolute") continue;
      rect = node.getBoundingClientRect();
    } else continue;

    if (!rect.width || !rect.height) continue;
    holes.push({
      l: rect.left - box.left - pad,
      t: rect.top - box.top - pad,
      r: rect.right - box.left + pad,
      b: rect.bottom - box.top + pad,
    });
  }

  return holes;
}

function draw(touch: Touch, now: number, cell: number) {
  const { host, canvas } = touch;

  // React can replace a host's text children wholesale, taking the canvas with it.
  if (canvas.parentNode !== host) host.append(canvas);
  const box = host.getBoundingClientRect();

  const cols = Math.max(1, Math.ceil(box.width / cell)),
    rows = Math.max(1, Math.ceil(box.height / cell));

  if (canvas.width !== cols || canvas.height !== rows) {
    canvas.width = cols;
    canvas.height = rows;
  }

  const ctx = canvas.getContext("2d");

  if (!ctx) return;
  ctx.clearRect(0, 0, cols, rows);
  const style = getComputedStyle(host);
  const ink = style.getPropertyValue("--touch-ink").trim() || style.color;
  const rippleInk = style.getPropertyValue("--touch-ripple-ink").trim() || ink;
  const alpha = parseFloat(style.getPropertyValue("--touch-alpha"));

  const holes =
    style.getPropertyValue("--touch-knockout").trim() === "1"
      ? contentHoles(host, canvas, box, cell)
      : [];

  for (const skip of host.querySelectorAll("[data-dither-skip]")) {
    const rect = skip.getBoundingClientRect();

    if (rect.width && rect.height)
      holes.push({
        l: rect.left - box.left,
        t: rect.top - box.top,
        r: rect.right - box.left,
        b: rect.bottom - box.top,
      });
  }

  let fill = "";

  touch.cx += (touch.x - touch.cx) * 0.35;
  touch.cy += (touch.y - touch.cy) * 0.35;
  touch.level += ((touch.hover ? 1 : 0) - touch.level) * 0.18;
  touch.ripples = touch.ripples.filter((ripple) => now - ripple.start < RIPPLE_MS);

  const radius = Math.max(36, Math.min(120, Math.min(box.width, box.height) * 1.1));

  const hx = touch.cx - box.left,
    hy = touch.cy - box.top;

  const rings = touch.ripples.map((ripple) => {
    const t = (now - ripple.start) / RIPPLE_MS;

    return {
      x: ripple.x - box.left,
      y: ripple.y - box.top,
      r: ripple.reach * (1 - (1 - t) ** 3),
      amp: (1 - t) * 0.9,
    };
  });

  ctx.globalAlpha = Number.isFinite(alpha) ? alpha : HOVER_ALPHA;

  for (let row = 0; row < rows; row += 1) {
    const y = (row + 0.5) * cell;

    for (let col = 0; col < cols; col += 1) {
      const x = (col + 0.5) * cell;

      if (
        holes.length &&
        holes.some((hole) => x > hole.l && x < hole.r && y > hole.t && y < hole.b)
      )
        continue;

      let glow = 0,
        wave = 0;

      if (touch.level > 0.01) {
        const falloff = 1 - Math.hypot(x - hx, y - hy) / radius;

        if (falloff > 0) glow = touch.level * falloff * falloff * 0.7;
      }

      for (const ring of rings) {
        const edge = 1 - Math.abs(Math.hypot(x - ring.x, y - ring.y) - ring.r) / 18;

        if (edge > 0) wave += ring.amp * edge;
      }

      const tone = glow + wave;

      if (tone <= 0) continue;
      const color = wave > glow ? rippleInk : ink;

      if (color !== fill) ctx.fillStyle = fill = color;

      const gx = Math.floor((box.left + x) / cell),
        gy = Math.floor((box.top + y) / cell);

      // Thresholds come from page coordinates so the dot screen stays put as the patch moves.
      if (tone > (BAYER[(((gy % 4) + 4) % 4) * 4 + (((gx % 4) + 4) % 4)]! + 0.5) / 16)
        ctx.fillRect(col, row, 1, 1);
    }
  }
}

function tick(now: number) {
  frame = 0;
  const cell = cellSize();

  for (const touch of [...touches.values()]) {
    if (!touch.host.isConnected || (!touch.hover && touch.level < 0.02 && !touch.ripples.length)) {
      release(touch);
      continue;
    }

    draw(touch, now, cell);
  }

  if (touches.size) frame = requestAnimationFrame(tick);
}

function wake() {
  if (!frame) frame = requestAnimationFrame(tick);
}

function reach(host: HTMLElement, x: number, y: number) {
  const box = host.getBoundingClientRect();

  return Math.hypot(Math.max(x - box.left, box.right - x), Math.max(y - box.top, box.bottom - y));
}

/** Installs the site-wide listeners and returns a cleanup function. */
export function installDitherTouch() {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  const over = (event: PointerEvent) => {
    if (reduced.matches || event.pointerType !== "mouse") return;
    const host = hostFor(event.target);

    if (!host) return;
    const touch = touchFor(host, event.clientX, event.clientY);

    if (!touch.hover) {
      touch.cx = event.clientX;
      touch.cy = event.clientY;
    }

    touch.hover = true;
    wake();
  };

  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !touches.size) return;
    const host = hostFor(event.target);
    const touch = host && touches.get(host);

    if (!touch) return;
    touch.x = event.clientX;
    touch.y = event.clientY;
  };

  const out = (event: PointerEvent) => {
    for (const touch of touches.values()) {
      if (
        event.target instanceof Node &&
        touch.host.contains(event.target) &&
        !(event.relatedTarget instanceof Node && touch.host.contains(event.relatedTarget))
      )
        touch.hover = false;
    }
  };

  const down = (event: PointerEvent) => {
    if (reduced.matches) return;
    const host = hostFor(event.target);

    if (!host) return;
    const touch = touchFor(host, event.clientX, event.clientY);
    touch.ripples.push({
      x: event.clientX,
      y: event.clientY,
      start: performance.now(),
      reach: reach(host, event.clientX, event.clientY),
    });
    wake();
  };

  const key = (event: KeyboardEvent) => {
    if (reduced.matches || event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    const host = hostFor(event.target);

    if (!host || host !== event.target) return;
    const box = host.getBoundingClientRect();

    const x = box.left + box.width / 2,
      y = box.top + box.height / 2;

    touchFor(host, x, y).ripples.push({ x, y, start: performance.now(), reach: reach(host, x, y) });
    wake();
  };

  document.addEventListener("pointerover", over, { passive: true });
  document.addEventListener("pointermove", move, { passive: true });
  document.addEventListener("pointerout", out, { passive: true });
  document.addEventListener("pointerdown", down, { passive: true });
  document.addEventListener("keydown", key, { passive: true });

  return () => {
    document.removeEventListener("pointerover", over);
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerout", out);
    document.removeEventListener("pointerdown", down);
    document.removeEventListener("keydown", key);

    if (frame) cancelAnimationFrame(frame);
    frame = 0;

    for (const touch of [...touches.values()]) release(touch);
  };
}
