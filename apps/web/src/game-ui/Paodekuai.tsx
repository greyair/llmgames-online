import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import type { WireValue } from "@llmgames/game-catalog";
import type { ClientView } from "@/domain/game-state";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { play } from "@/lib/sound";
import { PlayingCard } from "./PlayingCard";
import "./card-table.css";

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
    <div className="ct-stage">
      <div className="ct-fit">
        <div className="ct-rivals">
          {counts.map((count, index) =>
            index === mySeat ? null : (
              <span key={index} className="ct-rival" data-turn={index === currentSeat}>
                <span className="ct-rival-name">{nameOf(index)}</span>
                <span className="ct-rival-count">{t("board.cardsLeft", { count })}</span>
              </span>
            ),
          )}
        </div>

        <div className="ct-table" data-empty={table ? "false" : "true"}>
          {table ? (
            <>
              <span className="ct-table-label">
                {t(trick ? "board.cardsOnTable" : "board.cardsLastTrick")} ·{" "}
                {nameOf(table.seat)}
              </span>
              <div className="ct-table-cards">
                {table.cards.length === 0 ? (
                  <span className="ct-table-pass">{t("board.cardsPassed")}</span>
                ) : (
                  table.cards.map((card, index) => (
                    <PlayingCard key={`${card}-${index}`} card={card} />
                  ))
                )}
              </div>
            </>
          ) : (
            <span className="ct-table-label">{t("board.cardsEmptyTable")}</span>
          )}
        </div>

        <div className="ct-hand" data-count={hand.length}>
          {hand.map((card) => (
            <PlayingCard
              key={card}
              card={card}
              selected={picked.has(card)}
              onToggle={canPlay ? () => toggle(card) : undefined}
            />
          ))}
        </div>

        <div className="ct-bar">
          <p className="ct-hint">{hint}</p>
          <span className="ct-selected">
            {selected.length > 0 ? t("board.cardsSelected", { count: selected.length }) : ""}
          </span>
          <div className="ct-actions">
            <Button
              type="button"
              size="sm"
              disabled={!canPlay || selected.length === 0}
              onClick={() => {
                play("place", { volume: 0.4 });
                send("play_cards", { cards: selected });
              }}
            >
              {t("board.cardsPlay")}
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
              {t("board.cardsPass")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
