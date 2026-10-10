import { knownValue } from "@/domain/view-contracts";
import { isNumericBoard, discMovesSchema } from "@/domain/view-contracts";
import type { WireValue } from "@llmgames/game-catalog";
import { isNumber } from "@llmgames/game-catalog";

import { useEffect, useRef, type CSSProperties } from "react";
import type { ClientView } from "@/domain/game-state";
import { play } from "@/lib/sound";
import "./discs.css";
import "./sketch/discs.css";

function winningFour(board: number[][], move: { row?: number; col?: number } | null) {
  if (!Number.isInteger(move?.row) || !Number.isInteger(move?.col))
    return new Map<string, number>();

  const row = move!.row!,
    col = move!.col!,
    piece = board[row]?.[col];

  if (!piece) return new Map<string, number>();

  for (const [dr, dc] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]) {
    const line: Array<[number, number]> = [];

    for (let step = -3; step <= 3; step++) {
      const r = row + dr! * step,
        c = col + dc! * step;

      if (board[r]?.[c] === piece) line.push([r, c]);
      else if (step < 0) line.length = 0;
      else break;
    }

    if (line.length >= 4)
      return new Map(line.slice(0, 4).map(([r, c], index) => [`${r}:${c}`, index]));
  }

  return new Map<string, number>();
}

const DISC_COLOR = {
  reversi1: "var(--disc-black)",
  reversi2: "var(--disc-white)",
} satisfies Record<string, string>;

