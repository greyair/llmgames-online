import { isNumber } from "@llmgames/game-catalog";

import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { TypeBadge } from "./TypeBadge";
import { BattleInspect } from "./BattleInspect";
import type { Move } from "./BattleControls";

function MoveDetails({ move }: { move: Move }) {
  return (
    <>
      <p>{move.fullDescription ?? move.description ?? "No additional effect."}</p>
      <dl className="poke-move-facts">
        <div>
          <dt>{move.damage ? "Damage" : "Base power"}</dt>
          <dd>{move.damage ?? (move.power || "—")}</dd>
        </div>
        <div>
          <dt>Base accuracy</dt>
          <dd>
            {move.accuracy === true
              ? "Always hits"
              : isNumber(move.accuracy)
                ? move.accuracy + "%"
                : "Varies"}
          </dd>
        </div>
        <div>
          <dt>PP</dt>
          <dd>
            {move.pp ?? "?"} / {move.maxpp ?? "?"}
          </dd>
        </div>
      </dl>
      {move.sameTypeBonus && <p>Same-type attack bonus: ×1.5 damage.</p>}
      {move.typeMatchup !== undefined && (
        <p>
          Type matchup vs {move.matchupTarget ?? "opponent"}: ×{move.typeMatchup}. Based on current
          types only, not a damage estimate.
        </p>
      )}
      {Boolean(move.priority) && (
        <p>
          Move priority: {move.priority! > 0 ? "+" : ""}
          {move.priority}. Priority acts before Speed.
        </p>
      )}
      {(move.disabled || move.pp === 0) && (
        <p className="poke-move-unavailable">
          {move.pp === 0 ? "No PP remaining." : "This move is currently unavailable."}
        </p>
      )}
    </>
  );
}

export function MoveButton({
  move,
  disabled,
  onChoose,
  index = 0,
}: {
  move: Move;
  disabled: boolean;
  onChoose: () => void;
  index?: number;
}) {
  return (
    <BattleInspect
      className="poke-move-anchor"
      title={move.name}
      description={[move.type, move.category].filter(Boolean).join(" · ")}
      content={<MoveDetails move={move} />}
      disabled={disabled}
    >
      <Button
        variant="secondary"
        className="pokemon-move poke-move"
        style={
          { "--i": index } satisfies CSSProperties & {
            [property: `--${string}`]: string | number | undefined;
          }
        }
        data-type={move.type?.toLowerCase()}
        data-empty={move.pp === 0 || undefined}
        disabled={disabled}
        onClick={onChoose}
      >
        <span className="poke-move-title">
          <strong>{move.name}</strong>
        </span>
        <span className="poke-move-meta">
          <TypeBadge type={move.type} />
          <small className="poke-move-pp">
            {isNumber(move.pp) ? `${move.pp}/${move.maxpp ?? move.pp} PP` : "— PP"}
          </small>
        </span>
      </Button>
    </BattleInspect>
  );
}
