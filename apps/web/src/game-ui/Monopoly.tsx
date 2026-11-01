import { useState } from "react";
import { z } from "zod";

import type { WireValue } from "@llmgames/game-catalog";
import type { ClientView } from "@/domain/game-state";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { play } from "@/lib/sound";
import "./monopoly.css";

/**
 * 大富翁 board.
 *
 * The ring geometry lives here, exactly as the aeroplane board owns its 52
 * squares: the server stores indices, the browser decides where they sit. The
 * rules stay on the server — the component offers only the actions
 * `legalActions` reports, and asks it which squares are buildable.
 */

const SIDE = 7;

const CELL = 76;

const MARGIN = 10;

const VIEW = SIDE * CELL + MARGIN * 2;

const SPACES = 24;

/** Names in board order, mirroring the server's ring. */
const NAMES = [
  "起点",
  "巴山",
  "秋池",
  "命运",
  "长亭",
  "古渡",
  "大牢",
  "夜雨",
  "寒山",
  "税",
  "枫桥",
  "乌衣巷",
  "茶馆",
  "西窗",
  "剪烛",
  "命运",
  "江南",
  "杏花",
  "去大牢",
  "小楼",
  "深巷",
  "灯油",
  "楼台",
  "长安",
];

const PRICES = new Map<number, number>([
  [1, 60],
  [2, 60],
  [4, 100],
  [5, 100],
  [7, 140],
  [8, 140],
  [10, 180],
  [11, 180],
  [13, 220],
  [14, 220],
  [16, 260],
  [17, 260],
  [19, 320],
  [20, 320],
  [22, 400],
  [23, 400],
]);

const GROUPS = new Map<number, number>([
  [1, 0],
  [2, 0],
  [4, 1],
  [5, 1],
  [7, 2],
  [8, 2],
  [10, 3],
  [11, 3],
  [13, 4],
  [14, 4],
  [16, 5],
  [17, 5],
  [19, 6],
  [20, 6],
  [22, 7],
  [23, 7],
]);

/**
 * Row and column of a space on the 7×7 ring.
 *
 * 起点 is the bottom-right corner and play runs clockwise, so the ring reads the
 * way a printed board does: along the bottom, up the left, across the top and
 * down the right.
 */
function cellOf(index: number) {
  if (index <= 6) return { row: 6, col: 6 - index };

  if (index <= 12) return { row: 12 - index, col: 0 };

  if (index <= 18) return { row: 0, col: index - 12 };

  return { row: index - 18, col: 6 };
}

const numbersSchema = z.array(z.number()).catch([]);

const ownersSchema = z.array(z.number().nullable()).catch([]);

const flagsSchema = z.array(z.boolean()).catch([]);

const seatSchema = z.record(z.string(), z.number()).catch({});

const diceSchema = z.array(z.number()).catch([]);

const TOKEN_INKS = ["ink", "milk", "grey", "ring"] as const;

function tokenInk(seat: number): string {
  return `var(--palette-mono-${TOKEN_INKS[seat % TOKEN_INKS.length]})`;
}