export function Discs({
  state,
  send,
}: {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
}) {
  const reversi = state.type === "reversi",
    action = reversi ? "place_disc" : "drop_disc";

  const readOnly = Boolean(state.you?.isSpectator || state.replayReadOnly);

  const enabled =
    state.status === "playing" &&
    state.you?.isYourTurn &&
    !readOnly &&
    state.you?.legalActions?.includes(action);

  const board = state.board && isNumericBoard(state.board) ? state.board : [];

  const boardRef = useRef<HTMLDivElement>(null),
    previous = useRef({ room: state.roomCode, board });

  const ownDrop = useRef(0);
  const lastMove = state.lastMove ?? null;

  const winning =
    state.status === "ended" && !reversi && state.winner && state.winner !== "draw"
      ? winningFour(board, lastMove)
      : new Map<string, number>();

  const seatIndex = state.players?.findIndex((player) => player.id === state.you?.playerId) ?? -1;
  const seat = state.you?.seat ?? (seatIndex >= 0 ? seatIndex + 1 : 1);
  useEffect(() => {
    const before = previous.current;
    previous.current = { room: state.roomCode, board };

    if (before.room !== state.roomCode || state.replayReadOnly || before.board === board) return;

    const placed: Array<[number, number]> = [],
      flipped: Array<[number, number]> = [];

    board.forEach((row, r) =>
      row.forEach((piece, c) => {
        const old = before.board[r]?.[c];

        if (!piece || old === undefined || old === piece) return;
        (old === 0 ? placed : flipped).push([r, c]);
      }),
    );

    // More than one new disc means a reconnect or catch-up snapshot, not a single move.
    if (placed.length !== 1) return;
    const [pr, pc] = placed[0]!;
    const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const cellAt = (r: number, c: number) =>
      boardRef.current?.querySelector<HTMLElement>(`[data-row="${r}"][data-col="${c}"]`);

    const animations: Animation[] = [],
      timers: number[] = [];

    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

    if (!reversi) {
      const cell = cellAt(pr, pc),
        disc = cell?.querySelector<HTMLElement>(".playing-disc");

      const mine = performance.now() - ownDrop.current < 4000;
      ownDrop.current = 0;

      if (!mine) play("drop", { volume: 0.55 });
      const duration = motion ? Math.round(300 + Math.sqrt(pr + 1) * 110) : 0;

      if (motion && cell && disc) {
        const fall = cell.offsetTop + cell.offsetHeight * 1.1;
        animations.push(
          disc.animate(
            [
              // The disc falls in row-sized steps so it reads as pixels snapping, not a tween.
              { transform: `translateY(${-fall}px)`, easing: `steps(${(pr + 2) * 2},end)` },
              { transform: "translateY(0)", offset: 0.68, easing: "steps(2,end)" },
              { transform: "translateY(-14%)", offset: 0.82, easing: "steps(2,end)" },
              { transform: "translateY(0)", offset: 0.92 },
              { transform: "translateY(-4%)", offset: 0.96 },
              { transform: "translateY(0)" },
            ],
            { duration, fill: "backwards" },
          ),
        );
      }

      later(duration * 0.68, () => play("land", { pitch: 1 - pr * 0.025 }));
    } else {
      const placedDisc = cellAt(pr, pc)?.querySelector<HTMLElement>(".playing-disc");
      play("place");

      if (motion && placedDisc)
        animations.push(
          placedDisc.animate(
            [
              { transform: "scale(.35)", opacity: 0 },
              { transform: "scale(1.12)", opacity: 1, offset: 0.6 },
              { transform: "scale(1)" },
            ],
            { duration: 300, easing: "steps(5,end)" },
          ),
        );
      flipped
        .map(([r, c]) => ({ r, c, distance: Math.max(Math.abs(r - pr), Math.abs(c - pc)) }))
        .sort((a, b) => a.distance - b.distance)
        .forEach(({ r, c, distance }, index) => {
          const delay = 120 + distance * 85 + index * 10;
          const disc = cellAt(r, c)?.querySelector<HTMLElement>(".playing-disc");

          const from = knownValue(DISC_COLOR, `reversi${board[r]![c] === 1 ? 2 : 1}`)!,
            to = knownValue(DISC_COLOR, `reversi${board[r]![c]}`)!;

          if (motion && disc)
            animations.push(
              disc.animate(
                [
                  { transform: "scaleX(1)", backgroundColor: from },
                  { transform: "scaleX(0)", backgroundColor: from, offset: 0.5 },
                  { transform: "scaleX(0)", backgroundColor: to, offset: 0.5 },
                  { transform: "scaleX(1)", backgroundColor: to },
                ],
                { duration: 360, delay, easing: "steps(6,end)", fill: "backwards" },
              ),
            );

          if (index < 12)
            later(delay + 150, () =>
              play("flip", { pitch: 1 + index * 0.06, volume: Math.max(0.45, 1 - index * 0.05) }),
            );
        });
    }

    return () => {
      animations.forEach((animation) => animation.cancel());
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [board, reversi, state.roomCode, state.replayReadOnly]);

  const flips = new Map(
    discMovesSchema
      .safeParse(state.legalMoves)
      .data?.map((move) => [`${move.row}:${move.col}`, move.flipCount]),
  );

  const columns = reversi ? 8 : 7,
    rows = board.length || (reversi ? 8 : 6);

  const ghost = reversi
    ? seat === 2
      ? "var(--disc-white)"
      : "var(--disc-black)"
    : seat === 2
      ? "var(--disc-yellow)"
      : "var(--disc-red)";

  const ghostInk = reversi
    ? seat === 2
      ? "var(--disc-black)"
      : "var(--disc-white)"
    : "var(--palette-ink)";

  const cells = board.flatMap((row, r) =>
    row.map((piece, c) => {
      const isLast = lastMove?.row === r && lastMove?.col === c;
      const isLegal = Boolean(enabled && flips.has(`${r}:${c}`));
      const flipCount = flips.get(`${r}:${c}`);
      const label = `Row ${r + 1}, column ${c + 1}, ${piece === 0 ? "empty" : reversi ? (piece === 1 ? "black" : "white") : piece === 1 ? "red" : "yellow"}${isLast ? ", last move" : ""}${isLegal && isNumber(flipCount) ? `, legal move, flips ${flipCount}` : ""}`;

      if (reversi)
        return (
          <button
            key={`${r}:${c}`}
            type="button"
            data-row={r}
            data-col={c}
            data-last-move={isLast}
            aria-label={label}
            disabled={!isLegal}
            data-sound="none"
            className="discs-cell"
            data-legal={isLegal}
            data-empty={piece === 0}
            onClick={() => send(action, { row: r, col: c })}
          >
            <span className={`playing-disc piece-${piece}`}>
              {piece === 0 && isLegal ? (
                <span className="legal-plus" aria-hidden="true">
                  {isNumber(flipCount) && <span className="legal-count">+{flipCount}</span>}
                </span>
              ) : null}
            </span>
          </button>
        );
      const win = winning.has(`${r}:${c}`);

      return (
        <div
          key={`${r}:${c}`}
          role="img"
          data-row={r}
          data-col={c}
          data-last-move={isLast}
          data-winning={win}
          style={
            win
              ? ({ "--win-order": winning.get(`${r}:${c}`) } satisfies CSSProperties & {
                  [property: `--${string}`]: string | number | undefined;
                })
              : undefined
          }
          aria-label={`${label}${win ? ", winning four" : ""}`}
          className="discs-cell"
        >
          <span className={`playing-disc piece-${piece}`} />
        </div>
      );
    }),
  );

  if (reversi) {
    const black = state.scores?.[1],
      white = state.scores?.[2];

    const scored = isNumber(black) && isNumber(white);
    const share = scored && black + white > 0 ? (black / (black + white)) * 100 : 50;
    const pass = state.lastPass ? state.lastAnnouncement : undefined;

    const files = Array.from({ length: columns }, (_, c) => String.fromCharCode(97 + c)),
      ranks = Array.from({ length: rows }, (_, r) => r + 1);

    return (
      <div
        data-readonly={readOnly}
        className="discs-stage is-reversi"
        data-scored={scored}
        style={
          {
            "--cols": columns,
            "--rows": rows,
            "--ghost": ghost,
            "--ghost-ink": ghostInk,
            "--black-share": `${share}%`,
          } satisfies CSSProperties & { [property: `--${string}`]: string | number | undefined }
        }
      >
        <div className="discs-fit" data-can-play={Boolean(enabled)}>
          {scored && (
            <div
              className="reversi-score"
              role="img"
              aria-label={`Black ${black} discs, white ${white} discs`}
            >
              <span className="reversi-score-side is-black">
                <span className="reversi-score-disc piece-1" aria-hidden="true" />
                <strong>{black}</strong>
              </span>
              <span className="reversi-score-bar" aria-hidden="true">
                <span />
              </span>
              <span className="reversi-score-side is-white">
                <strong>{white}</strong>
                <span className="reversi-score-disc piece-2" aria-hidden="true" />
              </span>
            </div>
          )}
          <div className="discs-board-wrap reversi-frame">
            <span className="reversi-files" aria-hidden="true">
              {files.map((file) => (
                <span key={file}>{file}</span>
              ))}
            </span>
            <span className="reversi-ranks" aria-hidden="true">
              {ranks.map((rank) => (
                <span key={rank}>{rank}</span>
              ))}
            </span>
            <div
              ref={boardRef}
              className="discs-board"
              data-can-play={Boolean(enabled)}
              role="group"
              aria-label="Reversi board"
            >
              {cells}
              <span className="reversi-stars" aria-hidden="true" />
            </div>
          </div>
          {!readOnly && (
            <p className="discs-caption" role={pass ? "status" : undefined} data-empty={!pass}>
              {pass}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-readonly={readOnly}
      className="discs-stage is-connect4"
      style={
        {
          "--cols": columns,
          "--rows": rows,
          "--ghost": ghost,
          "--ghost-deep": seat === 2 ? "var(--disc-yellow-deep)" : "var(--disc-red-deep)",
        } satisfies CSSProperties & { [property: `--${string}`]: string | number | undefined }
      }
    >
      <div className="discs-fit" data-can-play={Boolean(enabled)}>
        {!readOnly && (
          <div className="discs-actions">
            {Array.from({ length: 7 }, (_, col) => (
              <button
                type="button"
                key={col}
                className="discs-column"
                data-sound="drop"
                aria-label={`Drop in column ${col + 1}`}
                disabled={!enabled || board[0]?.[col] !== 0}
                onClick={() => {
                  ownDrop.current = performance.now();
                  send(action, { col });
                }}
              >
                <span className="discs-ghost" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        <div className="discs-board-wrap c4-cabinet">
          <div
            ref={boardRef}
            className="discs-board"
            data-can-play={Boolean(enabled)}
            data-has-win={winning.size > 0}
            role="group"
            aria-label="Connect 4 board"
          >
            {cells}
          </div>
          <span className="discs-frame" aria-hidden="true">
            <span className="c4-hi" />
            <span className="c4-rim" />
          </span>
          <span className="c4-foot is-left" aria-hidden="true" />
          <span className="c4-foot is-right" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
