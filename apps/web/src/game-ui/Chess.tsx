import { useMemo, useState } from "react";
import { isNumber, type WireValue } from "@llmgames/game-catalog";
import { z } from "zod";

import type { ClientView } from "@/domain/game-state";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { play } from "@/lib/sound";
import "./chess.css";

/**
 * Chess board.
 *
 * The server owns the rules. `legal` arrives as UCI strings and is the only
 * source of selectable squares, so this file never decides that a bishop may
 * slide or that a king is allowed to castle — it reads a list and draws dots on
 * it. What the browser does own is the geometry: which square goes where, and
 * which way up the board is for the viewer.
 *
 * Board index order matches the server's FEN layout: 0 = a8, 7 = h8, 56 = a1,
 * 63 = h1. Uppercase letters are White, lowercase Black.
 */

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

const GLYPHS = new Map<string, string>([
  ["k", "♚"],
  ["q", "♛"],
  ["r", "♜"],
  ["b", "♝"],
  ["n", "♞"],
  ["p", "♟"],
]);

const PROMOTIONS = ["q", "r", "b", "n"] as const;

const boardSchema = z.string().catch("");

const movesSchema = z.array(z.string()).catch([]);

const lastSchema = z
  .object({ from: z.number().optional(), to: z.number().optional(), san: z.string().optional() })
  .catch({});

const capturedSchema = z.object({ w: z.string().optional(), b: z.string().optional() }).catch({});

const resultSchema = z.object({ winner: z.string().optional(), reason: z.string().optional() }).catch({});

const SIDE = 8;

const squareName = (index: number): string => `${FILES[index & 7]}${8 - (index >> 3)}`;

const squareIndex = (name: string): number | null => {
  const file = FILES.findIndex((candidate) => candidate === name.slice(0, 1));
  const rank = Number(name.slice(1, 2));

  if (file < 0 || !Number.isInteger(rank) || rank < 1 || rank > 8) return null;

  return (8 - rank) * 8 + file;
};

/** A move the board may offer from one square, with the promotions it allows. */
interface Targets {
  readonly to: Map<number, readonly string[]>;
}

function legalTargets(legal: readonly string[]): Map<number, Targets> {
  const from = new Map<number, Targets>();

  for (const uci of legal) {
    const start = squareIndex(uci.slice(0, 2));
    const end = squareIndex(uci.slice(2, 4));

    if (start === null || end === null) continue;

    const existing = from.get(start) ?? { to: new Map<number, readonly string[]>() };
    const promotions = existing.to.get(end) ?? [];
    const promotion = uci.slice(4);

    if (promotion) existing.to.set(end, [...promotions, promotion]);
    else if (!existing.to.has(end)) existing.to.set(end, promotions);

    from.set(start, existing);
  }

  return from;
}

