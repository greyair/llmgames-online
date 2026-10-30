import { knownValue } from "@/domain/view-contracts";
import { cardSeatsSchema } from "@/domain/view-contracts";
import type { WireValue } from "@llmgames/game-catalog";
import { isNumber } from "@llmgames/game-catalog";

import { useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import { animate } from "framer-motion";
import "./poker.css";
import "./sketch/poker.css";
import type { ClientView } from "@/domain/game-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GamePlayerAvatar } from "./GamePlayerAvatar";
import { isAgentIdentity, playerPrimaryName } from "@/features/shared/playerIdentity";
import { PlayerName } from "./PlayerName";
import { usePokerSounds } from "./usePokerSounds";
import { PokerWager } from "./PokerWager";
import { usePokerPlayback } from "./usePokerPlayback";
import { PokerPlayback } from "./pokerPlayback";
import { StandardCardFace } from "./StandardCardFace";
import { useMatchClock } from "./useMatchClock";
import { PokerPlaybackSettledContext } from "./pokemon/PokemonPlaybackContext";
import { useT, type MessageKey, type Translate } from "@/i18n";

export type PlayingCardValue = { rank: string; suit: string; hidden?: boolean };

type Seat = {
  playerId: string;
  name: string;
  stack?: number;
  streetBet?: number;
  hole?: PlayingCardValue[];
  folded?: boolean;
  allIn?: boolean;
  status?: string;
};

const suits = { S: "♠", H: "♥", D: "♦", C: "♣" } satisfies Record<string, string>;


export function PlayingCard({ card, style }: { card: PlayingCardValue; style?: CSSProperties }) {
  const t = useT();
  const hidden = card.hidden || card.rank === "?" || !knownValue(suits, card.suit);

  return (
    <span
      className={`playing-card ${hidden ? "card-hidden" : ""}`}
      style={style}
      data-red={!hidden && (card.suit === "H" || card.suit === "D")}
      role="img"
      aria-label={
        hidden
          ? t("board.poker.hiddenCard")
          : t("board.poker.cardName", {
              rank: card.rank,
              suit: t(
                card.suit === "S"
                  ? "board.poker.spades"
                  : card.suit === "H"
                    ? "board.poker.hearts"
                    : card.suit === "D"
                      ? "board.poker.diamonds"
                      : "board.poker.clubs",
              ),
            })
      }
    >
      {!hidden && (
        <span className="playing-card-face" aria-hidden="true">
          <StandardCardFace rank={card.rank} suit={knownValue(suits, card.suit)!} />
        </span>
      )}
      <span className="playing-card-back" aria-hidden="true" />
    </span>
  );
}

/** Clockwise from the hero at the bottom of the table. */
const opponentSlots = {
  0: [],
  1: ["top"],
  2: ["upper-left", "upper-right"],
  3: ["left", "top", "right"],
  4: ["lower-left", "upper-left", "upper-right", "lower-right"],
  5: ["lower-left", "upper-left", "top", "upper-right", "lower-right"],
} satisfies Record<number, string[]>;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function useCountUp(value: number) {
  const [shown, setShown] = useState(value);
  const latest = useRef(value);
  useEffect(() => {
    const update = (next: number) => {
      latest.current = next;
      setShown(next);
    };

    if (prefersReducedMotion() || latest.current === value) {
      update(value);

      return;
    }

    const controls = animate(latest.current, value, {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (next) => update(Math.round(next)),
    });

    return () => controls.stop();
  }, [value]);

  return shown;
}

function seatPlayer(seat: Seat, state: ClientView) {
  return {
    ...state.players?.find((player) => player.id === seat.playerId),
    id: seat.playerId,
    name: seat.name,
  };
}

function TurnBar({ state }: { state: ClientView }) {
  const remaining = useMatchClock(state).turn;
  const total = state.timerConfig?.turnTime;
  const progress = isNumber(remaining) && total ? Math.max(0, Math.min(1, remaining / total)) : 1;

  return (
    <span
      className="poker-turn-bar"
      aria-hidden="true"
      data-urgent={isNumber(remaining) && remaining < 10000}
    >
      <span
        style={
          { "--progress": progress } satisfies CSSProperties & {
            [property: `--${string}`]: string | number | undefined;
          }
        }
      />
    </span>
  );
}

function PositionTokens({ seat, state }: { seat: Seat; state: ClientView }) {
  const t = useT();

  const tokens = [
    state.buttonPlayerId === seat.playerId && "Dealer",
    state.smallBlindPlayerId === seat.playerId && "SB",
    state.bigBlindPlayerId === seat.playerId && "BB",
  ].filter((token): token is string => Boolean(token));

  if (!tokens.length) return null;

  return (
    <div className="poker-position-badges">
      {tokens.map((token) => (
        <span
          className="poker-token"
          data-token={token.toLowerCase()}
          title={t(
            token === "Dealer"
              ? "board.poker.dealerButton"
              : token === "SB"
                ? "board.poker.smallBlind"
                : "board.poker.bigBlind",
          )}
          key={token}
        >
          {token === "Dealer" ? (
            <>
              <span aria-hidden="true">D</span>
              <span className="sr-only">{t("board.poker.dealer")}</span>
            </>
          ) : (
            token
          )}
        </span>
      ))}
    </div>
  );
}

const denominations = [
  { value: 100, chip: "black" },
  { value: 25, chip: "green" },
  { value: 10, chip: "blue" },
  { value: 5, chip: "red" },
  { value: 1, chip: "white" },
] as const;

/** Decorative breakdown of an amount into casino chip columns; the number shown beside it is the real value. */
function chipColumns(amount: number, maxColumns: number, maxHeight: number) {
  let rest = Math.max(0, Math.floor(amount));
  const columns: { chip: string; count: number }[] = [];

  for (const { value, chip } of denominations) {
    const count = Math.floor(rest / value);

    if (!count) continue;
    rest -= count * value;
    columns.push({ chip, count: Math.min(maxHeight, count + 1) });
  }

  return columns.slice(0, maxColumns);
}

function ChipStacks({
  amount,
  maxColumns = 4,
  maxHeight = 6,
}: {
  amount: number;
  maxColumns?: number;
  maxHeight?: number;
}) {
  const columns = chipColumns(amount, maxColumns, maxHeight);

  if (!columns.length) return null;

  return (
    <span className="poker-chip-stacks" aria-hidden="true">
      {columns.map((column, c) => (
        <span className="poker-chip-stack" key={`${column.chip}:${c}`}>
          {Array.from({ length: column.count }, (_, i) => (
            <span className="poker-chip" data-chip={column.chip} key={i} />
          ))}
        </span>
      ))}
    </span>
  );
}

function BetChip({ amount }: { amount: number }) {
  const top = chipColumns(amount, 1, 1)[0];

  return top ? <span className="poker-chip-top" data-chip={top.chip} aria-hidden="true" /> : null;
}

type SeatStatus =
  | "winner"
  | "folded"
  | "allIn"
  | "finished"
  | "yourTurn"
  | "thinking"
  | "action"
  | "inHand";

const SEAT_STATUS_KEYS = {
  winner: "board.poker.seatWinner",
  folded: "board.poker.seatFolded",
  allIn: "board.poker.seatAllIn",
  finished: "board.poker.seatFinished",
  yourTurn: "board.poker.seatYourTurn",
  thinking: "board.poker.seatThinking",
  action: "board.poker.seatInHand",
  inHand: "board.poker.seatInHand",
} as const satisfies Record<SeatStatus, MessageKey>;

function statusTone(kind: SeatStatus) {
  if (kind === "winner") return "win";

  if (kind === "yourTurn" || kind === "thinking") return "live";

  if (kind === "folded") return "muted";

  if (kind === "allIn") return "all-in";

  return "neutral";
}

function PokerSeat({
  seat,
  state,
  slot,
  index,
}: {
  seat: Seat;
  state: ClientView;
  slot: string;
  index: number;
}) {
  const t = useT();

  const active =
    state.status === "playing" &&
    state.turnState?.phase !== "hand_over" &&
    seat.playerId === state.turnState?.currentPlayerId;

  const lastAction = state.actionLog
    ?.filter((entry) => entry.playerId === seat.playerId && entry.handNumber === state.handNumber)
    .at(-1);

  const winning = state.lastHandResult?.winners?.includes(seat.playerId);

  const payout = state.lastHandResult?.payouts?.find(
    (entry) => entry.playerId === seat.playerId,
  )?.amount;

  const self = seat.playerId === state.you?.playerId;

  const statusKind: SeatStatus = winning
    ? "winner"
    : seat.folded
      ? "folded"
      : seat.allIn
        ? "allIn"
        : state.turnState?.phase === "hand_over"
          ? "finished"
          : active
            ? self
              ? "yourTurn"
              : "thinking"
            : lastAction
              ? "action"
              : "inHand";

  const status =
    statusKind === "action" && lastAction
      ? describeAction(lastAction, t)
      : t(SEAT_STATUS_KEYS[statusKind]);

  const player = seatPlayer(seat, state);
  const bet = seat.streetBet ?? 0;

  return (
    <article
      className="card-seat poker-orbit-seat"
      data-winner={Boolean(winning)}
      data-folded={Boolean(seat.folded)}
      data-slot={slot}
      data-color={index % 6}
      data-self={self}
      data-active={active}
      data-agent={isAgentIdentity(player)}
      aria-label={`${seat.name}${active ? t("board.poker.toAct") : ""}`}
    >
      <div className="poker-hole-cards">
        <div className="card-fan">
          {seat.hole?.map((card, i) => (
            <PlayingCard
              card={card}
              key={`${state.handNumber ?? 0}:${i}:${card.hidden || card.rank === "?" ? "back" : "face"}`}
              style={
                { "--i": i } satisfies CSSProperties & {
                  [property: `--${string}`]: string | number | undefined;
                }
              }
            />
          ))}
        </div>
        {winning && isNumber(payout) && (
          <span className="poker-payout" aria-hidden="true">
            +{payout}
          </span>
        )}
      </div>
      <div className="poker-seat-nameplate">
        <span className="poker-player-identity">
          <span className="poker-seat-avatar">
            <GamePlayerAvatar player={player} size={40} />
          </span>
          <PlayerName player={player} fallback={seat.name} />
        </span>
        <span className="poker-seat-stack">{seat.stack}</span>
        {active && <TurnBar state={state} />}
      </div>
      <div className="poker-hand-info">
        <div className="poker-round-status">
          <PositionTokens seat={seat} state={state} />
          <span className="poker-seat-status" data-tone={statusTone(statusKind)}>
            {status}
          </span>
          <strong
            className="poker-seat-bet"
            data-empty={bet === 0}
            aria-label={t("board.poker.inRound", { bet })}
          >
            <BetChip amount={bet} />
            <span>{bet}</span>
          </strong>
        </div>
      </div>
    </article>
  );
}

function describeAction(entry: NonNullable<ClientView["actionLog"]>[number], t: Translate) {
  const labels = {
    fold: "board.poker.logFold",
    check: "board.poker.logCheck",
    call: "board.poker.logCall",
    bet: "board.poker.logBet",
    raise: "board.poker.logRaise",
    all_in: "board.poker.logAllIn",
    small_blind: "board.poker.logSmallBlind",
    big_blind: "board.poker.logBigBlind",
  } satisfies Record<string, MessageKey>;

  const label = knownValue(labels, entry.action);

  return `${label ? t(label) : entry.action.replaceAll("_", " ")}${entry.amount !== undefined ? ` ${entry.amount}` : ""}`;
}

function PokerHandResult({
  state,
  seats,
  remainingMs,
}: {
  state: ClientView;
  seats: Seat[];
  remainingMs: number;
}) {
  const t = useT();
  const result = state.lastHandResult;

  if (!result?.winners?.length) return null;

  const name = (id: string) =>
    seats.find((seat) => seat.playerId === id)?.name ?? t("board.poker.player");

  const winnerNames = result.winners.map(name).join(" & ");

  const winningHands = result.showdown
    ? (result.hands?.filter((hand) => result.winners?.includes(hand.playerId)) ?? [])
    : [];

  const payouts = result.payouts
    ?.map((payout) => `${name(payout.playerId)} +${payout.amount}`)
    .join(" · ");

  const chips = [isNumber(result.pot) ? t("board.poker.potValue", { amount: result.pot }) : null, payouts]
    .filter(Boolean)
    .join(" · ");

  const progress = remainingMs > 0 ? 1 - remainingMs / PokerPlayback.resultHoldMs : 1;

  return (
    <div
      className="poker-hand-result"
      role="status"
      aria-live="polite"
      aria-label={t(
        result.winners.length > 1 ? "board.poker.handResultSplit" : "board.poker.handResult",
        { hand: state.handNumber ?? "", winners: winnerNames },
      )}
    >
      <strong>
        {t(result.winners.length > 1 ? "board.poker.splitPot" : "board.poker.winsPot", {
          winners: winnerNames,
        })}
      </strong>
      {winningHands.length ? (
        <div className="poker-result-hands">
          {winningHands.map((hand) => (
            <div className="poker-result-hand" key={hand.playerId}>
              <div className="card-fan">
                {hand.hole?.map((card, index) => (
                  <PlayingCard card={card} key={index} />
                ))}
              </div>
              <span>
                {name(hand.playerId)} · {hand.label}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <span className="poker-result-note">
          {result.showdown
            ? t("board.poker.showdownShown")
            : t("board.poker.everyoneFolded")}
        </span>
      )}
      <div className="poker-result-meta">
        <span>{chips}</span>
        {remainingMs > 0 && (
          <span>
            {state.status === "ended"
              ? t("board.poker.matchResultIn", { seconds: Math.ceil(remainingMs / 1000) })
              : t("board.poker.nextHandIn", { seconds: Math.ceil(remainingMs / 1000) })}
          </span>
        )}
      </div>
      {remainingMs > 0 && (
        <span className="poker-result-progress" aria-hidden="true">
          <span
            style={
              { "--progress": progress } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
          />
        </span>
      )}
    </div>
  );
}

function PokerPot({ pot }: { pot: number }) {
  const t = useT();
  const shown = useCountUp(pot);

  return (
    <div className="poker-pot" data-empty={pot === 0}>
      <ChipStacks amount={pot} maxColumns={5} maxHeight={7} />
      <span className="poker-pot-readout">
        <span>{t("board.poker.pot")}</span>
        <strong>{shown}</strong>
      </span>
    </div>
  );
}

/** Index of the first card dealt in the latest community change, so a flop staggers from its first card. */
function useDealOrigin(count: number) {
  const [dealt, setDealt] = useState({ count, from: 0 });

  if (dealt.count === count) return dealt.from;
  const next = { count, from: count > dealt.count ? dealt.count : 0 };
  setDealt(next);

  return next.from;
}

export function Cards({
  state: live,
  send,
}: {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
}) {
  const t = useT();
  const { state, catchingUp, goLive, resultRemainingMs } = usePokerPlayback(live);
  const onPlaybackSettled = useContext(PokerPlaybackSettledContext);
  useEffect(() => {
    if (
      live.status !== "ended" ||
      state.status !== "ended" ||
      catchingUp ||
      resultRemainingMs > 0 ||
      !onPlaybackSettled
    )
      return;

    const timer = window.setTimeout(
      onPlaybackSettled,
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 950,
    );

    return () => window.clearTimeout(timer);
  }, [live.status, state.status, catchingUp, resultRemainingMs, onPlaybackSettled]);
  usePokerSounds(state);
  const community = Array.isArray(state.community) ? state.community : [];
  const dealFrom = useDealOrigin(community.length);

  const seats = (cardSeatsSchema.safeParse(state.seats).data ?? []).map((seat) => ({
    ...seat,
    name: playerPrimaryName({
      ...state.players?.find((player) => player.id === seat.playerId),
      name: seat.name,
    }),
  }));

  const hero = seats.find((seat) => seat.playerId === state.you?.playerId);
  const bottomSeat = hero ?? seats[0];
  const bottomIndex = bottomSeat ? seats.indexOf(bottomSeat) : 0;
  const opponents = [...seats.slice(bottomIndex + 1), ...seats.slice(0, bottomIndex)];

  const slots = new Map(
    opponents.map((seat, index) => [
      seat.playerId,
      knownValue(opponentSlots, opponents.length)?.[index] ?? "top",
    ]),
  );

  if (bottomSeat) slots.set(bottomSeat.playerId, "hero");

  const legal =
    !catchingUp && state.status === "playing" && !state.you?.isSpectator && !state.replayReadOnly
      ? (state.you?.legalActions ?? [])
      : [];

  const limits = state;
  const raiseMin = (limits.currentBet ?? 0) + (limits.minRaise ?? state.bigBlind ?? 0);
  const action = legal.includes("raise") ? "raise" : legal.includes("bet") ? "bet" : null;
  const bankroll = hero?.stack;

  const rawMin =
    action === "raise" ? raiseMin : Math.min(bankroll ?? Infinity, state.bigBlind ?? 1);

  const max = action === "raise" ? (bankroll ?? 0) + (hero?.streetBet ?? 0) : (bankroll ?? 0);
  const step = state.bigBlind ?? 10;
  const min = Math.min(max, Math.ceil(rawMin / step) * step);
  const toCall = state.toCall ?? state.you?.toCall ?? 0;

  const buttons = {
    fold: "board.poker.buttonFold",
    check: "board.poker.buttonCheck",
    call: "board.poker.buttonCall",
    all_in: "board.poker.buttonAllIn",
    next_hand: "board.poker.buttonNextHand",
  } satisfies Record<string, MessageKey>;

  const variants = {
    fold: "destructive",
    check: "secondary",
    call: "secondary",
    all_in: legal.includes("raise") || legal.includes("bet") ? "secondary" : "default",
    next_hand: "default",
  } satisfies Record<string, "secondary" | "default" | "destructive">;

  const actionButtons = legal.filter((name) => name in buttons);

  const actionControls = actionButtons.length ? (
    <div className="card-actions">
      {actionButtons.map((name) => {
        const label = knownValue(buttons, name);

        return (
        <Button
          key={name}
          data-action={name}
          size="lg"
          disabled={name === "next_hand" && resultRemainingMs > 0}
          variant={knownValue(variants, name)}
          onClick={() => send(name, {})}
        >
          {name === "next_hand" && resultRemainingMs > 0
            ? t("board.poker.nextHandIn", { seconds: Math.ceil(resultRemainingMs / 1000) })
            : label
              ? t(label, { amount: toCall })
              : name}
        </Button>
        );
      })}
    </div>
  ) : null;

  const phaseLabel =
    state.turnState?.phase === "hand_over"
      ? t("match.handFinished")
      : state.turnState?.phase
        ? state.turnState.phase.replaceAll("_", " ")
        : t("board.poker.table");

  const lastEntry = state.actionLog?.at(-1);
  const waiting = !legal.some((name) => name in buttons || name === action);

  return (
    <div
      className="cards-stage poker-workspace"
      data-seats={seats.length}
      data-watching={Boolean(state.you?.isSpectator || state.replayReadOnly)}
      data-controls={!state.you?.isSpectator}
      data-your-turn={Boolean(state.you?.isYourTurn && legal.length)}
      style={
        { "--seat-count": Math.max(1, seats.length) } satisfies CSSProperties & {
          [property: `--${string}`]: string | number | undefined;
        }
      }
    >
      <header className="cards-heading">
        <Badge tone="neutral">{phaseLabel}</Badge>
        <span className="poker-heading-meta">
          {state.handNumber
            ? t("board.cards.hand", { number: state.handNumber })
            : t("board.cards.blinds", {
                sb: state.blinds?.sb ?? 5,
                bb: state.bigBlind ?? 10,
              })}
        </span>
        {catchingUp && resultRemainingMs === 0 && (
          <Button variant="secondary" size="sm" onClick={goLive}>
            {t("board.cards.backToLive")}
          </Button>
        )}
      </header>
      <div className="poker-table">
        <div className="poker-felt" aria-hidden="true">
          <span className="poker-rail-grain" />
          <span className="poker-baize">
            <span className="poker-felt-line" />
          </span>
        </div>
        <section className="cards-center" aria-label={t("board.cards.communityCards")}>
          <PokerPot pot={state.pot ?? 0} />
          <div className="poker-board">
            <div className="card-fan">
              {community.map((card, index) => (
                <PlayingCard
                  key={index}
                  card={card}
                  style={
                    {
                      "--slot": index,
                      "--deal": Math.max(0, index - dealFrom),
                    } satisfies CSSProperties & {
                      [property: `--${string}`]: string | number | undefined;
                    }
                  }
                />
              ))}
              {Array.from({ length: Math.max(0, 5 - community.length) }, (_, i) => (
                <span
                  className="card-slot"
                  role="img"
                  key={`empty-${community.length + i}`}
                  aria-label={t("board.poker.undealtCard")}
                />
              ))}
            </div>
          </div>
          <div className="poker-table-story" aria-live="polite">
            {state.lastHandResult?.winners?.length ? (
              <PokerHandResult state={state} seats={seats} remainingMs={resultRemainingMs} />
            ) : state.actionLog?.length && lastEntry ? (
              <>
                <strong>
                  <span>
                    {seats.find((seat) => seat.playerId === lastEntry.playerId)?.name ??
                      t("board.poker.player")}
                  </span>{" "}
                  · {describeAction(lastEntry, t)}
                </strong>
                <details>
                  <summary>{t("board.poker.recentTurns")}</summary>
                  <ol>
                    {state.actionLog.slice(-8).map((entry, i) => (
                      <li key={i}>
                        <small>
                          Hand {entry.handNumber} · {entry.street}
                        </small>{" "}
                        {seats.find((seat) => seat.playerId === entry.playerId)?.name ??
                          t("board.poker.player")}{" "}
                        {describeAction(entry, t)}
                      </li>
                    ))}
                  </ol>
                </details>
              </>
            ) : (
              <span>{t("board.poker.waitingFirstMove")}</span>
            )}
          </div>
        </section>
        <section className="card-seats" aria-label={t("board.cards.tableSeats")} tabIndex={0}>
          {seats.map((seat, index) => (
            <PokerSeat
              key={seat.playerId}
              seat={seat}
              state={state}
              slot={slots.get(seat.playerId) ?? "top"}
              index={index}
            />
          ))}
        </section>
      </div>
      {!state.you?.isSpectator && (
        <footer className="card-controls" data-waiting={waiting}>
          {hero && !state.replayReadOnly && (
            <div className="poker-own-hand">
              <div>
                <strong>{t("board.poker.yourStack")}</strong>
                <span>{hero.stack}</span>
              </div>
              <p data-turn={Boolean(state.you?.isYourTurn) && !hero.folded && !hero.allIn}>
                {hero.folded
                  ? t("board.poker.youFolded")
                  : hero.allIn
                    ? t("board.poker.youAllIn")
                    : state.you?.isYourTurn
                      ? t("board.poker.toCall", { amount: toCall })
                      : t("board.poker.waitingNextMove")}
              </p>
            </div>
          )}
          {actionControls}
          {action && (
            <PokerWager
              key={`${state.handNumber}:${state.turnState?.phase}:${state.actionLog?.length}:${state.turnState?.startedAt}:${action}`}
              action={action}
              min={min}
              max={max}
              step={step}
              pot={state.pot ?? 0}
              currentBet={limits.currentBet ?? 0}
              toCall={toCall}
              canAllIn={legal.includes("all_in")}
              send={send}
            />
          )}
          {waiting && (
            <p className="poker-waiting-note">
              {catchingUp
                ? t("board.poker.showingLastMove")
                : state.status === "ended"
                  ? t("board.poker.gameFinished")
                  : t("board.poker.waitingDecision")}
            </p>
          )}
        </footer>
      )}
    </div>
  );
}