export function Monopoly({
  state,
  send,
}: {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
}) {
  const t = useT();

  const cash = numbersSchema.parse(state.cash);
  const position = numbersSchema.parse(state.position);
  const owners = ownersSchema.parse(state.owners);
  const houses = numbersSchema.parse(state.houses);
  const jail = flagsSchema.parse(state.jail);
  const bankrupt = flagsSchema.parse(state.bankrupt);
  const seats = seatSchema.parse(state.seats);
  const buildable = numbersSchema.parse(state.buildable);
  const dice = diceSchema.parse(state.roll);
  const jailed = numbersSchema.parse(state.jailCards);

  const [hover, setHover] = useState<number | null>(null);

  const readOnly = Boolean(state.you?.isSpectator || state.replayReadOnly);
  const legal = state.you?.legalActions ?? [];
  const live = !readOnly && state.status === "playing" && Boolean(state.you?.isYourTurn);
  const phase = state.turnState?.phase ?? "roll";

  const mySeat = state.you?.seat ?? null;
  const canBuild = live && legal.includes("build");
  const landed = state.landed ?? null;

  const nameOf = (seat: number) => {
    const player = state.players?.find((entry) => seats[entry.id] === seat);

    return player?.name ?? player?.codename ?? `Seat ${seat}`;
  };

  const hint = readOnly
    ? t("board.monopolyWatching")
    : live && phase === "roll"
      ? t("board.monopolyRollPrompt")
      : live && phase === "buy"
        ? t("board.monopolyBuyPrompt")
        : live
          ? t("board.monopolyEndPrompt")
          : t("board.monopolyWaiting");

  const act = (actionType: string, data: WireValue = {}) => {
    play("tap", { volume: 0.4 });
    send(actionType, data);
  };

  const tokens = position.map((index, seat) => ({ seat, index }));

  return (
    <div className="mono-stage">
      <div className="mono-fit">
        <div className="mono-head">
          {cash.map((amount, seat) => (
            <span
              key={seat}
              className="mono-player"
              data-self={seat === mySeat}
              data-out={bankrupt[seat] ? "true" : "false"}
            >
              <i className="mono-dot" style={{ background: tokenInk(seat) }} />
              <span className="mono-name">{nameOf(seat)}</span>
              <span className="mono-cash">¥{amount}</span>
              {(jailed[seat] ?? 0) > 0 ? (
                <span className="mono-badge">{t("board.monopolyCard")}</span>
              ) : null}
              {jail[seat] ? <span className="mono-badge">{t("board.monopolyJailed")}</span> : null}
            </span>
          ))}
        </div>

        <div className="mono-board-wrap">
          <svg
            className="mono-svg"
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            role="img"
            aria-label={t("board.monopolyBoard")}
          >
            <rect x="0" y="0" width={VIEW} height={VIEW} rx="18" fill="var(--palette-mono-board)" />

            {Array.from({ length: SPACES }, (_, index) => {
              const { row, col } = cellOf(index);
              const x = MARGIN + col * CELL;
              const y = MARGIN + row * CELL;
              const owner = owners[index] ?? null;
              const levels = houses[index] ?? 0;
              const group = GROUPS.get(index);

              return (
                <g
                  key={index}
                  className="mono-space"
                  data-buildable={canBuild && buildable.includes(index) ? "true" : "false"}
                  data-here={landed === index ? "true" : "false"}
                  onPointerEnter={() => setHover(index)}
                  onPointerLeave={() => setHover(null)}
                  onClick={() =>
                    canBuild && buildable.includes(index) && act("build", { space: index })
                  }
                >
                  <rect
                    x={x + 2}
                    y={y + 2}
                    width={CELL - 4}
                    height={CELL - 4}
                    rx="8"
                    fill={owner === null ? "var(--palette-mono-empty)" : tokenInk(owner)}
                    fillOpacity={owner === null ? 1 : 0.22}
                    stroke="var(--palette-mono-line)"
                    strokeWidth="1.5"
                  />
                  {group !== undefined ? (
                    <rect
                      x={x + 6}
                      y={y + 6}
                      width={CELL - 12}
                      height="5"
                      rx="2.5"
                      fill={`var(--palette-mono-group-${group})`}
                    />
                  ) : null}
                  <text x={x + CELL / 2} y={y + CELL / 2 + 2} textAnchor="middle" className="mono-label">
                    {NAMES[index]}
                  </text>
                  {PRICES.get(index) !== undefined ? (
                    <text
                      x={x + CELL / 2}
                      y={y + CELL / 2 + 17}
                      textAnchor="middle"
                      className="mono-price"
                    >
                      ¥{PRICES.get(index)}
                    </text>
                  ) : null}
                  {Array.from({ length: levels }, (_, level) => (
                    <circle
                      key={level}
                      cx={x + 12 + level * 9}
                      cy={y + CELL - 12}
                      r="3.2"
                      fill="var(--palette-mono-ink)"
                    />
                  ))}
                  {tokens
                    .filter((token) => token.index === index)
                    .map((token, slot) => (
                      <circle
                        key={token.seat}
                        cx={x + CELL - 14 - (slot % 2) * 12}
                        cy={y + 14 + Math.floor(slot / 2) * 12}
                        r="5.5"
                        fill={tokenInk(token.seat)}
                        stroke="var(--palette-mono-ink)"
                        strokeWidth="1.5"
                      />
                    ))}
                </g>
              );
            })}

            <rect
              x={MARGIN + CELL}
              y={MARGIN + CELL}
              width={CELL * 5}
              height={CELL * 5}
              rx="12"
              fill="none"
              stroke="var(--palette-mono-line)"
              strokeWidth="1.5"
              strokeDasharray="6 6"
            />
            <text
              x={VIEW / 2}
              y={VIEW / 2 - 6}
              textAnchor="middle"
              className="mono-centre"
            >
              {dice.length === 2 ? `${dice[0]} · ${dice[1]}` : "—"}
            </text>
            <text x={VIEW / 2} y={VIEW / 2 + 20} textAnchor="middle" className="mono-price">
              {hover === null ? t("board.monopolyRing") : NAMES[hover]}
            </text>
          </svg>
        </div>

        <div className="mono-bar">
          <p className="mono-hint">{hint}</p>
          <div className="mono-actions">
            {live && phase === "roll" && legal.includes("card") ? (
              <Button type="button" size="sm" variant="outline" onClick={() => act("card")}>
                {t("board.monopolyUseCard")}
              </Button>
            ) : null}
            {live && phase === "roll" && legal.includes("pay") ? (
              <Button type="button" size="sm" variant="outline" onClick={() => act("pay")}>
                {t("board.monopolyPay")}
              </Button>
            ) : null}
            {live && phase === "roll" ? (
              <Button type="button" size="sm" onClick={() => act("roll")}>
                {t("board.monopolyRoll")}
              </Button>
            ) : null}
            {live && phase === "buy" && legal.includes("buy") ? (
              <Button type="button" size="sm" onClick={() => act("buy")}>
                {t("board.monopolyBuy", { price: PRICES.get(landed ?? 0) ?? 0 })}
              </Button>
            ) : null}
            {live && phase === "buy" ? (
              <Button type="button" size="sm" variant="outline" onClick={() => act("skip")}>
                {t("board.monopolySkip")}
              </Button>
            ) : null}
            {live && phase === "end" ? (
              <Button type="button" size="sm" onClick={() => act("end")}>
                {t("board.monopolyEnd")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
