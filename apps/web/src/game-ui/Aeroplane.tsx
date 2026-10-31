import { useState } from "react";
import { z } from "zod";

import type { WireValue } from "@llmgames/game-catalog";
import type { ClientView } from "@/domain/game-state";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { play } from "@/lib/sound";
import "./aeroplane.css";

/**
 * 飞行棋 (Aeroplane Chess) board.
 *
 * The server owns the dice and every rule: this component reads the projected
 * table, offers a roll or a plane only when the projection says it may, and
 * reports the intent. Where a plane would land is a display mirror of the rule
 * arithmetic (`landingFor`), used to draw a ghost — the board never decides
 * whether a move is legal, and the square a plane ends on is whatever the
 * server sends back.
 *
 * The 52 loop squares are the outline of a 15×15 cross: each arm is three cells
 * wide and six long, and the path runs clockwise around the outside with four
 * concave corners. Every fourth square belongs to the next colour, so a seated
 * colour's own jump squares are spread the whole way round the ring.
 */

const CELL = 32;

const MARGIN = 16;

const GRID = 15;

const VIEW = CELL * GRID + MARGIN * 2;

/** Progress values the board has to place. */
const HANGAR = -1;

const START = 0;

const LOOP = 52;

const ENTRY = 52;

const COLUMN_FIRST = 53;

const CENTRE = 59;

const COLOUR_COUNT = 4;

/** Progress of the fly-from square and the square it jumps to. */
const FLY_FROM = 20;

const FLY_TO = 32;

/** Centre of cell `index` in viewBox units. */
const at = (index: number) => MARGIN + index * CELL + CELL / 2;

/**
 * The 52 loop squares in clockwise order from the top arm's left corner.
 *
 * Global index `g` is the square a plane of colour `c` reaches at progress `p`
 * where `g = (13c + p - 1) mod 52`, so this array is the only thing that ties a
 * progress number to a place on the screen.
 */
const LOOP_CELLS: ReadonlyArray<readonly [number, number]> = [
  // Across the tip of the top arm.
  [0, 6],
  [0, 7],
  [0, 8],
  // Down the right side of the top arm.
  [1, 8],
  [2, 8],
  [3, 8],
  [4, 8],
  [5, 8],
  // Along the top of the right arm.
  [6, 9],
  [6, 10],
  [6, 11],
  [6, 12],
  [6, 13],
  [6, 14],
  // Round the right tip.
  [7, 14],
  [8, 14],
  // Back along the bottom of the right arm.
  [8, 13],
  [8, 12],
  [8, 11],
  [8, 10],
  [8, 9],
  // Down the right side of the bottom arm.
  [9, 8],
  [10, 8],
  [11, 8],
  [12, 8],
  [13, 8],
  // Across the tip of the bottom arm.
  [14, 8],
  [14, 7],
  [14, 6],
  // Up the left side of the bottom arm.
  [13, 6],
  [12, 6],
  [11, 6],
  [10, 6],
  [9, 6],
  // Along the bottom of the left arm.
  [8, 5],
  [8, 4],
  [8, 3],
  [8, 2],
  [8, 1],
  [8, 0],
  // Round the left tip.
  [7, 0],
  [6, 0],
  // Back along the top of the left arm.
  [6, 1],
  [6, 2],
  [6, 3],
  [6, 4],
  [6, 5],
  // Up the left side of the top arm, closing the loop.
  [5, 6],
  [4, 6],
  [3, 6],
  [2, 6],
  [1, 6],
];

/** The six home-column cells of each colour, arm tip inward. */
const HOME_COLUMNS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [1, 7],
    [2, 7],
    [3, 7],
    [4, 7],
    [5, 7],
    [6, 7],
  ],
  [
    [7, 13],
    [7, 12],
    [7, 11],
    [7, 10],
    [7, 9],
    [7, 8],
  ],
  [
    [13, 7],
    [12, 7],
    [11, 7],
    [10, 7],
    [9, 7],
    [8, 7],
  ],
  [
    [7, 1],
    [7, 2],
    [7, 3],
    [7, 4],
    [7, 5],
    [7, 6],
  ],
];

/** Where a plane waits before it takes off, one cell off its own loop start. */
const TAKEOFF_CELLS: ReadonlyArray<readonly [number, number]> = [
  [0, 5],
  [5, 14],
  [14, 9],
  [9, 0],
];