export function Chess({
  state,
  send,
}: {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
}) {
  const t = useT();

  const board = boardSchema.parse(state.board);
  const legal = movesSchema.parse(state.legal);
  const last = lastSchema.parse(state.last);
  const captured = capturedSchema.parse(state.captured);
  const result = resultSchema.parse(state.result);

  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<{ from: number; to: number } | null>(null);

  const targets = useMemo(() => legalTargets(legal), [legal]);

  const readOnly = Boolean(state.you?.isSpectator || state.replayReadOnly);

  const seat = isNumber(state.you?.seat) ? state.you.seat : null;
  const yourColor = seat === 1 ? "w" : seat === 2 ? "b" : null;

  const live =
    !readOnly &&
    state.status === "playing" &&
    Boolean(state.you?.isYourTurn) &&
    (state.you?.legalActions ?? []).includes("move");

  // Black sees the board turned around, the way a real board is handed over.
  const flipped = yourColor === "b";

  const pieceAt = (index: number): string => board.charAt(index) || ".";

  const colorOf = (piece: string): "w" | "b" | null =>
    piece === "." || piece === "" ? null : piece === piece.toUpperCase() ? "w" : "b";

  const at = (display: number): number => (flipped ? SIDE * SIDE - 1 - display : display);

  const checkSquare = isNumber(state.checkSquare) ? state.checkSquare : null;

  const hint = (() => {
    if (readOnly) return t("board.chessWatching");

    if (state.status !== "playing") return t("board.chessOver");

    if (!live) return t("board.chessWaiting");

    if (pending) return t("board.chessPromote");

    return selected === null ? t("board.chessPickPiece") : t("board.chessPickSquare");
  })();

  const choose = (index: number) => {
    if (!live) return;

    const piece = pieceAt(index);

    if (selected !== null) {
      const options = targets.get(selected)?.to.get(index);

      if (options) {
        play("tap", { volume: 0.4 });

        if (options.length > 1) {
          setPending({ from: selected, to: index });

          return;
        }

        send("move", {
          from: squareName(selected),
          to: squareName(index),
          promotion: options[0],
        });
        setSelected(null);

        return;
      }
    }

    // Selecting another of your own pieces switches the selection; anything
    // else clears it.
    setSelected(colorOf(piece) === yourColor ? index : null);
    setPending(null);
  };

  const promote = (piece: string) => {
    if (!pending) return;

    play("tap", { volume: 0.4 });
    send("move", { from: squareName(pending.from), to: squareName(pending.to), promotion: piece });
    setPending(null);
    setSelected(null);
  };

  const squares = Array.from({ length: SIDE * SIDE }, (_, display) => {
    const index = at(display);
    const piece = pieceAt(index);
    const color = colorOf(piece);
    const dark = ((index >> 3) + (index & 7)) % 2 === 1;
    const reachable = selected !== null && Boolean(targets.get(selected)?.to.has(index));
    const movable = live && color === yourColor && targets.has(index);

    return (
      <button
        key={index}
        type="button"
        className="chess-square"
        data-dark={dark ? "true" : "false"}
        data-selected={selected === index ? "true" : "false"}
        data-last={last.from === index || last.to === index ? "true" : "false"}
        data-reachable={reachable ? "true" : "false"}
        data-check={checkSquare === index ? "true" : "false"}
        data-movable={movable ? "true" : "false"}
        aria-label={squareName(index)}
        disabled={!live || (!reachable && color !== yourColor)}
        onClick={() => choose(index)}
        onMouseDown={(event) => event.preventDefault()}
      >
        {piece === "." ? null : (
          <span className="chess-piece" data-color={color ?? "w"} aria-hidden="true">
            {GLYPHS.get(piece.toLowerCase()) ?? "?"}
          </span>
        )}
        {reachable ? <i className="chess-dot" aria-hidden="true" /> : null}
      </button>
    );
  });

  return (
    <div className="chess-stage">
      <div className="chess-fit">
        <div className="chess-tray">
          <div className="chess-taker" data-side="b">
            <span className="chess-taker-label">{t("board.chessTookBlack")}</span>
            <span className="chess-taken">
              {(captured.w ?? "").split("").map((piece, index) => (
                <i key={`${piece}${index}`} className="chess-taken-piece" data-color="b">
                  {GLYPHS.get(piece.toLowerCase()) ?? ""}
                </i>
              ))}
            </span>
          </div>
          <div className="chess-taker" data-side="w">
            <span className="chess-taker-label">{t("board.chessTookWhite")}</span>
            <span className="chess-taken">
              {(captured.b ?? "").split("").map((piece, index) => (
                <i key={`${piece}${index}`} className="chess-taken-piece" data-color="w">
                  {GLYPHS.get(piece.toLowerCase()) ?? ""}
                </i>
              ))}
            </span>
          </div>
        </div>

        <div className="chess-frame">
          <div className="chess-board" data-flipped={flipped ? "true" : "false"}>
            {squares}
          </div>
          <div className="chess-files" aria-hidden="true">
            {(flipped ? [...FILES].reverse() : [...FILES]).map((file) => (
              <span key={file}>{file}</span>
            ))}
          </div>
          <div className="chess-ranks" aria-hidden="true">
            {(flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1]).map((rank) => (
              <span key={rank}>{rank}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="chess-foot">
        <p className="chess-hint" data-check={state.check ? "true" : "false"}>
          {hint}
        </p>

        {last.san ? (
          <p className="chess-last">
            {t("board.chessLastMove")} <b>{last.san}</b>
          </p>
        ) : null}

        {state.check ? <p className="chess-check">{t("board.chessCheck")}</p> : null}

        {result.reason ? <p className="chess-result">{t("board.chessEnded")}</p> : null}

        {pending ? (
          <div className="chess-promote" role="group" aria-label={t("board.chessPromote")}>
            {PROMOTIONS.map((piece) => (
              <Button key={piece} size="sm" variant="outline" onClick={() => promote(piece)}>
                {GLYPHS.get(piece)}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              {t("board.chessCancel")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
