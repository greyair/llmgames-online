import { knownValue } from "@/domain/view-contracts";
import type { WireValue } from "@llmgames/game-catalog";
import {
  useState,
  useRef,
  useEffect,
  useId,
  Fragment,
  type PointerEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import type { ClientView } from "@/domain/game-state";
import { Button } from "@/components/ui/button";
import { DoodleShip, ShipDefs } from "./DoodleShip";
import { FleetStatus, SunkenFleet, type SunkenShip } from "./SunkenShips";
import { BattleshipEffects, useBattleshipEffects } from "./BattleshipEffects";
import "./battleship.css";
import "./sketch/battleship.css";
import { useT, type MessageKey } from "@/i18n";

type Point = { row: number; col: number };

type RadarScan = Point & { shipCells: number; cellsScanned: number };

type Placement = Point & { id: string; rotation: number; sunk?: boolean };

type Fleet = {
  id: string;
  name: string;
  shortName?: string;
  "shape": { dr: number; dc: number }[];
};

type TorpedoPath = Point & {
  endRow: number;
  endCol: number;
  direction: "n" | "s" | "e" | "w";
};

type Sea = {
  radarScans?: RadarScan[];
  torpedoPaths?: TorpedoPath[];
  mineShots?: Point[];
  mineHits?: Point[];
  triggeredMines?: Point[];
  bombedAreas?: Point[];
  sunkShips?: SunkenShip[];
  fleetStatus?: { id: string; sunk?: boolean }[];
  mines?: Point[];
  playerId?: string;
  ready?: boolean;
  cells?: (string | null)[][];
  ships?: Placement[];
  revealedShips?: Placement[];
  revealedMines?: Point[];
  incomingHits?: Point[];
  incomingMisses?: Point[];
  hits?: Point[];
  misses?: Point[];
  shipsRemaining?: number;
  munitionPoints?: number;
};

const coordinate = (p: Point) => `${p.row}:${p.col}`;

function cells(ship: Placement, spec: Fleet): Point[] {
  return spec.shape.map(({ dr, dc }) => {
    const [r, c] =
      ship.rotation === 90
        ? [dc, -dr]
        : ship.rotation === 180
          ? [-dr, -dc]
          : ship.rotation === 270
            ? [-dc, dr]
            : [dr, dc];

    return { row: ship.row + r!, col: ship.col + c! };
  });
}

const weapons = [
  { id: "cannon", label: "board.ships.weaponCannon", hint: "board.ships.weaponCannonHint" },
  { id: "mine", label: "board.ships.weaponMines", hint: "board.ships.weaponMinesHint" },
  { id: "bomb", label: "board.ships.weaponBomb", hint: "board.ships.weaponBombHint" },
  { id: "radar", label: "board.ships.weaponRadar", hint: "board.ships.weaponRadarHint" },
  { id: "torpedo", label: "board.ships.weaponTorpedo", hint: "board.ships.weaponTorpedoHint" },
] as const satisfies readonly { id: string; label: MessageKey; hint: MessageKey }[];

const ENERGY_SEGMENTS = 10;

const weaponGlyphs = {
  cannon: (
    <>
      <path d="m5 11 13-7 3 5-13 7Z" />
      <path d="m16 5 3 5M4 20h14M12 15l3 5" />
      <circle cx="7" cy="18" r="3" />
      <circle className="glyph-fill" cx="7" cy="18" r="1" />
    </>
  ),
  mine: (
    <>
      <circle cx="12" cy="12" r="6" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3" />
      <circle className="glyph-fill" cx="12" cy="12" r="1.8" />
    </>
  ),
  bomb: (
    <>
      <circle cx="10" cy="14" r="7" />
      <path d="m14 8 2-2M16 6c-1-3 3-4 3-1M19 2V1M21 4h2M21 2l1-1M6 12l2-2" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 3v9l6.4-6.4M3 12h3M12 18v3M18 12h3" />
      <circle className="glyph-fill" cx="15.5" cy="9.5" r="1.6" />
    </>
  ),
  torpedo: (
    <>
      <path d="M5 9h12c3 0 5 3 5 3s-2 3-5 3H5Z" />
      <path d="m5 9-3-3v12l3-3M16 9v6M1 12h4" />
    </>
  ),
} satisfies Record<string, ReactNode>;

function WeaponIcon({ name }: { name: string }) {
  return (
    <svg className="weapon-icon" viewBox="0 0 24 24" aria-hidden="true">
      {knownValue(weaponGlyphs, name)}
    </svg>
  );
}

/** A spiky contact mine drawn on a 12-pixel grid. */
function MineArt() {
  return (
    <svg
      className="mine-art"
      viewBox="0 0 12 12"
      {...{ "shapeRendering": "crispEdges" }}
      aria-hidden="true"
    >
      <path
        className="mine-spike"
        d="M5 0h2v2H5zM5 10h2v2H5zM0 5h2v2H0zM10 5h2v2h-2zM1 1h2v2H1zM9 1h2v2H9zM1 9h2v2H1zM9 9h2v2H9z"
      />
      <path className="mine-body" d="M4 2h4v1h1v1h1v4H9v1H8v1H4V9H3V8H2V4h1V3h1z" />
      <path className="mine-shade" d="M8 7h1v1H8zM7 8h1v1H7zM9 5h1v2H9zM5 9h2v1H5z" />
      <path className="mine-glint" d="M4 3h2v1H4zM3 4h1v2H3z" />
      <path className="mine-lamp" d="M6 6h1v1H6z" />
    </svg>
  );
}

function TriggeredMineArt() {
  const ditherId = useId();

  return (
    <svg className="triggered-mine-art" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <pattern id={ditherId} width="2" height="2" patternUnits="userSpaceOnUse">
          <rect
            className="spent-mine-dither"
            width="1"
            height="1"
            {...{ "shapeRendering": "crispEdges" }}
          />
        </pattern>
      </defs>
      <path className="mine-burst" d="M3 3l2 2M19 5l2-2M3 21l2-2M19 19l2 2" />
      <path
        className="spent-mine-spikes"
        d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"
      />
      <circle className="spent-mine-body" cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="5.1" fill={`url(#${ditherId})`} stroke="none" />
      <path className="spent-mine-crack" d="m11 7 3 4-4 2 3 4" />
    </svg>
  );
}

function CostPips({ cost }: { cost: number }) {
  return (
    <span className="power-pips" aria-hidden="true">
      {Array.from({ length: cost }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

function EnergyBolt() {
  return (
    <svg className="energy-bolt" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.5Z" />
    </svg>
  );
}

function EnergyMeter({ points, spend }: { points: number; spend: number }) {
  const t = useT();
  const rows = Math.max(1, Math.ceil(points / ENERGY_SEGMENTS));

  return (
    <div
      className="ship-energy"
      data-overflow={rows > 1}
      role="img"
      title={t("board.ships.energyTip")}
      aria-label={t("board.ships.energyPoints", { points })}
    >
      <span className="energy-label">
        <EnergyBolt />
        {t("board.ships.energy")}
      </span>
      <span className="energy-cells" aria-hidden="true">
        {Array.from({ length: rows * ENERGY_SEGMENTS }, (_, i) => (
          <span
            key={i}
            className="energy-cell"
            data-on={i < points}
            data-spend={spend > 0 && i < points && i >= points - spend}
            style={
              { "--i": i } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
          />
        ))}
      </span>
      <strong className="energy-value" aria-hidden="true">
        {points}
      </strong>
    </div>
  );
}

function WeaponTrails({ sea }: { sea: Sea }) {
  const t = useT();

  return (
    <div className="weapon-trails">
      {sea.triggeredMines?.map((point) => (
        <span
          key={`mine:${coordinate(point)}`}
          className="triggered-mine"
          role="img"
          aria-label={t("board.ships.triggeredMine", {
            cell: `${String.fromCharCode(65 + point.row)}${point.col + 1}`,
          })}
          title={t("board.ships.triggeredMineTitle")}
          style={{ left: `${point.col * 10}%`, top: `${point.row * 10}%` }}
        >
          <TriggeredMineArt />
        </span>
      ))}
      {sea.torpedoPaths?.map((path, index) => (
        <Fragment key={index}>
          <span
            className="torpedo-path"
            data-axis={path.row === path.endRow ? "h" : "v"}
            role="img"
            aria-label={t("board.ships.torpedoPath", {
              from: `${String.fromCharCode(65 + path.row)}${path.col + 1}`,
              to: `${String.fromCharCode(65 + path.endRow)}${path.endCol + 1}`,
            })}
            style={{
              left: `${Math.min(path.col, path.endCol) * 10}%`,
              top: `${Math.min(path.row, path.endRow) * 10}%`,
              width: `${(Math.abs(path.endCol - path.col) + 1) * 10}%`,
              height: `${(Math.abs(path.endRow - path.row) + 1) * 10}%`,
            }}
          />
          <svg
            className="torpedo-start"
            role="img"
            aria-label={t("board.ships.torpedoLaunch")}
            viewBox="0 0 24 24"
            style={{
              left: `${(path.col + 0.5) * 10}%`,
              top: `${(path.row + 0.5) * 10}%`,
              transform: `translate(-50%,-50%) rotate(${path.direction === "n" ? 180 : path.direction === "e" ? -90 : path.direction === "w" ? 90 : 0}deg)`,
            }}
          >
            <path d="M12 4v15m-6-6 6 6 6-6" />
          </svg>
        </Fragment>
      ))}
      {(sea.mineShots ?? sea.mineHits)?.map((point) => (
        <span
          key={coordinate(point)}
          className="mine-shot-outline"
          data-hit={(sea.hits ?? sea.incomingHits ?? []).some(
            (hit) => coordinate(hit) === coordinate(point),
          )}
          role="img"
          aria-label={t("board.ships.mineReturn", {
            cell: `${String.fromCharCode(65 + point.row)}${point.col + 1}`,
          })}
          style={{ left: `${point.col * 10}%`, top: `${point.row * 10}%` }}
        />
      ))}
    </div>
  );
}

function RadarScans({ scans }: { scans: RadarScan[] }) {
  return (
    <div className="radar-scans">
      {scans.map((scan, index) => {
        const firstRow = Math.max(0, scan.row - 1),
          lastRow = Math.min(9, scan.row + 1),
          firstCol = Math.max(0, scan.col - 1),
          lastCol = Math.min(9, scan.col + 1);

        const coordinateLabel = `${String.fromCharCode(65 + scan.row)}${scan.col + 1}`;

        return (
          <div
            className="radar-scan"
            data-radar-count={scan.shipCells}
            key={`${scan.row}:${scan.col}:${index}`}
          >
            <span
              className="radar-scan-area"
              style={{
                left: `${firstCol * 10}%`,
                top: `${firstRow * 10}%`,
                width: `${(lastCol - firstCol + 1) * 10}%`,
                height: `${(lastRow - firstRow + 1) * 10}%`,
              }}
              aria-hidden="true"
            />
            <span
              className="radar-scan-count"
              style={{
                left: `${(scan.col + 0.5) * 10}%`,
                top: `${(scan.row + 0.5) * 10}%`,
              }}
              aria-hidden="true"
            >
              {scan.shipCells}
            </span>
            <span className="sr-only">
              Radar scan at {coordinateLabel} found {scan.shipCells} ship{" "}
              {scan.shipCells === 1 ? "cell" : "cells"} in {scan.cellsScanned} scanned cells.
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DoodleFleet({
  ships,
  highlighted,
  fleet = [],
  preview,
  previewValid = true,
}: {
  ships: Placement[];
  highlighted?: string | null;
  fleet?: Fleet[];
  preview?: Placement;
  previewValid?: boolean;
}) {
  const ship = ships.find((item) => item.id === highlighted),
    spec = fleet.find((item) => item.id === highlighted);

  const points = ship && spec ? cells(ship, spec) : [];
  const occupied = new Set(points.map(coordinate));

  const boundary = points
    .flatMap(({ row, col }) => {
      const x = col * 100,
        y = row * 100;

      return [
        !occupied.has(`${row - 1}:${col}`) ? `M${x} ${y}h100` : "",
        !occupied.has(`${row + 1}:${col}`) ? `M${x} ${y + 100}h100` : "",
        !occupied.has(`${row}:${col - 1}`) ? `M${x} ${y}v100` : "",
        !occupied.has(`${row}:${col + 1}`) ? `M${x + 100} ${y}v100` : "",
      ];
    })
    .join(" ");

  return (
    <svg className="doodle-fleet" viewBox="0 0 1000 1000" aria-hidden="true">
      {ships.map((ship) => (
        <g key={ship.id} data-highlighted={highlighted === ship.id}>
          <DoodleShip {...ship} />
        </g>
      ))}
      {boundary && <path className="ship-cell-boundary" d={boundary} />}
      {preview && (
        <g className="ship-drag-preview" data-valid={previewValid}>
          <DoodleShip {...preview} />
        </g>
      )}
    </svg>
  );
}

export function Battleship({
  state,
  send: sendIntent,
  finalResult = false,
  renderResultPlayer,
}: {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
  finalResult?: boolean;
  renderResultPlayer?: (playerId?: string) => ReactNode;
}) {
  const t = useT();

  const { effects, launch, radarScanning, incomingRadarScanning, visibleRadarCounts } =
    useBattleshipEffects(state);

  const [radarBeforeScan, setRadarBeforeScan] = useState(state.radarScans);

  const [settledAnnouncement, setSettledAnnouncement] = useState(state.lastAnnouncement);

  const send = (name: string, data: WireValue) => {
    if (name === "radar" && !radarScanning) setRadarBeforeScan(state.radarScans);
    launch(name, data);
    sendIntent(name, data);
  };

  const radarAnimating = radarScanning || incomingRadarScanning;

  const announcement =
    radarAnimating && state.lastAnnouncement?.startsWith("Radar")
      ? settledAnnouncement
      : state.lastAnnouncement;

  useEffect(() => {
    if (!radarAnimating) setSettledAnnouncement(state.lastAnnouncement);
  }, [radarAnimating, state.lastAnnouncement]);
  const placement = state.turnState?.phase === "placement";

  const own = state.yourBoard,
    opponent = state.opponent;

  const watching = Boolean(state.you?.isSpectator || state.replayReadOnly);
  const fleet = state.fleet ?? [];

  const [draft, setDraft] = useState<Placement[]>([]),
    [selectedShip, setSelectedShip] = useState(""),
    [weapon, setWeapon] = useState("cannon"),
    [tab, setTab] = useState("target"),
    [notice, setNotice] = useState("");

  const stageRef = useRef<HTMLDivElement>(null);

  const dragRef = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
    offset: Point;
  } | null>(null);

  const suppressClick = useRef(false);

  const powerDrag = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  const suppressPowerClick = useRef(false);

  const [powerGhost, setPowerGhost] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);

  const [powerAim, setPowerAim] = useState<{
    id: string;
    board: string;
    point: Point;
  } | null>(null);

  const [dropCell, setDropCell] = useState<Point | null>(null);
  const [hoveredShip, setHoveredShip] = useState<string | null>(null);
  const [movingShip, setMovingShip] = useState<string | null>(null);
  const [hoverWeapon, setHoverWeapon] = useState<string | null>(null);
  const enabled = state.status === "playing" && !watching;

  const can = (action: string) => enabled && Boolean(state.you?.legalActions?.includes(action));

  const currentWeapon = can(weapon) ? weapon : "cannon";

  const costs = state.munitionEconomy?.costs ?? state.you?.weaponCosts ?? {};

  const points = own?.munitionPoints ?? state.you?.munitionPoints ?? 0;

  const radarScans = (radarScanning ? radarBeforeScan : state.radarScans) ?? [];

  const directionFor = ({ row, col }: Point) =>
    row === 0 ? "s" : row === 9 ? "n" : col === 0 ? "e" : "w";

  const powerTargetAt = (x: number, y: number) => {
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>(".sea-cell");

    if (!cell || !stageRef.current?.contains(cell)) return null;
    const board = cell.closest<HTMLElement>(".sea")!.dataset.board!;
    const selected = powerDrag.current?.id ?? currentWeapon;

    if (board !== (selected === "mine" ? "own" : "target")) return null;

    return {
      board,
      point: { row: Number(cell.dataset.row), col: Number(cell.dataset.col) },
    };
  };

  const powerArea = (id: string, board: string, point: Point) => {
    const { row, col } = point;
    const requiredBoard = id === "mine" ? "own" : "target";

    let area: Point[] = [point],
      valid = board === requiredBoard && can(id);

    if (id === "bomb") {
      area = Array.from({ length: 4 }, (_, i) => ({
        row: row + Math.floor(i / 2),
        col: col + (i % 2),
      }));
      valid &&= row < 9 && col < 9;
    }

    if (id === "radar")
      area = Array.from({ length: 9 }, (_, i) => ({
        row: row + Math.floor(i / 3) - 1,
        col: col + (i % 3) - 1,
      }));
    const knownHits = new Set((opponent?.hits ?? []).map(coordinate));

    const knownShots = new Set(
      [...(opponent?.hits ?? []), ...(opponent?.misses ?? [])].map(coordinate),
    );

    if (id === "torpedo") {
      valid &&= row === 0 || row === 9 || col === 0 || col === 9;

      if (valid) {
        area = [];
        const direction = directionFor(point);

        for (let i = 0; i < 10; i++) {
          const p = {
            row: row + (direction === "s" ? i : direction === "n" ? -i : 0),
            col: col + (direction === "e" ? i : direction === "w" ? -i : 0),
          };

          if (p.row < 0 || p.row > 9 || p.col < 0 || p.col > 9 || knownHits.has(coordinate(p)))
            break;
          area.push(p);
        }
      }
    }

    area = area.filter((p) => p.row >= 0 && p.row < 10 && p.col >= 0 && p.col < 10);

    if (id === "bomb" || id === "torpedo")
      valid &&= area.some((p) => !knownShots.has(coordinate(p)));

    if (id === "mine")
      valid &&=
        !own?.cells?.[row]?.[col] &&
        ![...(own?.incomingHits ?? []), ...(own?.incomingMisses ?? []), ...(own?.mines ?? [])].some(
          (p) => coordinate(p) === coordinate(point),
        );

    return { area, valid };
  };

  const firePower = (id: string, board: string, point: Point) => {
    if (!powerArea(id, board, point).valid) return;
    send(id, id === "torpedo" ? { ...point, direction: directionFor(point) } : point);
    setWeapon("cannon");
    setPowerAim(null);
  };

  const startPowerDrag = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || !can(id)) return;
    suppressPowerClick.current = false;
    powerDrag.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setWeapon(id);
    setTab(id === "mine" ? "own" : "target");
  };

  const movePowerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = powerDrag.current;

    if (!drag || drag.pointerId !== event.pointerId) return;

    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) drag.moved = true;

    if (!drag.moved) return;
    setPowerGhost({ id: drag.id, x: event.clientX, y: event.clientY });
    const target = powerTargetAt(event.clientX, event.clientY);
    setPowerAim(target ? { id: drag.id, ...target } : null);
  };

  const finishPowerDrag = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const drag = powerDrag.current;

    if (!drag || drag.pointerId !== event.pointerId) return;
    powerDrag.current = null;
    suppressPowerClick.current = drag.moved;
    setPowerGhost(null);
    setPowerAim(null);

    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);

    if (drag.moved) {
      setWeapon("cannon");
      const target = powerTargetAt(event.clientX, event.clientY);

      if (!cancel && target) firePower(drag.id, target.board, target.point);
    }
  };

  useEffect(() => {
    powerDrag.current = null;
    setPowerGhost(null);
    setPowerAim(null);
    setWeapon("cannon");
  }, [state.turnState?.currentPlayerId, state.turnState?.turnNumber, state.status]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        powerDrag.current = null;
        suppressPowerClick.current = true;
        setPowerGhost(null);
        setPowerAim(null);
        setWeapon("cannon");
      }
    };

    window.addEventListener("keydown", cancel);

    return () => window.removeEventListener("keydown", cancel);
  }, []);

  const effect =
    powerAim && can(powerAim.id) ? powerArea(powerAim.id, powerAim.board, powerAim.point) : null;

  const effectKeys = new Set(effect?.area.map(coordinate));

  const shipByCell = new Map(
    draft.flatMap((ship) => {
      const spec = fleet.find((item) => item.id === ship.id);

      return spec ? cells(ship, spec).map((point) => [coordinate(point), ship] as const) : [];
    }),
  );

  const occupied = new Set(shipByCell.keys());
  useEffect(() => {
    if (
      placement &&
      !own?.ready &&
      draft.length === 0 &&
      Array.isArray(own?.ships) &&
      own.ships.length > 0
    )
      setDraft(own.ships);
  }, [placement, own?.ready, own?.ships, draft.length]);

  const place = (
    point: Point,
    shipId = selectedShip,
    nextRotation = draft.find((ship) => ship.id === shipId)?.rotation ?? 0,
    rotating = false,
  ) => {
    if (!can("place_fleet") || own?.ready) return;
    const spec = fleet.find((item) => item.id === shipId);

    if (!spec) return;
    const next = { ...point, id: spec.id, rotation: nextRotation };
    const nextCells = cells(next, spec);

    const other = new Set(
      draft
        .filter((ship) => ship.id !== spec.id)
        .flatMap((ship) => {
          const silhouette = fleet.find((item) => item.id === ship.id);

          return silhouette ? cells(ship, silhouette).map(coordinate) : [];
        }),
    );

    if (
      nextCells.some(
        (cell) =>
          cell.row < 0 ||
          cell.row > 9 ||
          cell.col < 0 ||
          cell.col > 9 ||
          other.has(coordinate(cell)),
      )
    ) {
      setNotice(t("board.ships.placementInvalid"));

      return;
    }

    setDraft((old) => [...old.filter((ship) => ship.id !== next.id), next]);
    setNotice("");

    if (!rotating) setSelectedShip("");
  };

  const rotateShip = (ship: Placement) => {
    const spec = fleet.find((item) => item.id === ship.id);

    if (!spec) return;
    const nextRotation = (ship.rotation + 90) % 360;

    const before = cells(ship, spec),
      after = cells({ id: ship.id, row: 0, col: 0, rotation: nextRotation }, spec);

    const row = Math.min(...before.map((p) => p.row)) - Math.min(...after.map((p) => p.row));

    const col = Math.min(...before.map((p) => p.col)) - Math.min(...after.map((p) => p.col));

    place({ row, col }, ship.id, nextRotation, true);
  };

  const pointAt = (x: number, y: number): Point | null => {
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>(".sea-cell");

    return cell && stageRef.current?.contains(cell) && cell.dataset.row !== undefined
      ? { row: Number(cell.dataset.row), col: Number(cell.dataset.col) }
      : null;
  };

  const beginDrag = (event: PointerEvent<HTMLButtonElement>, id: string, grabbed?: Point) => {
    if (event.button !== 0 || !can("place_fleet") || own?.ready) return;
    suppressClick.current = false;
    const placed = draft.find((ship) => ship.id === id);

    const offset =
      grabbed && placed
        ? { row: grabbed.row - placed.row, col: grabbed.col - placed.col }
        : { row: 0, col: 0 };

    dragRef.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      offset,
    };
    setHoveredShip(id);
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedShip(id);
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) return;

    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) drag.moved = true;

    if (drag.moved) {
      setMovingShip(drag.id);
      const point = pointAt(event.clientX, event.clientY);
      setDropCell(
        point
          ? {
              row: point.row - drag.offset.row,
              col: point.col - drag.offset.col,
            }
          : null,
      );
    }
  };

  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDropCell(null);
    setHoveredShip(null);
    setMovingShip(null);
    suppressClick.current = drag.moved;

    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);

    if (!cancel && drag.moved) {
      const point = pointAt(event.clientX, event.clientY);

      if (point)
        place(
          {
            row: point.row - drag.offset.row,
            col: point.col - drag.offset.col,
          },
          drag.id,
        );
    }
  };

  const dropSpec = fleet.find((ship) => ship.id === selectedShip);

  const previewCells =
    dropCell && dropSpec
      ? cells(
          {
            ...dropCell,
            id: selectedShip,
            rotation: draft.find((ship) => ship.id === selectedShip)?.rotation ?? 0,
          },
          dropSpec,
        )
      : [];

  const otherCells = new Set(
    draft
      .filter((ship) => ship.id !== selectedShip)
      .flatMap((ship) => {
        const spec = fleet.find((item) => item.id === ship.id);

        return spec ? cells(ship, spec).map(coordinate) : [];
      }),
  );

  const validDrop = previewCells.every(
    (p) => p.row >= 0 && p.row < 10 && p.col >= 0 && p.col < 10 && !otherCells.has(coordinate(p)),
  );

  const previewKeys = new Set(previewCells.map(coordinate));

  const shotLog = state.shotLog ?? [];

  const projectedBoards = Array.isArray(state.spectatorBoards) ? state.spectatorBoards : [];

  const sourceBoards =
    watching && projectedBoards.length
      ? projectedBoards.map((sea, i) => ({
          sea,
          id: i === 0 ? "target" : "own",
          title:
            state.players?.find((p) => p.id === sea.playerId)?.name ??
            t("board.ships.playerNumber", { number: i + 1 }),
        }))
      : placement
        ? [
            {
              sea: own ?? {},
              id: "target",
              title: own?.ready ? t("board.ships.fleetReady") : t("board.ships.placeFleet"),
            },
          ]
        : [
            { sea: opponent ?? {}, id: "target", title: t("board.ships.enemyFleet") },
            { sea: own ?? {}, id: "own", title: t("board.ships.yourFleet") },
          ];

  const boards = sourceBoards.map((board) => {
    if (!state.replayReadOnly) return board;
    const ships = board.sea.revealedShips ?? board.sea.ships ?? [];

    const grid =
      board.sea.cells?.map((row) => [...row]) ??
      Array.from({ length: 10 }, () => Array<string | null>(10).fill(null));

    for (const ship of ships) {
      const spec = fleet.find((item) => item.id === ship.id);

      if (!spec) continue;

      for (const point of cells(ship, spec)) {
        if (point.row >= 0 && point.row < 10 && point.col >= 0 && point.col < 10)
          grid[point.row]![point.col] = ship.id;
      }
    }

    return {
      ...board,
      sea: { ...board.sea, ships, cells: grid, mines: board.sea.revealedMines ?? board.sea.mines },
    };
  });

  const costOf = (id: string) => knownValue(costs, id);

  const spendFor = (id: string | null) =>
    id && id !== "cannon" && can(id) ? (costOf(id) ?? 0) : 0;

  const spend = spendFor(hoverWeapon) || spendFor(currentWeapon);

  const playerTone = (playerId: string) =>
    Math.max(0, state.players?.findIndex((player) => player.id === playerId) ?? 0) % 2;

  const cellName = (row: number, col: number) => `${String.fromCharCode(65 + row)}${col + 1}`;

  const placementHeading = (
    <header className="ships-heading">
      <span className="ships-heading-tag">{t("board.ships.fleetPlacement")}</span>
      {!watching && (
        <span className="ships-heading-meta">
          {own?.ready ? fleet.length : draft.length}/{fleet.length} ships · {points} energy
        </span>
      )}
    </header>
  );

  return (
    <div
      ref={stageRef}
      data-silent
      data-watching={watching}
      data-result={finalResult}
      className="ships-stage"
      data-battle={!placement && !watching}
      data-placement={placement}
      data-weapon={currentWeapon}
    >
      <ShipDefs />
      {placement && (watching || own?.ready) && placementHeading}
      <div className="ships-content">
        {placement && !watching && !own?.ready && (
          <div className="fleet-tools">
            {placementHeading}
            <div className="fleet-picker" role="group" aria-label={t("board.ships.chooseShip")}>
              {fleet
                .filter((ship) => !draft.some((item) => item.id === ship.id))
                .map((ship, index) => {
                  const width = (Math.max(...ship.shape.map((cell) => cell.dc)) + 1) * 100;

                  const height = (Math.max(...ship.shape.map((cell) => cell.dr)) + 1) * 100;

                  return (
                    <Button
                      className="fleet-choice"
                      key={ship.id}
                      variant="secondary"
                      data-sound="place"
                      aria-pressed={selectedShip === ship.id}
                      aria-label={ship.shortName ?? ship.name}
                      disabled={!can("place_fleet")}
                      style={
                        { "--i": index } satisfies CSSProperties & {
                          [property: `--${string}`]: string | number | undefined;
                        }
                      }
                      onPointerDown={(event) => beginDrag(event, ship.id)}
                      onPointerMove={moveDrag}
                      onPointerUp={(event) => finishDrag(event)}
                      onPointerCancel={(event) => finishDrag(event, true)}
                      onLostPointerCapture={(event) => finishDrag(event, true)}
                      onClick={() => {
                        if (suppressClick.current) {
                          suppressClick.current = false;

                          return;
                        }

                        setSelectedShip(ship.id);
                      }}
                    >
                      <span className="fleet-choice-art" aria-hidden="true">
                        <svg viewBox={`0 0 ${width} ${height}`}>
                          <DoodleShip id={ship.id} row={0} col={0} rotation={0} />
                        </svg>
                      </span>
                      <span className="fleet-choice-text" aria-hidden="true">
                        <span className="fleet-choice-name">{ship.shortName ?? ship.name}</span>
                        <span className="fleet-choice-size">{ship.shape.length} cells</span>
                      </span>
                    </Button>
                  );
                })}
            </div>
            <p className="fleet-tools-hint">
              {selectedShip
                ? t("board.ships.tapGrid")
                : draft.length === fleet.length
                  ? t("board.ships.allPlaced")
                  : t("board.ships.pickShip")}
            </p>
          </div>
        )}
        {boards.length > 1 && (
          <div className="ship-grid-tabs" role="group" aria-label={t("board.ships.chooseGrid")}>
            {boards.map((board) => (
              <button
                type="button"
                key={board.id}
                className="ship-grid-tab"
                aria-pressed={tab === board.id}
                onClick={() => setTab(board.id)}
              >
                {board.title}
              </button>
            ))}
          </div>
        )}
        <div className="seas">
          {boards.map(({ sea, id, title }) => {
            const hits = new Set((sea.hits ?? sea.incomingHits ?? []).map(coordinate)),
              misses = new Set((sea.misses ?? sea.incomingMisses ?? []).map(coordinate));

            const wrecks = sea.sunkShips ?? sea.ships?.filter((ship) => ship.sunk) ?? [];

            const sinking = new Set(
              effects
                .filter((effect) => effect.board === id && effect.kind === "sunk")
                .map((effect) => effect.sunkShipId!),
            );

            const persistedRadarScans = sea.radarScans ?? [];

            const boardRadarScans =
              !watching && id === "target"
                ? radarScans
                : persistedRadarScans.slice(
                    0,
                    visibleRadarCounts[id] ?? persistedRadarScans.length,
                  );

            const showFleet =
              finalResult ||
              Boolean(state.replayReadOnly) ||
              (!watching && (id === "own" || placement));

            return (
              <section
                className="sea"
                data-board={id}
                data-selected={tab === id}
                key={id}
                aria-label={title}
              >
                {!watching && (
                  <header>
                    <h2>{title}</h2>
                    {!placement && (
                      <FleetStatus fleet={fleet} sunk={wrecks} remaining={sea.shipsRemaining} />
                    )}
                  </header>
                )}
                <div className="sea-fit">
                  <div
                    className="sea-grid"
                    role="group"
                    aria-label={
                      id === "target" && !placement && !watching
                        ? t("board.ships.targetGrid")
                        : title
                    }
                  >
                    <span className="sea-water" aria-hidden="true" />
                    <span className="sea-corner" aria-hidden="true" />
                    {Array.from({ length: 10 }, (_, i) => (
                      <span
                        className="sea-coordinate"
                        data-axis="col"
                        aria-hidden="true"
                        key={`column-${i}`}
                      >
                        {i + 1}
                      </span>
                    ))}
                    {Array.from({ length: 100 }, (_, index) => {
                      const row = Math.floor(index / 10),
                        col = index % 10,
                        pos = { row, col },
                        key = coordinate(pos);

                      const hit = hits.has(key),
                        miss = misses.has(key);

                      const placedShip =
                        placement && !watching && !own?.ready ? shipByCell.get(key) : undefined;

                      const ship =
                        showFleet &&
                        (placement && !watching && !own?.ready
                          ? occupied.has(key) && placedShip?.id !== movingShip
                          : Boolean(sea.cells?.[row]?.[col]));

                      const attackWeapon = currentWeapon;

                      const mineHere = Boolean(
                        sea.mines?.some((m) => m.row === row && m.col === col),
                      );

                      const validWeapon =
                        attackWeapon === "bomb"
                          ? row < 9 && col < 9
                          : attackWeapon === "torpedo"
                            ? row === 0 || row === 9 || col === 0 || col === 9
                            : true;

                      const actionable = placement
                        ? can("place_fleet") && !own?.ready
                        : id === "own"
                          ? currentWeapon === "mine" &&
                            can("mine") &&
                            !ship &&
                            !hit &&
                            !miss &&
                            !mineHere
                          : id === "target" &&
                            currentWeapon !== "mine" &&
                            can(attackWeapon) &&
                            validWeapon &&
                            (attackWeapon !== "cannon" || (!hit && !miss));

                      const label = `${cellName(row, col)}${hit ? ", hit" : miss ? ", miss" : ship ? ", ship" : mineHere ? ", mine" : ""}`;

                      return (
                        <Fragment key={index}>
                          {col === 0 && (
                            <span className="sea-coordinate" data-axis="row" aria-hidden="true">
                              {String.fromCharCode(65 + row)}
                            </span>
                          )}
                          <button
                            className="sea-cell"
                            data-row={row}
                            data-col={col}
                            style={
                              { "--r": row, "--c": col } satisfies CSSProperties & {
                                [property: `--${string}`]: string | number | undefined;
                              }
                            }
                            data-effect={
                              powerAim?.board === id && effectKeys.has(key)
                                ? effect?.valid
                                  ? "valid"
                                  : "invalid"
                                : undefined
                            }
                            data-drop={
                              previewKeys.has(key) ? (validDrop ? "valid" : "invalid") : undefined
                            }
                            disabled={!actionable}
                            data-hit={hit}
                            data-miss={miss}
                            data-mine-return={(sea.mineShots ?? sea.mineHits ?? []).some(
                              (point) => coordinate(point) === key,
                            )}
                            data-triggered-mine={sea.triggeredMines?.some(
                              (point) => coordinate(point) === key,
                            )}
                            data-ship={ship}
                            data-mine={mineHere}
                            aria-label={label}
                            title={label}
                            onPointerEnter={() => {
                              if (!dragRef.current) setHoveredShip(placedShip?.id ?? null);

                              if (
                                !placement &&
                                !powerDrag.current &&
                                currentWeapon !== "cannon" &&
                                id === (currentWeapon === "mine" ? "own" : "target")
                              )
                                setPowerAim({
                                  id: currentWeapon,
                                  board: id,
                                  point: pos,
                                });
                            }}
                            onPointerLeave={() => {
                              if (!dragRef.current) setHoveredShip(null);

                              if (!powerDrag.current) setPowerAim(null);
                            }}
                            onPointerDown={(event) => {
                              if (placedShip) beginDrag(event, placedShip.id, pos);
                            }}
                            onPointerMove={moveDrag}
                            onPointerUp={(event) => finishDrag(event)}
                            onPointerCancel={(event) => finishDrag(event, true)}
                            onLostPointerCapture={(event) => finishDrag(event, true)}
                            onClick={() => {
                              if (suppressClick.current) {
                                suppressClick.current = false;

                                return;
                              }

                              if (placement) {
                                if (placedShip) setSelectedShip(placedShip.id);
                                else place(pos);
                              } else {
                                send(
                                  id === "own" ? "mine" : attackWeapon,
                                  attackWeapon === "torpedo" && id === "target"
                                    ? {
                                        ...pos,
                                        direction:
                                          row === 0 ? "s" : row === 9 ? "n" : col === 0 ? "e" : "w",
                                      }
                                    : pos,
                                );
                                setWeapon("cannon");
                                setPowerAim(null);
                              }
                            }}
                          >
                            {hit ? (
                              <span className="sea-peg" aria-hidden="true" />
                            ) : miss ? (
                              <span className="sea-miss-peg" aria-hidden="true" />
                            ) : mineHere ? (
                              <span className="sea-mine" aria-hidden="true">
                                <MineArt />
                              </span>
                            ) : null}
                          </button>
                        </Fragment>
                      );
                    })}
                    {!placement && <WeaponTrails sea={sea} />}
                    {!placement && (
                      <div className="bombed-areas" role="group" aria-label={t("board.ships.bombedAreas")}>
                        {sea.bombedAreas?.map((area, index) => (
                          <span
                            key={index}
                            className="bombed-area"
                            role="img"
                            style={{
                              left: `${area.col * 10}%`,
                              top: `${area.row * 10}%`,
                            }}
                            aria-label={t("board.ships.bombedArea", {
                              cell: cellName(area.row, area.col),
                            })}
                          />
                        ))}
                      </div>
                    )}
                    {!placement && boardRadarScans.length > 0 && (
                      <RadarScans scans={boardRadarScans} />
                    )}
                    {!placement && (
                      <>
                        <SunkenFleet ships={wrecks} fleet={fleet} fresh={sinking} />
                        <BattleshipEffects effects={effects} board={id} />
                      </>
                    )}
                    {showFleet && (
                      <>
                        <DoodleFleet
                          ships={
                            placement && !watching && !own?.ready
                              ? draft.filter((ship) => ship.id !== movingShip)
                              : (sea.ships ?? []).filter((ship) => !ship.sunk)
                          }
                          highlighted={placement && !own?.ready ? hoveredShip : null}
                          fleet={fleet}
                          preview={
                            placement && !own?.ready && dropCell
                              ? {
                                  ...dropCell,
                                  id: selectedShip,
                                  rotation:
                                    draft.find((ship) => ship.id === selectedShip)?.rotation ?? 0,
                                }
                              : undefined
                          }
                          previewValid={validDrop}
                        />
                        {placement && !own?.ready && (
                          <div className="doodle-fleet fleet-handles">
                            {draft
                              .filter((ship) => ship.id !== movingShip)
                              .map((ship) => {
                                const spec = fleet.find((item) => item.id === ship.id);

                                if (!spec) return null;
                                const points = cells(ship, spec);

                                const col = Math.max(...points.map((p) => p.col)) + 1,
                                  row = Math.min(...points.map((p) => p.row));

                                return (
                                  <button
                                    type="button"
                                    className="ship-rotate-handle"
                                    data-active={hoveredShip === ship.id}
                                    onPointerEnter={() => setHoveredShip(ship.id)}
                                    onPointerLeave={() => setHoveredShip(null)}
                                    key={ship.id}
                                    style={{
                                      left: `${Math.min(97, col * 10)}%`,
                                      top: `${Math.max(3, row * 10)}%`,
                                    }}
                                    aria-label={t("board.ships.rotate", {
                                      ship: spec.shortName ?? spec.name,
                                    })}
                                    title={t("board.ships.rotateNinety")}
                                    data-sound="flip"
                                    disabled={!can("place_fleet")}
                                    onClick={() => rotateShip(ship)}
                                  >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path d="M19 9a8 8 0 1 0 1 7M19 3v6h-6" />
                                    </svg>
                                  </button>
                                );
                              })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {placement && !watching && !own?.ready && (
                    <Button
                      className="fleet-ready"
                      size="lg"
                      data-sound="success"
                      data-complete={fleet.length > 0 && draft.length === fleet.length}
                      disabled={
                        !can("place_fleet") || fleet.length === 0 || draft.length !== fleet.length
                      }
                      onClick={() => send("place_fleet", { ships: draft })}
                    >
                      {t("board.ships.ready")}
                    </Button>
                  )}
                </div>
                {watching && !finalResult && (
                  <FleetStatus column fleet={fleet} sunk={wrecks} remaining={sea.shipsRemaining} />
                )}
                {finalResult && (
                  <div className="result-ship-player">{renderResultPlayer?.(sea.playerId)}</div>
                )}
              </section>
            );
          })}
          {!placement && !watching && (
            <div className="ship-abilities">
              <EnergyMeter points={points} spend={spend} />
              <div className="ship-weapons" role="group" aria-label={t("board.ships.weapons")}>
                {weapons.map((item, index) => {
                  const cannon = item.id === "cannon";
                  const cost = costOf(item.id);

                  return (
                    <Button
                      key={item.id}
                      className={`weapon-card${cannon ? " ship-cannon" : ""}`}
                      data-weapon={item.id}
                      size="sm"
                      variant="secondary"
                      style={
                        { "--i": index } satisfies CSSProperties & {
                          [property: `--${string}`]: string | number | undefined;
                        }
                      }
                      title={t(item.hint)}
                      aria-pressed={currentWeapon === item.id}
                      disabled={!can(item.id)}
                      onPointerEnter={() => setHoverWeapon(item.id)}
                      onPointerLeave={() => setHoverWeapon(null)}
                      onPointerDown={cannon ? undefined : (event) => startPowerDrag(event, item.id)}
                      onPointerMove={cannon ? undefined : movePowerDrag}
                      onPointerUp={cannon ? undefined : (event) => finishPowerDrag(event)}
                      onPointerCancel={cannon ? undefined : (event) => finishPowerDrag(event, true)}
                      onLostPointerCapture={
                        cannon ? undefined : (event) => finishPowerDrag(event, true)
                      }
                      onClick={() => {
                        if (!cannon && suppressPowerClick.current) {
                          suppressPowerClick.current = false;

                          return;
                        }

                        setWeapon(item.id);
                        setPowerAim(null);
                        setTab(item.id === "mine" ? "own" : "target");
                      }}
                    >
                      <span className="weapon-glyph">
                        <WeaponIcon name={item.id} />
                      </span>
                      <span className="power-label">
                        <span className="power-name">{t(item.label)}</span>
                        <span className="power-description">{t(item.hint)}</span>
                      </span>
                      {cannon ? (
                        <span className="power-cost" data-free="true">
                          {t("board.ships.free")}
                        </span>
                      ) : (
                        <span
                          className="power-cost"
                          role="img"
                          aria-label={t("board.ships.energyCost", { cost: cost ?? "?" })}
                        >
                          <span className="power-cost-value" aria-hidden="true">
                            {cost ?? "?"}
                          </span>
                          {cost !== undefined && <CostPips cost={cost} />}
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
          {!placement && !watching && (
            <aside className="ship-game-log" aria-label={t("board.ships.gameLog")}>
              <div
                className="ship-log-content"
                tabIndex={0}
                role="region"
                aria-label={t("board.ships.recentMoves")}
              >
                <h3>{t("board.ships.gameLog")}</h3>
                {announcement && <p className="ship-log-announcement">{announcement}</p>}
                {shotLog.length ? (
                  <ol>
                    {[...shotLog].reverse().map((shot) => {
                      const player =
                        state.players?.find((entry) => entry.id === shot.byPlayerId)?.name ??
                        t("board.ships.somePlayer");

                      const weapon =
                        shot.weapon === "mine"
                          ? t("board.ships.logMineSuffix")
                          : shot.weapon === "bomb"
                            ? t("board.ships.logBombSuffix")
                            : shot.weapon === "torpedo"
                              ? t("board.ships.logTorpedoSuffix")
                              : "";

                      const result = shot.sunkShipId
                        ? t("board.ships.logSank")
                        : shot.hit
                          ? t("board.ships.logHit")
                          : t("board.ships.logMissed");

                      return (
                        <li
                          key={shot.sequence}
                          data-outcome={shot.sunkShipId ? "sunk" : shot.hit ? "hit" : "miss"}
                        >
                          <span
                            className="ship-log-player"
                            data-player={playerTone(shot.byPlayerId)}
                          >
                            {player}
                          </span>
                          {t("board.ships.logRest", { weapon, result })}
                          <strong>{cellName(shot.row, shot.col)}</strong>
                          {t("board.ships.logEnd")}
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  !announcement && <p className="ship-log-empty">{t("board.ships.noShots")}</p>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
      {powerGhost && (
        <div
          className="power-drag-ghost"
          data-weapon={powerGhost.id}
          style={{
            left: Math.max(8, Math.min(powerGhost.x + 16, window.innerWidth - 232)),
            top: Math.max(8, Math.min(powerGhost.y - 24, window.innerHeight - 64)),
          }}
          aria-hidden="true"
        >
          <WeaponIcon name={powerGhost.id} />
          <span>
            {powerGhost.id === "torpedo"
              ? t("board.ships.possiblePath")
              : powerGhost.id === "mine"
                ? t("board.ships.placeWaters")
                : powerGhost.id === "radar"
                  ? t("board.ships.scanArea")
                  : t("board.ships.blastArea")}
          </span>
        </div>
      )}
      <footer
        className="ship-notice"
        aria-live="polite"
        data-tone={placement && !own?.ready && notice ? "danger" : undefined}
      >
        {state.status === "ended"
          ? t("board.ships.matchFinished")
          : (placement && !own?.ready ? notice : "") ||
            announcement ||
            (placement && own?.ready ? t("board.ships.fleetLocked") : "")}
      </footer>
    </div>
  );
}
