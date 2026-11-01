import { useMemo, useState } from "react";
import { isNumber, type WireValue } from "@llmgames/game-catalog";
import { z } from "zod";

import type { ClientView } from "@/domain/game-state";
import { useT } from "@/i18n";
import { play } from "@/lib/sound";
import "./xiangqi.css";

/**
 * Chinese chess board.
 *
 * Pieces stand on the 90 intersections of a 9 × 10 grid, so the board is SVG
 * lines rather than a CSS grid: nine files, ten ranks, a river between ranks 4
 * and 5, and two 3 × 3 palaces. The geometry lives here; the rules do not —
 * `legal` arrives as ICCS pairs and is the only source of usable targets.
 *
 * Board index is rank * 9 + file: file 0 is 'a' on Red's left, rank 0 is Red's
 * back rank. Uppercase letters are Red, lowercase Black.
 */

const FILES = "abcdefghi";

const CELL = 40;

const MARGIN = 28;

const WIDTH = 8 * CELL + MARGIN * 2;

const HEIGHT = 9 * CELL + MARGIN * 2;

const RANKS = 10;

/** Characters a player sees, by piece letter and side. */
const GLYPHS = new Map<string, readonly [string, string]>([
  ["k", ["帥", "將"]],
  ["a", ["仕", "士"]],
  ["b", ["相", "象"]],
  ["n", ["馬", "馬"]],
  ["r", ["車", "車"]],
  ["c", ["炮", "砲"]],
  ["p", ["兵", "卒"]],
]);

const boardSchema = z.array(z.string()).catch([]);

const movesSchema = z.array(z.string()).catch([]);

const lastSchema = z
  .object({ from: z.number().optional(), to: z.number().optional(), text: z.string().optional() })
  .catch({});

const resultSchema = z.object({ winner: z.string().optional(), reason: z.string().optional() }).catch({});

const squareName = (index: number): string =>
  `${FILES.charAt(index % 9)}${Math.floor(index / 9)}`;

const squareIndex = (name: string): number | null => {
  const file = FILES.indexOf(name.slice(0, 1));
  const rank = Number(name.slice(1, 2));

  if (file < 0 || !Number.isInteger(rank) || rank < 0 || rank > 9) return null;

  return rank * 9 + file;
};

const x = (file: number): number => MARGIN + file * CELL;

const y = (rank: number): number => MARGIN + rank * CELL;

/** Targets per origin point, from the ICCS list the server sends. */
function legalTargets(legal: readonly string[]): Map<number, Set<number>> {
  const from = new Map<number, Set<number>>();

  for (const iccs of legal) {
    const start = squareIndex(iccs.slice(0, 2));
    const end = squareIndex(iccs.slice(2, 4));

    if (start === null || end === null) continue;

    const existing = from.get(start) ?? new Set<number>();

    existing.add(end);
    from.set(start, existing);
  }

  return from;
}

