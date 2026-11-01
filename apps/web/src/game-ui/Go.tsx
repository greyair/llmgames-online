import { useMemo, useState } from "react";
import { isNumber, type WireValue } from "@llmgames/game-catalog";
import { z } from "zod";

import type { ClientView } from "@/domain/game-state";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { play } from "@/lib/sound";
import { GO_CELL, goExtent, goPointAt, goStars } from "./goGeometry";
import "./go.css";

/**
 * Go board.
 *
 * Stones sit on the intersections of a 9×9, 13×13 or 19×19 grid — the size
 * comes from `state.boardSize`, because `go.size` is a room option. The server
 * sends the legality of every empty point as GTP names, so this file never
 * decides whether a move would be suicide or would repeat a position — it
 * draws a dot where the server allows one. What it does own is the geometry:
 * the viewBox and the star points both follow the size.
 */

const COLUMNS = "ABCDEFGHJKLMNOPQRST";

const cellsSchema = z.array(z.number()).catch([]);

const numbersSchema = z.array(z.number()).catch([]);

const legalSchema = z.array(z.string()).catch([]);

const at = goPointAt;

const gtpOf = (point: number, size: number): string =>
  `${COLUMNS.charAt(point % size)}${size - Math.floor(point / size)}`;

export function Go({ state, send }: { state: ClientView; send: (name: string, data: WireValue) => void }) {
  const t = useT();

  const cells = cellsSchema.parse(state.cells);
  const legal = legalSchema.parse(state.legal);
  const dead = numbersSchema.parse(state.dead);
  const accepted = numbersSchema.parse(state.accepted);
  const captures = numbersSchema.parse(state.captures);

  const size = isNumber(state.boardSize) ? state.boardSize : 9;
  const view = goExtent(size);
  const stars = goStars(size);
  const stage = state.stage ?? "playing";

  const [hover, setHover] = useState<number | null>(null);

  const readOnly = Boolean(state.you?.isSpectator || state.replayReadOnly);
  const seat = isNumber(state.you?.seat) ? state.you.seat : null;
  const yourColor = seat === 1 ? 1 : seat === 2 ? 2 : null;
  const live = !readOnly && state.status === "playing";

  const legalSet = useMemo(() => new Set(legal), [legal]);
  const deadSet = useMemo(() => new Set(dead), [dead]);

  const mayPlay = live && stage === "playing" && state.turn === yourColor && seat !== null;
  const mayScore = live && stage === "scoring" && seat !== null;

  const score = state.score ?? null;

  const hint = (() => {
    if (readOnly) return t("board.goWatching");

    if (state.status !== "playing") return t("board.goOver");

    if (stage === "scoring") return t("board.goScoring");

    if (!mayPlay) return t("board.goWaiting");

    return t("board.goPrompt");
  })();

  const toggleDead = (point: number) => {
    if (!mayScore) return;

    play("tap", { volume: 0.35 });
    send("mark_dead", { point: gtpOf(point, size) });
  };

  const place = (point: number) => {
    if (stage === "scoring") {
      if ((cells[point] ?? 0) !== 0) toggleDead(point);

      return;
    }

    if (!mayPlay) return;

    if (!legalSet.has(gtpOf(point, size))) return;

    play("tap", { volume: 0.4 });
    send("place_go_stone", { point: gtpOf(point, size) });
  };

  const stones = Array.from({ length: size * size }, (_, point) => {
    const x = at(point % size);
    const y = at(Math.floor(point / size));
    const cell = cells[point] ?? 0;
    const open = cell === 0 && mayPlay && legalSet.has(gtpOf(point, size));
    const marked = deadSet.has(point);
    const showGhost = open && hover === point;

    return (
      <g
        key={point}
        className="go-point"
        data-open={open ? "true" : "false"}
        data-dead={marked ? "true" : "false"}
        onClick={() => place(point)}
        onMouseEnter={() => setHover(point)}
        onMouseLeave={() => setHover(null)}
      >
        <circle className="go-hit" cx={x} cy={y} r={GO_CELL / 2} />
        {showGhost ? (
          <circle className="go-ghost" cx={x} cy={y} r={16} data-color={yourColor ?? 1} />
        ) : null}
        {cell === 0 ? null : (
          <>
            <circle className="go-stone" cx={x} cy={y} r={16} data-color={cell} data-dead={marked ? "true" : "false"} />
            {marked ? (
              <g className="go-cross">
                <line x1={x - 6} y1={y - 6} x2={x + 6} y2={y + 6} />
                <line x1={x + 6} y1={y - 6} x2={x - 6} y2={y + 6} />
              </g>
            ) : null}
          </>
        )}
      </g>
    );
  });

  return (
    <div className="go-stage">
      <div className="go-fit">
        <svg className="go-board" viewBox={`0 0 ${view} ${view}`} role="img" aria-label={t("board.goBoard")}>
          <rect className="go-field" x={4} y={4} width={view - 8} height={view - 8} rx={6} />
          <g className="go-lines">
            {Array.from({ length: size }, (_, index) => (
              <g key={index}>
                <line x1={at(0)} y1={at(index)} x2={at(size - 1)} y2={at(index)} />
                <line x1={at(index)} y1={at(0)} x2={at(index)} y2={at(size - 1)} />
              </g>
            ))}
          </g>
          {stars.map(([x, y]) => (
            <circle key={`${x}-${y}`} className="go-star" cx={at(x)} cy={at(y)} r={2.6} />
          ))}
          {stones}
        </svg>
      </div>

      <div className="go-foot">
        <p className="go-hint">{hint}</p>

        <p className="go-tally">
          <span data-color="1">● {captures[1] ?? 0}</span>
          <span data-color="2">○ {captures[2] ?? 0}</span>
          <span className="go-komi">{t("board.goKomi")} {state.komi ?? 7.5}</span>
        </p>

        {stage === "scoring" ? (
          <p className="go-accepted">
            {t("board.goAccepted")}{" "}
            {accepted.length === 0
              ? t("board.goNobody")
              : accepted.map((color) => (color === 1 ? t("board.goBlack") : t("board.goWhite"))).join("、")}
          </p>
        ) : null}

        {score === null ? null : (
          <p className="go-score">
            {t("board.goScore")} {score.black ?? 0} : {score.white ?? 0}
          </p>
        )}

        <div className="go-actions">
          {mayPlay ? (
            <>
              <Button size="sm" variant="outline" onClick={() => send("pass_turn", {})}>
                {t("board.goPass")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => send("resign_go", {})}>
                {t("board.goResign")}
              </Button>
            </>
          ) : null}

          {mayScore ? (
            <>
              <Button size="sm" onClick={() => send("accept_score", {})}>
                {t("board.goAccept")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => send("resume_play", {})}>
                {t("board.goResume")}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
