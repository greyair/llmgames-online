import { DoodleShip } from "./DoodleShip";
import "./sunken-ships.css";

export type ShipFootprint = {
  id: string;
  name?: string;
  shortName?: string;
  "shape": { dr: number; dc: number }[];
};

export type SunkenShip = {
  id: string;
  row: number;
  col: number;
  rotation: number;
  sunk?: boolean;
  "shape"?: ShipFootprint["shape"];
};

export function FleetStatus({
  fleet,
  sunk,
  remaining,
  column = false,
}: {
  fleet: ShipFootprint[];
  sunk: SunkenShip[];
  remaining?: number;
  column?: boolean;
}) {
  const lost = new Set(sunk.map((ship) => ship.id));
  const afloat = remaining ?? fleet.length - lost.size;

  return (
    <div className="sea-fleet-summary" data-column={column}>
      <span className="sea-fleet-count">
        <strong>{afloat}</strong> afloat · <strong>{lost.size}</strong> sunk
      </span>
      <div className="sea-fleet-status" aria-label="Fleet status">
        {fleet.map((ship) => {
          const name = ship.shortName ?? ship.name ?? ship.id,
            status = lost.has(ship.id) ? "sunk" : "afloat";

          const width = (Math.max(...ship.shape.map((p) => p.dc)) + 1) * 100,
            height = (Math.max(...ship.shape.map((p) => p.dr)) + 1) * 100;

          return (
            <span
              key={ship.id}
              role="img"
              aria-label={`${name} ${status}`}
              title={`${name} ${status}`}
              data-sunk={lost.has(ship.id)}
            >
              <svg className="fleet-ship-art" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
                <DoodleShip id={ship.id} row={0} col={0} rotation={0} />
              </svg>
              {lost.has(ship.id) && (
                <svg className="fleet-sunk-cross" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Only server-revealed wrecks are drawn on enemy and spectator boards. */
export function SunkenFleet({
  ships,
  fleet,
  fresh,
}: {
  ships: SunkenShip[];
  fleet: ShipFootprint[];
  fresh: Set<string>;
}) {
  return (
    <svg className="doodle-fleet sunken-fleet" viewBox="0 0 1000 1000" aria-hidden="true">
      {ships.map((ship) => (
        <g key={ship.id} data-sunken-ship={ship.id} data-sinking={fresh.has(ship.id)}>
          <g className="wreck-hull">
            <DoodleShip {...ship} />
          </g>
          <path
            className="wreck-cross"
            d={wreckCells(ship, ship.shape ?? fleet.find((spec) => spec.id === ship.id)?.shape)
              .map(({ row, col }) => `M${col * 100 + 34} ${row * 100 + 34}l32 32m0-32-32 32`)
              .join("")}
          />
        </g>
      ))}
    </svg>
  );
}

function wreckCells(ship: SunkenShip, silhouette: ShipFootprint["shape"] = []) {
  return silhouette.map(({ dr, dc }) => {
    const [r, c] =
      ship.rotation === 90
        ? [dc, -dr]
        : ship.rotation === 180
          ? [-dr, -dc]
          : ship.rotation === 270
            ? [-dc, dr]
            : [dr, dc];

    return { row: ship.row + r, col: ship.col + c };
  });
}
