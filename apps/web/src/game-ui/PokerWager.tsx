import type { WireValue } from "@llmgames/game-catalog";
import { useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

type Props = {
  action: "bet" | "raise";
  min: number;
  max: number;
  step: number;
  pot: number;
  currentBet: number;
  toCall: number;
  canAllIn: boolean;
  send: (name: string, data: WireValue) => void;
};

export function PokerWager({
  action,
  min,
  max,
  step,
  pot,
  currentBet,
  toCall,
  canAllIn,
  send,
}: Props) {
  const t = useT();
  const [selected, setSelected] = useState(min);
  const snap = (value: number) => Math.min(max, Math.max(min, Math.ceil(value / step) * step));
  const amount = snap(selected);

  // A pot-sized raise includes the call, then raises by the pot after calling.
  const potSize = (fraction: number) =>
    snap(action === "raise" ? currentBet + (pot + toCall) * fraction : pot * fraction);

  const sizes = [
    { label: t("board.cards.wagerMin"), value: min },
    { label: t("board.cards.wagerHalfPot"), value: potSize(0.5) },
    { label: t("board.cards.wagerPot"), value: potSize(1) },
    { label: t("board.cards.wagerAllIn"), value: max },
  ];

  const lastIndex = Math.ceil((max - min) / step);
  const index = amount === max ? lastIndex : Math.round((amount - min) / step);
  const allIn = amount === max && canAllIn;

  const label = allIn
    ? t("board.cards.allInFor", { amount })
    : action === "raise"
      ? t("board.cards.raiseTo", { amount })
      : t("board.cards.betTo", { amount });

  const fill = lastIndex > 0 ? index / lastIndex : 1;
  const wagerName = action === "raise" ? t("board.cards.wagerRaise") : t("board.cards.wagerBet");

  return (
    <section className="poker-wager" aria-label={wagerName}>
      <div className="wager-presets" role="group" aria-label={t("board.cards.betSizes")}>
        {sizes.map((size) => (
          <Button
            key={size.label}
            type="button"
            variant="secondary"
            size="sm"
            aria-pressed={amount === size.value}
            onClick={() => setSelected(size.value)}
          >
            <span>{size.label}</span>
            <small>{size.value}</small>
          </Button>
        ))}
      </div>
      <div className="poker-wager-row">
        <div className="poker-wager-slider">
          <output className="poker-wager-amount" aria-hidden="true">
            <small>
              {allIn
                ? t("board.cards.wagerAllIn")
                : action === "raise"
                  ? t("board.cards.raiseToShort")
                  : t("board.cards.betShort")}
            </small>
            <strong>{amount}</strong>
          </output>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={t("board.cards.decreaseWager")}
            disabled={index === 0}
            onClick={() => setSelected(min + Math.max(0, index - 1) * step)}
          >
            −
          </Button>
          <input
            aria-label={action === "raise" ? t("board.cards.raiseTotal") : t("board.cards.betAmount")}
            aria-valuetext={t(
              amount === max ? "board.cards.wagerValueAllIn" : "board.cards.wagerValue",
              { amount },
            )}
            type="range"
            min={0}
            max={lastIndex}
            step={1}
            value={index}
            disabled={lastIndex === 0}
            style={
              { "--fill": fill } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
            onChange={(event) =>
              setSelected(Math.min(max, min + Number(event.target.value) * step))
            }
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={t("board.cards.increaseWager")}
            disabled={index === lastIndex}
            onClick={() => setSelected(Math.min(max, min + (index + 1) * step))}
          >
            +
          </Button>
        </div>
        <Button
          className="poker-wager-submit"
          variant="default"
          size="lg"
          data-all-in={allIn}
          onClick={() =>
            allIn
              ? send("all_in", {})
              : send(action, action === "raise" ? { raiseTo: amount } : { amount })
          }
        >
          {label}
        </Button>
      </div>
    </section>
  );
}
