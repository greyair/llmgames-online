import { isNumericBoard } from "@/domain/view-contracts";
import type { WireValue } from "@llmgames/game-catalog";
import { isNumber } from "@llmgames/game-catalog";
import { z } from "zod";

import { useState } from "react";
import type { ClientView } from "@/domain/game-state";
import { play } from "@/lib/sound";
import { useT } from "@/i18n";
import "./gomoku.css";

/**
 * Freestyle gomoku board.
 *
 * The server owns every rule: this component reads the projected grid, offers a
 * placement only when the projection says it may, and reports the intent. The
 * winning line is drawn from `winLine`, which the rule module sets — the board
 * never decides on its own that five stones are connected.
 */
const SIZE = 15;

/** SVG geometry in board units: 15 cells of 30 with a 30-unit frame margin. */
const CELL = 30;

const MARGIN = 30;

const SPAN = CELL * SIZE;

const VIEW = SPAN + MARGIN * 2;

/** Star points (hoshi) of a 15×15 board. */
const STARS: ReadonlyArray<readonly [number, number]> = [
  [3, 3],
  [3, 11],
  [11, 3],
  [11, 11],
  [7, 7],
];

const pointSchema = z.object({ row: z.number().int(), col: z.number().int() });

const winLineSchema = z.array(pointSchema).catch([]);

const at = (index: number) => MARGIN + index * CELL;

export function Gomoku({
  state,
  send,
}: {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
}) {
  const t = useT();

  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);

  const board = state.board && isNumericBoard(state.board) ? state.board : [];

  const lastMove = pointSchema.safeParse(state.lastMove).data ?? null;

  const winLine = winLineSchema.parse(state.winLine);

  const readOnly = Boolean(state.you?.isSpectator || state.replayReadOnly);

  const seat = isNumber(state.you?.seat) ? state.you.seat : null;

  const canPlace =
    !readOnly &&
    state.status === "playing" &&
    Boolean(state.you?.isYourTurn) &&
    (state.you?.legalActions ?? []).includes("place_stone");

  const stoneAt = (row: number, col: number) => board[row]?.[col] ?? 0;

  const place = (row: number, col: number) => {
    if (!canPlace || stoneAt(row, col) !== 0) return;

    play("move", { volume: 0.45 });

    send("place_stone", { row, col });
  };

  const hint = readOnly
    ? t("board.gomokuWatching")
    : canPlace
      ? t("board.gomokuYourTurn")
      : state.status === "playing"
        ? t("board.gomokuWaiting")
        : "";

  return (
    <div className="gomoku-stage">
      <div className="gomoku-fit">
        <svg
          className="gomoku-svg"
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          role="img"
          aria-label={t("board.gomokuBoard")}
          data-seat={seat ?? 0}
          data-readonly={readOnly ? "true" : "false"}
        >
          <defs>
            <radialGradient id="gomoku-black" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="var(--palette-gomoku-stone-black-light)" />
              <stop offset="100%" stopColor="var(--palette-gomoku-stone-black)" />
            </radialGradient>
            <radialGradient id="gomoku-white" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="var(--palette-gomoku-stone-white)" />
              <stop offset="100%" stopColor="var(--palette-gomoku-stone-white-deep)" />
            </radialGradient>
          </defs>

          <rect
            className="gomoku-board"
            x="0"
            y="0"
            width={VIEW}
            height={VIEW}
            rx="14"
            fill="var(--palette-gomoku-board)"
          />

          <g className="gomoku-grid" stroke="var(--palette-gomoku-line)" strokeWidth="1">
            {Array.from({ length: SIZE }, (_, index) => (
              <line key={`h${index}`} x1={at(0)} y1={at(index)} x2={at(SIZE - 1)} y2={at(index)} />
            ))}
            {Array.from({ length: SIZE }, (_, index) => (
              <line key={`v${index}`} x1={at(index)} y1={at(0)} x2={at(index)} y2={at(SIZE - 1)} />
            ))}
          </g>

          <g className="gomoku-stars" fill="var(--palette-gomoku-star)">
            {STARS.map(([row, col]) => (
              <circle key={`s${row}-${col}`} cx={at(col)} cy={at(row)} r="3.4" />
            ))}
          </g>

          {board.map((line, row) =>
            line.map((cell, col) =>
              cell === 0 ? null : (
                <circle
                  key={`c${row}-${col}`}
                  className="gomoku-stone"
                  cx={at(col)}
                  cy={at(row)}
                  r={CELL * 0.45}
                  fill={cell === 1 ? "url(#gomoku-black)" : "url(#gomoku-white)"}
                  stroke={cell === 1 ? "transparent" : "var(--palette-gomoku-stone-white-deep)"}
                  strokeWidth="0.6"
                />
              ),
            ),
          )}

          {winLine.length > 1 ? (
            <line
              className="gomoku-win"
              x1={at(winLine[0]!.col)}
              y1={at(winLine[0]!.row)}
              x2={at(winLine[winLine.length - 1]!.col)}
              y2={at(winLine[winLine.length - 1]!.row)}
              stroke="var(--palette-gomoku-win)"
              strokeWidth="5"
              strokeLinecap="round"
              opacity="0.75"
            />
          ) : null}

          {lastMove ? (
            <circle
              className="gomoku-last"
              cx={at(lastMove.col)}
              cy={at(lastMove.row)}
              r="3.2"
              fill="var(--palette-gomoku-mark)"
            />
          ) : null}

          {canPlace && hover && stoneAt(hover.row, hover.col) === 0 ? (
            <circle
              className="gomoku-ghost"
              cx={at(hover.col)}
              cy={at(hover.row)}
              r={CELL * 0.45}
              fill={seat === 1 ? "var(--palette-gomoku-stone-black)" : "var(--palette-gomoku-stone-white)"}
              opacity="0.35"
            />
          ) : null}

          <g className="gomoku-points">
            {Array.from({ length: SIZE * SIZE }, (_, index) => {
              const row = Math.floor(index / SIZE);
              const col = index % SIZE;

              return (
                <circle
                  key={`p${row}-${col}`}
                  className="gomoku-point"
                  data-row={row}
                  data-col={col}
                  cx={at(col)}
                  cy={at(row)}
                  r={CELL * 0.5}
                  fill="transparent"
                  onClick={() => place(row, col)}
                  onPointerEnter={() => setHover({ row, col })}
                  onPointerLeave={() => setHover(null)}
                />
              );
            })}
          </g>
        </svg>
        {hint ? <p className="gomoku-hint">{hint}</p> : null}
      </div>
    </div>
  );
}