/** The four hangar slots of each colour, in its own corner of the cross. */
const HANGAR_CELLS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [2, 2],
    [2, 4],
    [4, 2],
    [4, 4],
  ],
  [
    [2, 12],
    [4, 12],
    [2, 10],
    [4, 10],
  ],
  [
    [12, 12],
    [12, 10],
    [10, 12],
    [10, 10],
  ],
  [
    [12, 2],
    [10, 2],
    [12, 4],
    [10, 4],
  ],
];

/** Top-left cell of each colour's hangar cluster, keyed by colour. */
const BASE_ORIGIN: ReadonlyArray<readonly [number, number]> = [
  [2, 2],
  [2, 10],
  [10, 10],
  [10, 2],
];

const COLOUR_TOKENS = ["red", "yellow", "blue", "green"] as const;

/** Small offsets so planes sharing a square stay individually visible. */
const STACK: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-5, -5],
  [5, -5],
  [-5, 5],
];

const DIE_PIPS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [],
  [[0, 0]],
  [
    [-1, -1],
    [1, 1],
  ],
  [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ],
  [
    [-1, -1],
    [-1, 1],
    [0, 0],
    [1, -1],
    [1, 1],
  ],
  [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ],
];

const numbersSchema = z.array(z.number()).catch([]);

const rowsSchema = z.array(z.array(z.number())).catch([]);

const rollSchema = z.number().nullable().catch(null);

function inkName(colour: number): string {
  return COLOUR_TOKENS[((colour % COLOUR_COUNT) + COLOUR_COUNT) % COLOUR_COUNT] ?? "red";
}

const ink = (colour: number) => `var(--palette-aero-${inkName(colour)})`;

const inkDeep = (colour: number) => `var(--palette-aero-${inkName(colour)}-deep)`;

function loopCell(colour: number, progress: number): readonly [number, number] {
  const index = (((13 * colour + progress - 1) % LOOP) + LOOP) % LOOP;

  return LOOP_CELLS[index] ?? [0, 6];
}

interface Placement {
  row: number;
  col: number;
  where: "hangar" | "takeoff" | "loop" | "runway" | "home";
}

function place(colour: number, progress: number, plane: number): Placement {
  if (progress === CENTRE) return { row: 7, col: 7, where: "home" };

  if (progress >= COLUMN_FIRST) {
    const cell = HOME_COLUMNS[colour]?.[progress - COLUMN_FIRST] ?? [7, 7];

    return { row: cell[0], col: cell[1], where: "runway" };
  }

  if (progress === START) {
    const cell = TAKEOFF_CELLS[colour] ?? [0, 5];

    return { row: cell[0], col: cell[1], where: "takeoff" };
  }

  if (progress >= 1) {
    const cell = loopCell(colour, progress);

    return { row: cell[0], col: cell[1], where: "loop" };
  }

  const cell = HANGAR_CELLS[colour]?.[plane - 1] ?? [2, 2];

  return { row: cell[0], col: cell[1], where: "hangar" };
}

/**
 * Display mirror of the server's move arithmetic.
 *
 * It answers "where would this roll put this plane?" so the board can draw a
 * ghost. Legality and the committed square both come from the server, so drift
 * here could only ever misplace a hover hint, never a plane. Own-colour squares
 * are every fourth step of the loop, so this needs no colour of its own.
 */
function landingFor(from: number, roll: number): number {
  let land = from + roll;

  if (land > CENTRE) land = 2 * CENTRE - land;

  if (land >= 1 && land <= LOOP && land % 4 === 0 && land !== ENTRY) {
    if (land === FLY_FROM) return FLY_TO;

    const jump = land + 4;

    return jump === FLY_FROM ? FLY_TO : jump;
  }

  return land;
}

interface Fleet {
  seat: number;
  plane: number;
  spot: Placement;
  offset: readonly [number, number];
}

