import { isNumericBoard, checkerMovesSchema } from "@/domain/view-contracts";
import type { WireValue } from "@llmgames/game-catalog";
import { isNumber } from "@llmgames/game-catalog";

import { useEffect, useRef, useState } from "react";
import type { ClientView } from "@/domain/game-state";
import { play } from "@/lib/sound";
import "./checkers.css";
import "./sketch/checkers.css";

function Crown() {
  return (
    <svg className="checker-crown" viewBox="0 0 10 9" aria-hidden="true">
      <path d="M0 1h1v1h1v1h1v-2h1v-1h2v1h1v2h1v-1h1v-1h1v6h-10zM1 7h8v2h-8z" />
    </svg>
  );
}

export function Checkers({
  state,
  send,
}: {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
}) {
  const [selection, setSelection] = useState<{ row: number; col: number; revision: string } | null>(
    null,
  );

  const board = state.board && isNumericBoard(state.board) ? state.board : [];
  const lastMove = state.lastMove ?? null;
  const moves = checkerMovesSchema.safeParse(state.legalMoves).data ?? [];

  const enabled =
    state.status === "playing" &&
    state.you?.isYourTurn &&
    !state.you?.isSpectator &&
    !state.replayReadOnly &&
    state.you?.legalActions?.includes("move_checker");

  const revision = JSON.stringify([state.lastMove, state.turnState?.currentPlayerId]);
  const forced = state.forcedPiece;
  const selected = forced ?? (selection?.revision === revision ? selection : null);

  const destinations = selected
    ? moves.filter((move) => move.fromRow === selected.row && move.fromCol === selected.col)
    : [];

  const captureRequired = moves.some((move) => move.capture);
  const readOnly = Boolean(state.you?.isSpectator || state.replayReadOnly);

  const hint =
    !readOnly && enabled
      ? forced
        ? "Keep jumping with the selected piece"
        : selected
          ? "Choose a marked destination"
          : captureRequired
            ? "A jump is available. Choose a piece that can capture."
            : "Choose a piece to move"
      : "";

  const boardRef = useRef<HTMLDivElement>(null);
  const previous = useRef({ room: state.roomCode, move: JSON.stringify(lastMove ?? null) });
  useEffect(() => {
    const key = JSON.stringify(lastMove ?? null),
      before = previous.current;

    previous.current = { room: state.roomCode, move: key };

    if (
      before.room !== state.roomCode ||
      before.move === key ||
      state.replayReadOnly ||
      !lastMove ||
      !Number.isInteger(lastMove.row) ||
      !Number.isInteger(lastMove.fromRow)
    )
      return;
    const root = boardRef.current;

    if (!root) return;

    const cell = (r: number, c: number) =>
      root.querySelector<HTMLElement>(`[data-row="${r}"][data-col="${c}"]`);

    const to = cell(lastMove.row!, lastMove.col!),
      from = cell(lastMove.fromRow!, lastMove.fromCol!),
      piece = to?.querySelector<HTMLElement>(".checker-piece");

    const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const animations: Animation[] = [],
      timers: number[] = [];

    const slide = motion ? 300 : 0;

    if (motion && to && from && piece) {
      const dx = from.offsetLeft - to.offsetLeft,
        dy = from.offsetTop - to.offsetTop;

      const hop = lastMove.capture ? -28 : -10;
      animations.push(
        piece.animate(
          [
            { transform: `translate(${dx}px,${dy}px) scale(1.08)`, zIndex: 5 },
            {
              transform: `translate(${dx / 2}px,${dy / 2}px) translateY(${hop}%) scale(1.16)`,
              zIndex: 5,
              offset: 0.5,
            },
            { transform: "translate(0,0) scale(1)", zIndex: 5 },
          ],
          { duration: slide, easing: "cubic-bezier(.3,.7,.3,1)" },
        ),
      );
    }

    if (lastMove.capture) {
      const captured = cell(lastMove.capture.row, lastMove.capture.col);
      timers.push(
        window.setTimeout(() => {
          play("capture");

          if (motion && captured)
            animations.push(
              captured.animate(
                [
                  { opacity: 1, transform: "scale(.4)" },
                  { opacity: 0.9, transform: "scale(1.25)", offset: 0.35 },
                  { opacity: 0, transform: "scale(1.6)" },
                ],
                { duration: 520, easing: "cubic-bezier(.22,1,.36,1)", pseudoElement: "::after" },
              ),
            );
        }, slide * 0.5),
      );
    } else timers.push(window.setTimeout(() => play("move"), slide * 0.85));

    if (lastMove.crowned)
      timers.push(
        window.setTimeout(() => {
          play("crown");
          const crown = piece?.querySelector<SVGElement>(".checker-crown");

          if (motion && crown)
            animations.push(
              crown.animate(
                [
                  { transform: "translateY(-60%) scale(.2) rotate(-25deg)", opacity: 0 },
                  { transform: "translateY(4%) scale(1.15) rotate(6deg)", opacity: 1, offset: 0.6 },
                  { transform: "none" },
                ],
                { duration: 520, easing: "cubic-bezier(.34,1.56,.64,1)" },
              ),
            );
        }, slide + 60),
      );

    return () => {
      animations.forEach((animation) => animation.cancel());
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [lastMove, state.roomCode, state.replayReadOnly]);

  const blackLeft = state.scores?.[1],
    whiteLeft = state.scores?.[2];

  const scored = isNumber(blackLeft) && isNumber(whiteLeft);
  const size = board.length || 8;

  return (
    <div className="checkers-stage" data-readonly={readOnly} data-scored={scored}>
      <div className="checkers-fit">
        <div className="checkers-table">
          <div className="checkers-frame">
            <span className="checkers-ranks" aria-hidden="true">
              {Array.from({ length: size }, (_, row) => (
                <span key={row}>{size - row}</span>
              ))}
            </span>
            <span className="checkers-files" aria-hidden="true">
              {Array.from({ length: size }, (_, col) => (
                <span key={col}>{String.fromCharCode(97 + col)}</span>
              ))}
            </span>
            <div
              ref={boardRef}
              className="checkers-board"
              role="group"
              aria-label="Checkers board"
              data-can-play={Boolean(enabled)}
              data-must-capture={Boolean(enabled && captureRequired && !selected)}
            >
              {board.flatMap((line, row) =>
                line.map((piece, col) => {
                  const source = moves.some((move) => move.fromRow === row && move.fromCol === col),
                    move = destinations.find((move) => move.row === row && move.col === col);

                  const active = selected?.row === row && selected.col === col;
                  const color = piece === 1 || piece === 3 ? "black" : "white";
                  const isLast = lastMove?.row === row && lastMove?.col === col;
                  const isFrom = lastMove?.fromRow === row && lastMove?.fromCol === col;
                  const label = `Row ${row + 1}, column ${col + 1}, ${piece ? `${color} ${piece > 2 ? "king" : "man"}` : "empty"}${enabled && move ? ", move here" : ""}`;

                  return (
                    <button
                      key={`${row}:${col}`}
                      type="button"
                      data-row={row}
                      data-col={col}
                      className="checkers-cell"
                      data-dark={(row + col) % 2 === 1}
                      data-source={Boolean(enabled && source)}
                      data-selected={Boolean(enabled && active)}
                      data-forced={Boolean(
                        enabled && forced && forced.row === row && forced.col === col,
                      )}
                      data-destination={Boolean(enabled && move)}
                      data-capture={Boolean(enabled && move?.capture)}
                      data-last-move={isLast}
                      data-last-from={isFrom}
                      aria-label={`${label}${isLast ? ", last move" : ""}`}
                      aria-pressed={Boolean(enabled && active)}
                      disabled={!enabled || (!source && !move)}
                      data-sound={move ? "none" : undefined}
                      onClick={() => {
                        if (move) {
                          send("move_checker", {
                            fromRow: move.fromRow,
                            fromCol: move.fromCol,
                            row,
                            col,
                          });
                          setSelection(null);
                        } else setSelection(active ? null : { row, col, revision });
                      }}
                    >
                      {piece ? (
                        <span className={`checker-piece checker-${color}`} data-king={piece > 2}>
                          {piece > 2 ? <Crown /> : <span className="checker-ring" />}
                        </span>
                      ) : enabled && move ? (
                        <span className="checker-destination" aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                }),
              )}
            </div>
          </div>
          {scored && (
            <aside className="checkers-tray" aria-label="Captured pieces">
              <CaptureStack taker="White" color="black" count={12 - blackLeft} />
              <CaptureStack taker="Black" color="white" count={12 - whiteLeft} />
            </aside>
          )}
        </div>
        <p className="checkers-caption" role={hint ? "status" : undefined} data-empty={!hint}>
          {hint}
        </p>
      </div>
    </div>
  );
}

function CaptureStack({
  taker,
  color,
  count,
}: {
  taker: string;
  color: "black" | "white";
  count: number;
}) {
  const taken = Math.max(0, Math.min(12, count));

  return (
    <div
      className="checkers-captured"
      aria-label={`${taker} has captured ${taken} ${color} ${taken === 1 ? "piece" : "pieces"}`}
      role="img"
    >
      <span className="checkers-captured-label">{taker} took</span>
      <strong>{taken}</strong>
      <span className="checkers-captured-stack" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <span
            key={index}
            className={`checkers-captured-man checker-${color}`}
            data-taken={index < taken}
          />
        ))}
      </span>
    </div>
  );
}
