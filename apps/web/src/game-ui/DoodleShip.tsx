import "./sunken-ships.css";
import { BATTLESHIP_FLEET } from "@llmgames/game-catalog";

type Cell = { dr: number; dc: number };

type Vec = [number, number];

const UNIT = 100;

const HULL_INSET = 9;

const DECK_INSET = 22;

/** Directed boundary of a polyomino, clockwise in screen space (interior on the right). */
function boundary(silhouette: Cell[]): Vec[] {
  const filled = new Set(silhouette.map(({ dr, dc }) => `${dr}:${dc}`));
  const has = (r: number, c: number) => filled.has(`${r}:${c}`);
  const next = new Map<string, Vec>();
  const add = (from: Vec, to: Vec) => next.set(from.join(","), to);

  for (const { dr: y, dc: x } of silhouette) {
    if (!has(y - 1, x)) add([x, y], [x + 1, y]);

    if (!has(y, x + 1)) add([x + 1, y], [x + 1, y + 1]);

    if (!has(y + 1, x)) add([x + 1, y + 1], [x, y + 1]);

    if (!has(y, x - 1)) add([x, y + 1], [x, y]);
  }

  const start = [...next.keys()].sort()[0]!;
  const points: Vec[] = [];
  let key = start;

  do {
    const [x, y] = key.split(",").map(Number);

    if (x === undefined || y === undefined)
      throw new Error("Ship boundary coordinate must contain x,y");
    points.push([x, y]);
    key = next.get(key)!.join(",");
  } while (key !== start && points.length <= next.size);

  // Keep only corners so each straight run is one edge.
  return points.filter((point, i) => {
    const a = points[(i - 1 + points.length) % points.length]!,
      b = points[(i + 1) % points.length]!;

    return (point[0] - a[0]) * (b[1] - point[1]) !== (point[1] - a[1]) * (b[0] - point[0]);
  });
}

function unit(a: Vec, b: Vec): Vec {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy) || 1;

  return [dx / length, dy / length];
}

/** Rectilinear inward offset: each corner moves along both adjacent inward normals. */
function inset(corners: Vec[], amount: number): Vec[] {
  return corners.map((point, i) => {
    const before = unit(corners[(i - 1 + corners.length) % corners.length]!, point),
      after = unit(point, corners[(i + 1) % corners.length]!);

    return [
      point[0] * UNIT + amount * (-before[1] - after[1]),
      point[1] * UNIT + amount * (before[0] + after[0]),
    ];
  });
}

/** Outline with a 45° cut on every convex corner, which reads as a pixel-art hull. */
function chamfered(corners: Vec[], cut: number) {
  const n = corners.length;
  const round = (value: number) => Math.round(value * 10) / 10;
  const points: Vec[] = [];
  corners.forEach((point, i) => {
    const before = corners[(i - 1 + n) % n]!,
      after = corners[(i + 1) % n]!;

    const into = unit(before, point),
      out = unit(point, after);

    // Clockwise in screen space, so a right turn is a convex corner.
    if (into[0] * out[1] - into[1] * out[0] <= 0) return void points.push(point);

    const c = Math.min(
      cut,
      Math.hypot(point[0] - before[0], point[1] - before[1]) / 2,
      Math.hypot(after[0] - point[0], after[1] - point[1]) / 2,
    );

    points.push(
      [point[0] - into[0] * c, point[1] - into[1] * c],
      [point[0] + out[0] * c, point[1] + out[1] * c],
    );
  });

  return `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join("L")}Z`;
}

type ShipArt = { hull: string; deck: string; centers: Vec[]; links: [Vec, Vec][] };

const art: Record<string, ShipArt> = Object.fromEntries(
  BATTLESHIP_FLEET.map((ship) => {
    const corners = boundary(ship.shape);

    const centers = ship.shape.map(({ dr, dc }): Vec => [
      dc * UNIT + UNIT / 2,
      dr * UNIT + UNIT / 2,
    ]);

    const links: [Vec, Vec][] = [];
    ship.shape.forEach((a, i) =>
      ship.shape.forEach((b, j) => {
        if (j > i && Math.abs(a.dr - b.dr) + Math.abs(a.dc - b.dc) === 1)
          links.push([centers[i]!, centers[j]!]);
      }),
    );

    return [
      ship.id,
      {
        hull: chamfered(inset(corners, HULL_INSET), 26),
        deck: chamfered(inset(corners, DECK_INSET), 16),
        centers,
        links,
      },
    ];
  }),
);

/* Flat tone fills for every hull on the page, at the same average coverage
   the old checker and sparse screens had. The colors come from CSS custom
   properties on the stage, so one set of patterns serves both themes. It
   must not be display:none or the references stop painting. */
