import { useEffect, useState } from "react";
import { z } from "zod";

import type { WireValue } from "@llmgames/game-catalog";
import type { ClientView } from "@/domain/game-state";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { play } from "@/lib/sound";
import { PlayingCard } from "./PlayingCard";
import "./card-table.css";
import "./doudizhu.css";

/**
 * 斗地主 (Fight the Landlord) table.
 *
 * Two phases share one surface: the auction shows bid buttons, the play shows
 * play/pass. As in 跑得快 the browser never classifies a hand — the rule module
 * decides — but the auction is a plain number, so the buttons can be gated
 * locally against the current bid without duplicating any rule.
 */

const handSchema = z.array(z.string()).catch([]);

const countsSchema = z.array(z.number()).catch([]);

const seatSchema = z.record(z.string(), z.number()).catch({});

const bidsSchema = z.array(z.number().nullable()).catch([]);

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

const BIDS = [1, 2, 3] as const;

/** `·` before a seat acts, `—` for a pass, the number otherwise. */
function bidLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "·";

  return value === 0 ? "—" : String(value);
}

export function Doudizhu({
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
  const bids = bidsSchema.parse(state.bids);
  const trick = recordSchema.parse(state.trick);
  const lastTrick = recordSchema.parse(state.lastTrick);
  const bottom = z.array(z.string()).catch([]).parse(state.bottom);

  const [selected, setSelected] = useState<string[]>([]);

  const handKey = hand.join(" ");

  useEffect(() => {
    setSelected([]);
  }, [handKey, state.turnState?.turnNumber]);

  const readOnly = Boolean(state.you?.isSpectator || state.replayReadOnly);
  const legal = state.you?.legalActions ?? [];
  const live = !readOnly && state.status === "playing" && Boolean(state.you?.isYourTurn);
  const phase = state.turnState?.phase ?? "bid";

  const bidding = live && phase === "bid" && legal.includes("bid");
  const canPlay = live && phase === "play" && legal.includes("play_cards");
  const canPass = live && phase === "play" && legal.includes("pass");

  const bid = state.bid ?? 0;
  const landlord = state.landlord ?? null;

  const mySeat = state.you?.seat ?? null;

  const currentSeat =
    state.turnState === undefined
      ? null
      : (seats[state.turnState.currentPlayerId ?? ""] ?? null);

  const nameOf = (seat: number) => {
    const player = state.players?.find((entry) => seats[entry.id] === seat);

    return player?.name ?? player?.codename ?? `Seat ${seat}`;
  };

  const toggle = (card: string) => {
    setSelected((current) =>
      current.includes(card) ? current.filter((entry) => entry !== card) : [...current, card],
    );
  };

  const table = trick ?? lastTrick;

  const hint = readOnly
    ? t("board.doudizhuWatching")
    : bidding
      ? t("board.doudizhuYourBid", { bid })
      : canPlay && trick
        ? t("board.doudizhuBeat", { cards: trick.cards.length })
        : canPlay
          ? t("board.doudizhuLead")
          : state.status === "playing"
            ? t("board.doudizhuWaiting")
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
                {landlord === index ? (
                  <span className="ddz-badge">{t("board.doudizhuLandlord")}</span>
                ) : null}
                <span className="ddz-bids">{bidLabel(bids[index])}</span>
              </span>
            ),
          )}
        </div>

        <div className="ct-table" data-empty={table ? "false" : "true"}>
          {bottom.length > 0 ? (
            <div className="ddz-bottom">
              <span className="ct-table-label">{t("board.doudizhuBottom")}</span>
              {bottom.map((card, index) => (
                <PlayingCard key={`${card}-${index}`} card={card} small />
              ))}
            </div>
          ) : null}

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
            <span className="ct-table-label">
              {bidding ? t("board.doudizhuBidding", { bid }) : t("board.cardsEmptyTable")}
            </span>
          )}
        </div>

        <div className="ct-hand">
          {hand.map((card) => (
            <PlayingCard
              key={card}
              card={card}
              selected={selected.includes(card)}
              onToggle={canPlay ? () => toggle(card) : undefined}
            />
          ))}
        </div>

        <div className="ct-bar">
          <p className="ct-hint">{hint}</p>

          {bidding ? (
            <div className="ddz-bid-row">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  play("fold", { volume: 0.35 });
                  send("bid", { value: 0 });
                }}
              >
                {t("board.doudizhuPass")}
              </Button>
              {BIDS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  disabled={value <= bid}
                  onClick={() => {
                    play("place", { volume: 0.4 });
                    send("bid", { value });
                  }}
                >
                  {t("board.doudizhuBid", { value })}
                </Button>
              ))}
            </div>
          ) : (
            <div className="ct-actions">
              <span className="ct-selected">
                {selected.length > 0
                  ? t("board.cardsSelected", { count: selected.length })
                  : ""}
              </span>
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
          )}
        </div>
      </div>
    </div>
  );
}