export function Aeroplane({
  state,
  send,
}: {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
}) {
  const t = useT();

  const [hover, setHover] = useState<number | null>(null);

  const planes = rowsSchema.parse(state.planes);
  const colours = numbersSchema.parse(state.colours);
  const roll = rollSchema.parse(state.roll);

  const readOnly = Boolean(state.you?.isSpectator || state.replayReadOnly);
  const legal = state.you?.legalActions ?? [];
  const live = !readOnly && state.status === "playing" && Boolean(state.you?.isYourTurn);

  const canRoll = live && legal.includes("roll");
  const canLaunch = live && legal.includes("launch_plane");
  const canMove = live && legal.includes("move_plane");

  const seat = state.you?.seat ?? null;
  const colour = seat === null ? null : (colours[seat] ?? null);
  const mine = seat === null ? [] : (planes[seat] ?? []);

  // Which planes may be sent comes from legalActions, never from re-deriving
  // the take-off rule: the server is the only thing that knows the roll.
  const offered = mine.flatMap((progress, index) => {
    const plane = index + 1;

    if (progress === CENTRE) return [];

    if (progress === HANGAR) return canLaunch ? [plane] : [];

    return canMove ? [plane] : [];
  });

  const select = (plane: number) => {
    if (!offered.includes(plane)) return;

    play("move", { volume: 0.45 });

    send((mine[plane - 1] ?? HANGAR) === HANGAR ? "launch_plane" : "move_plane", { plane });
  };

  const hint = readOnly
    ? t("board.aeroplaneWatching")
    : canRoll
      ? t("board.aeroplaneTakeoffHint")
      : canLaunch || canMove
        ? t("board.aeroplaneChoose")
        : state.status === "playing"
          ? t("board.aeroplaneWaiting")
          : "";

  const ghost =
    hover !== null && offered.includes(hover) && colour !== null && roll !== null
      ? (() => {
          const from = mine[hover - 1] ?? HANGAR;

          return from === HANGAR
            ? place(colour, START, hover)
            : place(colour, landingFor(from, roll), hover);
        })()
      : null;

  const seated = new Set(colours);

  // Every plane of every seat, drawn in seat order so the mover sits on top.
  // Planes sharing a square are nudged apart so each one stays visible.
  const stacked = new Map<number, number>();

  const fleet: Fleet[] = planes.flatMap((row, rowSeat) =>
    row.map((progress, index) => {
      const spot = place(colours[rowSeat] ?? 0, progress, index + 1);
      const key = spot.row * GRID + spot.col;
      const seen = stacked.get(key) ?? 0;

      stacked.set(key, seen + 1);

      return { seat: rowSeat, plane: index + 1, spot, offset: STACK[seen] ?? STACK[0]! };
    }),
  );

  return (
    <div className="aeroplane-stage">
      <div className="aeroplane-fit">
        <svg
          className="aeroplane-svg"
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          role="img"
          aria-label={t("board.aeroplaneBoard")}
          data-readonly={readOnly ? "true" : "false"}
        >
          <rect
            x={MARGIN + 6 * CELL}
            y={MARGIN}
            width={3 * CELL}
            height={GRID * CELL}
            rx={12}
            fill="var(--palette-aero-board-deep)"
          />
          <rect
            x={MARGIN}
            y={MARGIN + 6 * CELL}
            width={GRID * CELL}
            height={3 * CELL}
            rx={12}
            fill="var(--palette-aero-board-deep)"
          />
          <rect
            x={MARGIN + 6 * CELL}
            y={MARGIN - 3}
            width={3 * CELL}
            height={GRID * CELL}
            rx={12}
            fill="var(--palette-aero-board)"
          />
          <rect
            x={MARGIN - 3}
            y={MARGIN + 6 * CELL}
            width={GRID * CELL}
            height={3 * CELL}
            rx={12}
            fill="var(--palette-aero-board)"
          />

          {/* One hangar pad per seated colour, sized to its four slots so the
              cross silhouette stays readable. */}
          {colours.map((value) => {
            const [row, col] = BASE_ORIGIN[value] ?? [2, 2];

            return (
              <rect
                key={`base${value}`}
                x={at(col) - CELL / 2 - 7}
                y={at(row) - CELL / 2 - 7}
                width={3 * CELL + 14}
                height={3 * CELL + 14}
                rx={16}
                fill={ink(value)}
                opacity={0.14}
              />
            );
          })}

          {/* The loop: one square per step, tinted for the colours in play. */}
          <g>
            {LOOP_CELLS.map(([row, col], index) => {
              const owner = (index + 1) % COLOUR_COUNT;

              return (
                <rect
                  key={`sq${index}`}
                  x={at(col) - CELL / 2 + 3}
                  y={at(row) - CELL / 2 + 3}
                  width={CELL - 6}
                  height={CELL - 6}
                  rx={6}
                  fill={seated.has(owner) ? ink(owner) : "var(--palette-aero-board-deep)"}
                  opacity={seated.has(owner) ? 0.42 : 0.5}
                />
              );
            })}
          </g>

          {/* Home runways: one strip per seated colour, from its arm tip to the
              centre. A single strip keeps the lane distinct from track steps. */}
          <g>
            {HOME_COLUMNS.map((cells, index) => {
              if (!seated.has(index)) return null;

              const rows = cells.map(([row]) => row);
              const cols = cells.map(([, col]) => col);
              const top = Math.min(...rows);
              const left = Math.min(...cols);

              return (
                <rect
                  key={`rw${index}`}
                  x={at(left) - CELL / 2 + 5}
                  y={at(top) - CELL / 2 + 5}
                  width={(Math.max(...cols) - left) * CELL + CELL - 10}
                  height={(Math.max(...rows) - top) * CELL + CELL - 10}
                  rx={9}
                  fill={ink(index)}
                  opacity={0.24}
                />
              );
            })}
          </g>

          <rect
            x={at(7) - CELL / 2 - 3}
            y={at(7) - CELL / 2 - 3}
            width={CELL + 6}
            height={CELL + 6}
            rx={10}
            fill="var(--palette-aero-centre)"
            stroke="var(--palette-aero-centre-deep)"
            strokeWidth="2"
          />

          {/* Take-off squares: one cell off each seated colour's loop start. */}
          <g>
            {TAKEOFF_CELLS.map(([row, col], index) =>
              seated.has(index) ? (
                <circle
                  key={`to${index}`}
                  cx={at(col)}
                  cy={at(row)}
                  r={CELL * 0.3}
                  fill="none"
                  stroke={inkDeep(index)}
                  strokeWidth="2.5"
                />
              ) : null,
            )}
          </g>

          {/* Each colour's fly line, from its step 20 across to step 32. */}
          <g strokeWidth="2" strokeDasharray="4 4" opacity="0.5">
            {colours.map((value) => (
              <line
                key={`fly${value}`}
                x1={at(loopCell(value, FLY_FROM)[1])}
                y1={at(loopCell(value, FLY_FROM)[0])}
                x2={at(loopCell(value, FLY_TO)[1])}
                y2={at(loopCell(value, FLY_TO)[0])}
                stroke={inkDeep(value)}
              />
            ))}
          </g>

          {ghost ? (
            <circle
              className="aeroplane-ghost"
              cx={at(ghost.col)}
              cy={at(ghost.row)}
              r={CELL * 0.32}
              fill="var(--palette-aero-board)"
              stroke={colour === null ? "none" : inkDeep(colour)}
              strokeWidth="2.5"
              opacity="0.75"
            />
          ) : null}

          <g className="aeroplane-fleet">
            {fleet.map((item) => {
              const value = colours[item.seat] ?? 0;
              const offeredPlane = item.seat === seat && offered.includes(item.plane);

              return (
                <g
                  key={`pl${item.seat}-${item.plane}`}
                  className="aeroplane-plane"
                  data-offered={offeredPlane ? "true" : "false"}
                  transform={`translate(${at(item.spot.col) + item.offset[0]} ${at(item.spot.row) + item.offset[1]})`}
                  onPointerEnter={() => setHover(offeredPlane ? item.plane : null)}
                  onPointerLeave={() => setHover(null)}
                  onClick={() => offeredPlane && select(item.plane)}
                >
                  <circle
                    r={CELL * 0.32}
                    fill={item.spot.where === "hangar" ? "var(--palette-aero-board)" : ink(value)}
                    stroke={inkDeep(value)}
                    strokeWidth={item.spot.where === "hangar" ? 2 : 2.5}
                    strokeDasharray={item.spot.where === "hangar" ? "3 3" : undefined}
                  />
                  <circle r={CELL * 0.11} fill={inkDeep(value)} />
                </g>
              );
            })}
          </g>
        </svg>

        <div className="aeroplane-bar">
          <span className="aeroplane-die" data-rolled={roll === null ? "false" : "true"}>
            {roll === null ? (
              <span aria-hidden="true">–</span>
            ) : (
              <svg
                viewBox="-10 -10 20 20"
                role="img"
                aria-label={t("board.aeroplaneDie", { value: roll })}
              >
                {DIE_PIPS[roll]?.map(([x, y], index) => (
                  <circle key={index} cx={x * 5} cy={y * 5} r="2.1" />
                ))}
              </svg>
            )}
          </span>

          {canRoll ? (
            <Button
              type="button"
              size="sm"
              className="aeroplane-roll"
              onClick={() => {
                play("move", { volume: 0.4 });
                send("roll", {});
              }}
            >
              {t("board.aeroplaneRollButton")}
            </Button>
          ) : (
            <p className="aeroplane-hint">{hint}</p>
          )}
        </div>
      </div>
    </div>
  );
}
