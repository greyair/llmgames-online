import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import type { WireValue } from "@llmgames/game-catalog";
import type { ClientView } from "@/domain/game-state";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { play } from "@/lib/sound";
import "./paodekuai.css";

/**
 * 跑得快 (Run Fast) table.
 *
 * The server owns the shapes: this component shows the hand, lets the player
 * pick cards and sends the selection, and the refusal comes back from the rule
 * module. Re-implementing the classifier here would be a second, drifting copy
 * of rules that decide the match.
 *
 * Card ids are `<suit><rank>` — `S3`, `HT`, `DJ` — which is exactly what the
 * action accepts, so a click needs no translation layer.
 */

const JOKER_SMALL = "j1";

const JOKER_BIG = "j2";

const handSchema = z.array(z.string()).catch([]);

const countsSchema = z.array(z.number()).catch([]);

const seatSchema = z.record(z.string(), z.number()).catch({});

const recordSchema = z
  .object({
    seat: z.number(),
    cards: z.array(z.string()),
    combo: z
      .object({ kind: z.string(), size: z.number(), key: z.number(), len: z.number() })
      .nullable(),
    n: z.number(),
  })
  .nullable()
  .catch(null);

function isRed(card: string): boolean {
  return card.startsWith("H") || card.startsWith("D");
}

function rankOf(card: string): string {
  if (card === JOKER_SMALL) return "J1";

  if (card === JOKER_BIG) return "J2";

  const rank = card.slice(1);

  return rank === "T" ? "10" : rank;
}

function suitOf(card: string): string {
  if (card === JOKER_SMALL || card === JOKER_BIG) return "★";

  const suit = card.slice(0, 1);

  if (suit === "S") return "♠";

  if (suit === "H") return "♥";

  return suit === "C" ? "♣" : "♦";
}

/** One card face. Jokers get a star and the shared red/black ink. */
function Card({
  card,
  selected,
  onToggle,
  disabled,
}: {
  card: string;
  selected: boolean;
  onToggle?: () => void;
  disabled: boolean;
}) {
  const label = `${rankOf(card)}${suitOf(card)}`;

  return (
    <button
      type="button"
      className="pdk-card"
      data-red={isRed(card) ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      data-joker={card === JOKER_SMALL || card === JOKER_BIG ? "true" : "false"}
      disabled={disabled || !onToggle}
      aria-pressed={onToggle ? selected : undefined}
      aria-label={label}
      onClick={onToggle}
    >
      <span className="pdk-card-rank">{rankOf(card)}</span>
      <span className="pdk-card-suit">{suitOf(card)}</span>
    </button>
  );
}

export function Paodekuai({
  state,
  send,
}: {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
}) {
  const t = useT();

  const hand = handSchema.parse(state.hand);
  const counts = countsSchema.parse(state.handCounts);
  const seats = seatSchema.parse(state.seats);
  const trick = recordSchema.parse(state.trick);
  const lastTrick = recordSchema.parse(state.lastTrick);

  const [selected, setSelected] = useState<string[]>([]);

  // A new hand or a new turn clears the selection: stale picks would send cards
  // the seat no longer holds.
  const handKey = hand.join(" ");

  useEffect(() => {
    setSelected([]);
  }, [handKey, state.turnState?.turnNumber]);

  const readOnly = Boolean(state.you?.isSpectator || state.replayReadOnly);
  const legal = state.you?.legalActions ?? [];
  const live = !readOnly && state.status === "playing" && Boolean(state.you?.isYourTurn);

  const canPlay = live && legal.includes("play_cards");
  const canPass = live && legal.includes("pass");

  const picked = useMemo(() => new Set(selected), [selected]);

  const toggle = (card: string) => {
    setSelected((current) =>
      current.includes(card) ? current.filter((entry) => entry !== card) : [...current, card],
    );
  };

  const mySeat = state.you?.seat ?? null;

  const currentSeat =
    state.turnState?.currentPlayerId === undefined || state.turnState === undefined
      ? null
      : (seats[state.turnState.currentPlayerId ?? ""] ?? null);

  const nameOf = (seat: number) => {
    const player = state.players?.find((entry) => seats[entry.id] === seat);

    return player?.name ?? player?.codename ?? `Seat ${seat}`;
  };

  const table = trick ?? lastTrick;
  const beaten = trick ? trick : null;

  const hint = readOnly
    ? t("board.paodekuaiWatching")
    : canPlay && beaten
      ? t("board.paodekuaiBeat", { cards: beaten.cards.length })
      : canPlay
        ? t("board.paodekuaiLead")
        : state.status === "playing"
          ? t("board.paodekuaiWaiting")
          : "";

  return (
    <div className="pdk-stage">
      <div className="pdk-fit">
        <div className="pdk-rivals">
          {counts.map((count, index) =>
            index === mySeat ? null : (
              <span key={index} className="pdk-rival" data-turn={index === currentSeat}>
                <span className="pdk-rival-name">{nameOf(index)}</span>
                <span className="pdk-rival-count">{t("board.paodekuaiLeft", { count })}</span>
              </span>
            ),
          )}
        </div>

        <div className="pdk-table" data-empty={table ? "false" : "true"}>
          {table ? (
            <>
              <span className="pdk-table-label">
                {t(trick ? "board.paodekuaiOnTable" : "board.paodekuaiLastTrick")} ·{" "}
                {nameOf(table.seat)}
              </span>
              <div className="pdk-table-cards">
                {table.cards.length === 0 ? (
                  <span className="pdk-table-pass">{t("board.paodekuaiPassed")}</span>
                ) : (
                  table.cards.map((card, index) => (
                    <Card key={`${card}-${index}`} card={card} selected={false} disabled />
                  ))
                )}
              </div>
            </>
          ) : (
            <span className="pdk-table-label">{t("board.paodekuaiEmptyTable")}</span>
          )}
        </div>

        <div className="pdk-hand" data-count={hand.length}>
          {hand.map((card) => (
            <Card
              key={card}
              card={card}
              selected={picked.has(card)}
              disabled={!canPlay}
              onToggle={canPlay ? () => toggle(card) : undefined}
            />
          ))}
        </div>

        <div className="pdk-bar">
          <p className="pdk-hint">{hint}</p>
          <span className="pdk-selected">
            {selected.length > 0 ? t("board.paodekuaiSelected", { count: selected.length }) : ""}
          </span>
          <div className="pdk-actions">
            <Button
              type="button"
              size="sm"
              disabled={!canPlay || selected.length === 0}
              onClick={() => {
                play("place", { volume: 0.4 });
                send("play_cards", { cards: selected });
              }}
            >
              {t("board.paodekuaiPlay")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canPass}
              onClick={() => {
                play("fold", { volume: 0.35 });
                send("pass", {});
              }}
            >
              {t("board.paodekuaiPass")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