export function Xiangqi({ state, send }: { state: ClientView; send: (name: string, data: WireValue) => void }) {
  const t = useT();

  const board = boardSchema.parse(state.board);
  const legal = movesSchema.parse(state.legal);
  const last = lastSchema.parse(state.last);
  const result = resultSchema.parse(state.result);

  const [selected, setSelected] = useState<number | null>(null);

  const targets = useMemo(() => legalTargets(legal), [legal]);

  const readOnly = Boolean(state.you?.isSpectator || state.replayReadOnly);
  const seat = isNumber(state.you?.seat) ? state.you.seat : null;
  const yourSide = seat === 1 ? "r" : seat === 2 ? "b" : null;

  const live =
    !readOnly &&
    state.status === "playing" &&
    Boolean(state.you?.isYourTurn) &&
    (state.you?.legalActions ?? []).includes("move");

  // Black sees the board from its own end, the way the pieces are handed over.
  const flipped = yourSide === "b";

  /** Board file/rank to viewBox coordinates, mirrored for the side to move. */
  const sx = (file: number): number => (flipped ? x(8 - file) : x(file));

  const sy = (rank: number): number => (flipped ? y(rank) : y(RANKS - 1 - rank));

  const glyphAt = (index: number): string => {
    const piece = board[index] ?? "";

    if (piece === "") return "";

    const pair = GLYPHS.get(piece.toLowerCase());

    if (!pair) return "";

    return piece === piece.toUpperCase() ? pair[0] : pair[1];
  };

  const isRed = (piece: string): boolean => piece !== "" && piece === piece.toUpperCase();

  const checkSquare = isNumber(state.checkSquare) ? state.checkSquare : null;

  const hint = (() => {
    if (readOnly) return t("board.xiangqiWatching");

    if (state.status !== "playing") return t("board.xiangqiOver");

    if (!live) return t("board.xiangqiWaiting");

    return selected === null ? t("board.xiangqiPickPiece") : t("board.xiangqiPickPoint");
  })();

  const choose = (index: number) => {
    if (!live) return;

    const piece = board[index] ?? "";

    if (selected !== null && targets.get(selected)?.has(index)) {
      play("tap", { volume: 0.4 });
      send("move", { from: squareName(selected), to: squareName(index) });
      setSelected(null);

      return;
    }

    const mine = piece !== "" && isRed(piece) === (yourSide === "r");
    setSelected(mine && targets.has(index) ? index : null);
  };

  /** The 9 files and 10 ranks, with the river gap on the inner files. */
  const files = Array.from({ length: 9 }, (_, file) => {
    const top = file === 0 || file === 8 ? 0 : 4;

    if (file === 0 || file === 8)
      return <line key={`f${file}`} x1={x(file)} y1={y(0)} x2={x(file)} y2={y(9)} />;

    return (
      <g key={`f${file}`}>
        <line x1={x(file)} y1={y(0)} x2={x(file)} y2={y(top)} />
        <line x1={x(file)} y1={y(top + 1)} x2={x(file)} y2={y(9)} />
      </g>
    );
  });

  const ranks = Array.from({ length: RANKS }, (_, rank) => (
    <line key={`r${rank}`} x1={x(0)} y1={y(rank)} x2={x(8)} y2={y(rank)} />
  ));

  const points = Array.from({ length: 90 }, (_, index) => {
    const file = index % 9;
    const rank = Math.floor(index / 9);
    // Red sits at the bottom looking up the board, so its back rank (rank 0)
    // is drawn last. Black sees the same board turned around.
    const showX = sx(file);
    const showY = sy(rank);
    const piece = board[index] ?? "";
    const glyph = glyphAt(index);
    const reachable = selected !== null && Boolean(targets.get(selected)?.has(index));
    const mine = live && piece !== "" && isRed(piece) === (yourSide === "r");

    return (
      <g
        key={index}
        className="xq-point"
        data-selected={selected === index ? "true" : "false"}
        data-last={last.from === index || last.to === index ? "true" : "false"}
        data-check={checkSquare === index ? "true" : "false"}
        data-movable={mine && targets.has(index) ? "true" : "false"}
        onClick={() => choose(index)}
      >
        <circle className="xq-hit" cx={showX} cy={showY} r={CELL / 2} />
        {reachable ? <circle className="xq-dot" cx={showX} cy={showY} r={7} /> : null}
        {glyph === "" ? null : (
          <>
            <circle className="xq-piece" cx={showX} cy={showY} r={16} />
            <circle
              className="xq-piece-ring"
              cx={showX}
              cy={showY}
              r={16}
              data-side={isRed(piece) ? "r" : "b"}
            />
            <text className="xq-glyph" data-side={isRed(piece) ? "r" : "b"} x={showX} y={showY}>
              {glyph}
            </text>
          </>
        )}
      </g>
    );
  });

  return (
    <div className="xq-stage">
      <div className="xq-fit">
        <svg
          className="xq-board"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={t("board.xiangqiBoard")}
        >
          <rect className="xq-field" x={x(0) - 20} y={y(0) - 20} width={8 * CELL + 40} height={9 * CELL + 40} />
          <g className="xq-lines">
            {files}
            {ranks}
            {/* Palaces: both diagonals of each 3 × 3 box, mirrored with the board. */}
            <line x1={sx(3)} y1={sy(0)} x2={sx(5)} y2={sy(2)} />
            <line x1={sx(5)} y1={sy(0)} x2={sx(3)} y2={sy(2)} />
            <line x1={sx(3)} y1={sy(7)} x2={sx(5)} y2={sy(9)} />
            <line x1={sx(5)} y1={sy(7)} x2={sx(3)} y2={sy(9)} />
          </g>
          <text className="xq-river" x={WIDTH / 2} y={y(4.5) + 7}>
            {t("board.xiangqiRiver")}
          </text>
          {points}
        </svg>
      </div>

      <div className="xq-foot">
        <p className="xq-hint" data-check={state.check ? "true" : "false"}>
          {hint}
        </p>

        {last.text ? (
          <p className="xq-last">
            {t("board.xiangqiLastMove")} <b>{last.text}</b>
          </p>
        ) : null}

        {state.check ? <p className="xq-check">{t("board.xiangqiCheck")}</p> : null}

        {result.reason ? <p className="xq-result">{t("board.xiangqiEnded")}</p> : null}
      </div>
    </div>
  );
}
