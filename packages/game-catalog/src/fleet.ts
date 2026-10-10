/** Coordinate rules sent alongside the agent fleet definitions. */
export const BATTLESHIP_FLEET_FORMAT =
  "Each shape lists occupied cell offsets {dr, dc} at rotation 0: dr is the row offset, dc the column offset. Coordinates are zero-based; rows increase downward and columns rightward. Place the shape origin (0,0) at anchor (row,col), even if the origin is not an occupied cell. Rotation is clockwise in degrees around that fixed anchor: 0 => (dr,dc), 90 => (dc,-dr), 180 => (-dr,-dc), 270 => (-dc,dr). Add each rotated offset to (row,col) to get its board cell. Do not shift or re-anchor after rotation; cells may extend above or left of the anchor. All occupied cells must stay on the board; ships may touch but cannot overlap.";

/** Occupied cells at rotation 0, relative to the placement anchor. */
export const BATTLESHIP_FLEET: {
  id: "carrier" | "dreadnought" | "cruiser" | "submarine" | "destroyer";
  name: string;
  shortName: string;
  length: number;
  "shape": { dr: number; dc: number }[];
}[] = [
  {
    id: "carrier",
    name: "Aircraft Carrier",
    shortName: "Carrier",
    length: 6,
    "shape": [
      { dr: 0, dc: 0 },
      { dr: 0, dc: 1 },
      { dr: 0, dc: 2 },
      { dr: 1, dc: 1 },
      { dr: 2, dc: 1 },
      { dr: 2, dc: 2 },
    ],
  },
  {
    id: "dreadnought",
    name: "Dreadnought",
    shortName: "Dreadnought",
    length: 5,
    "shape": [
      { dr: 0, dc: 0 },
      { dr: 0, dc: 1 },
      { dr: 1, dc: 1 },
      { dr: 1, dc: 2 },
      { dr: 2, dc: 1 },
    ],
  },
  {
    id: "cruiser",
    name: "Cruiser",
    shortName: "Cruiser",
    length: 4,
    "shape": [
      { dr: 0, dc: 0 },
      { dr: 0, dc: 1 },
      { dr: 0, dc: 2 },
      { dr: 1, dc: 0 },
    ],
  },
  {
    id: "submarine",
    name: "Submarine",
    shortName: "Submarine",
    length: 4,
    "shape": [
      { dr: 0, dc: 1 },
      { dr: 1, dc: 0 },
      { dr: 1, dc: 1 },
      { dr: 2, dc: 0 },
    ],
  },
  {
    id: "destroyer",
    name: "Destroyer",
    shortName: "Destroyer",
    length: 3,
    "shape": [
      { dr: 0, dc: 0 },
      { dr: 0, dc: 1 },
      { dr: 1, dc: 1 },
    ],
  },
];

/** Guaranteed legal layout used only if secure random placement exhausts its retries. */
export const BATTLESHIP_FALLBACK_FLEET: ReadonlyArray<{
  id: "carrier" | "dreadnought" | "cruiser" | "submarine" | "destroyer";
  row: number;
  col: number;
  rotation: 0 | 90 | 180 | 270;
}> = [
  { id: "carrier", row: 0, col: 0, rotation: 0 },
  { id: "dreadnought", row: 0, col: 4, rotation: 0 },
  { id: "cruiser", row: 4, col: 0, rotation: 0 },
  { id: "submarine", row: 4, col: 4, rotation: 0 },
  { id: "destroyer", row: 8, col: 0, rotation: 0 },
];