export function ShipDefs() {
  const tile = 12;

  const tone = (id: string, className: string, opacity: number) => (
    <pattern id={id} width={tile} height={tile} patternUnits="userSpaceOnUse">
      <rect className={className} width={tile} height={tile} fillOpacity={opacity} />
    </pattern>
  );

  const checker = (id: string, className: string) => tone(id, className, 0.5);
  const sparse = (id: string, className: string) => tone(id, className, 0.125);

  return (
    <svg className="ship-defs" aria-hidden="true" focusable="false">
      <defs>
        {checker("bs-shade", "bs-p-shade")}
        {checker("bs-shadow", "bs-p-shadow")}
        {sparse("bs-glint", "bs-p-glint")}
        {checker("bs-soot", "bs-p-soot")}
        {sparse("bs-ember", "bs-p-ember")}
      </defs>
    </svg>
  );
}

function Bridge({ x, y }: { x: number; y: number }) {
  return (
    <g className="ship-bridge-group">
      <rect className="ship-bridge" x={x - 22} y={y - 20} width="44" height="40" />
      <rect className="ship-bridge-top" x={x - 22} y={y - 20} width="44" height="6" />
      <rect className="ship-bridge-deck" x={x - 14} y={y - 8} width="28" height="20" />
      <rect className="ship-window" x={x - 16} y={y - 12} width="8" height="4" />
      <rect className="ship-window" x={x - 4} y={y - 12} width="8" height="4" />
      <rect className="ship-window" x={x + 8} y={y - 12} width="8" height="4" />
      <rect className="ship-mast" x={x - 2} y={y - 2} width="4" height="12" />
      <rect className="ship-radar" x={x - 8} y={y + 2} width="16" height="4" />
    </g>
  );
}

function Turret({ x, y }: { x: number; y: number }) {
  return (
    <g className="ship-turret-group">
      <rect className="ship-barrel" x={x - 7} y={y - 34} width="5" height="24" />
      <rect className="ship-barrel" x={x + 2} y={y - 34} width="5" height="24" />
      <path className="ship-turret" d={`M${x - 8} ${y - 15}h16l7 7v16l-7 7h-16l-7-7v-16z`} />
      <rect className="ship-turret-top" x={x - 8} y={y - 9} width="10" height="5" />
    </g>
  );
}

function Plane({ x, y }: { x: number; y: number }) {
  return (
    <path
      className="ship-plane"
      d={`M${x - 3} ${y - 16}h6v8h13v6h-13v8h6v4h-18v-4h6v-8h-13v-6h13z`}
    />
  );
}

/** Screen-space shadow offset expressed in the ship's rotated frame, so light always comes from the top left. */
function shadowOffset(rotation: number) {
  const a = (-rotation * Math.PI) / 180;

  return `translate(${Math.round(8 * Math.cos(a) - 10 * Math.sin(a))} ${Math.round(8 * Math.sin(a) + 10 * Math.cos(a))})`;
}

/** Pixel-art top-down hull that follows the ship's polyomino exactly (100 SVG units per cell). */
export function DoodleShip({
  id,
  row,
  col,
  rotation,
}: {
  id: string;
  row: number;
  col: number;
  rotation: number;
}) {
  const ship = art[id];

  if (!ship) return null;
  const [bridge, ...rest] = ship.centers;
  const keel = ship.links.map(([a, b]) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`).join("");

  return (
    <g
      className="doodle-ship"
      data-ship-kind={id}
      transform={`translate(${col * 100} ${row * 100}) rotate(${rotation} 50 50)`}
    >
      <path className="ship-wake" d={ship.hull} />
      <path className="ship-shadow" d={ship.hull} transform={shadowOffset(rotation)} />
      <path className="ship-hull" d={ship.hull} />
      <path className="ship-bevel" d={ship.hull} />
      <path className="ship-deck" d={ship.deck} />
      <path className="ship-glint" d={ship.deck} />
      <g className="ship-details">
        <path className={id === "carrier" ? "ship-runway" : "ship-keel"} d={keel} />
        {id === "submarine" ? (
          <>
            {bridge && (
              <g className="ship-bridge-group">
                <path
                  className="ship-bridge"
                  d={`M${bridge[0] - 10} ${bridge[1] - 28}h20l6 8v40l-6 8h-20l-6-8v-40z`}
                />
                <rect
                  className="ship-bridge-top"
                  x={bridge[0] - 10}
                  y={bridge[1] - 28}
                  width="20"
                  height="6"
                />
                <rect
                  className="ship-mast"
                  x={bridge[0] - 2}
                  y={bridge[1] - 12}
                  width="4"
                  height="10"
                />
              </g>
            )}
            {rest.map(([x, y], i) => (
              <g key={i} className="ship-hatch-group">
                <rect className="ship-hatch" x={x - 8} y={y - 8} width="16" height="16" />
                <rect className="ship-window" x={x - 4} y={y - 4} width="8" height="8" />
              </g>
            ))}
          </>
        ) : id === "carrier" ? (
          <>
            {rest.map(([x, y], i) => (i % 2 ? null : <Plane key={i} x={x} y={y} />))}
            {bridge && <Bridge x={bridge[0]} y={bridge[1]} />}
          </>
        ) : (
          <>
            {rest.map(([x, y], i) => (
              <Turret key={i} x={x} y={y} />
            ))}
            {bridge && <Bridge x={bridge[0]} y={bridge[1]} />}
          </>
        )}
      </g>
    </g>
  );
}
