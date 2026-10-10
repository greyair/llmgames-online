import type { WireValue } from "@llmgames/game-catalog";
import { useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";

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
  const [selected, setSelected] = useState(min);
  const snap = (value: number) => Math.min(max, Math.max(min, Math.ceil(value / step) * step));
  const amount = snap(selected);

  // A pot-sized raise includes the call, then raises by the pot after calling.
  const potSize = (fraction: number) =>
    snap(action === "raise" ? currentBet + (pot + toCall) * fraction : pot * fraction);

  const sizes = [
    { label: "Min", value: min },
    { label: "½ pot", value: potSize(0.5) },
    { label: "Pot", value: potSize(1) },
    { label: "All in", value: max },
  ];

  const lastIndex = Math.ceil((max - min) / step);
  const index = amount === max ? lastIndex : Math.round((amount - min) / step);
  const allIn = amount === max && canAllIn;
  const label = allIn ? `All in ${amount}` : `${action === "raise" ? "Raise to" : "Bet"} ${amount}`;
  const fill = lastIndex > 0 ? index / lastIndex : 1;

  return (
    <section className="poker-wager" aria-label={action === "raise" ? "Raise size" : "Bet size"}>
      <div className="wager-presets" role="group" aria-label="Bet sizes">
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
            <small>{allIn ? "All in" : action === "raise" ? "Raise to" : "Bet"}</small>
            <strong>{amount}</strong>
          </output>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Decrease wager"
            disabled={index === 0}
            onClick={() => setSelected(min + Math.max(0, index - 1) * step)}
          >
            −
          </Button>
          <input
            aria-label={action === "raise" ? "Raise total" : "Bet amount"}
            aria-valuetext={`${amount} chips${amount === max ? " · all in" : ""}`}
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
            aria-label="Increase wager"
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
