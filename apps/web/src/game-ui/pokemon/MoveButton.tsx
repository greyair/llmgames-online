import { isNumber } from "@llmgames/game-catalog";

import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { TypeBadge } from "./TypeBadge";
import { BattleInspect } from "./BattleInspect";
import type { Move } from "./BattleControls";
import { useT } from "@/i18n";

function MoveDetails({ move }: { move: Move }) {
  const t = useT();

  return (
    <>
      <p>{move.fullDescription ?? move.description ?? t("board.pokemon.noEffect")}</p>
      <dl className="poke-move-facts">
        <div>
          <dt>{t(move.damage ? "board.pokemon.damage" : "board.pokemon.basePower")}</dt>
          <dd>{move.damage ?? (move.power || "—")}</dd>
        </div>
        <div>
          <dt>{t("board.pokemon.baseAccuracy")}</dt>
          <dd>
            {move.accuracy === true
              ? t("board.pokemon.alwaysHits")
              : isNumber(move.accuracy)
                ? move.accuracy + "%"
                : t("board.pokemon.varies")}
          </dd>
        </div>
        <div>
          <dt>PP</dt>
          <dd>
            {move.pp ?? "?"} / {move.maxpp ?? "?"}
          </dd>
        </div>
      </dl>
      {move.sameTypeBonus && <p>{t("board.pokemon.stab")}</p>}
      {move.typeMatchup !== undefined && (
        <p>
          {t("board.pokemon.typeMatchup", {
            target: move.matchupTarget ?? t("board.pokemon.opponent"),
            multiplier: move.typeMatchup,
          })}
        </p>
      )}
      {Boolean(move.priority) && (
        <p>
          {t("board.pokemon.priority", {
            priority: `${move.priority! > 0 ? "+" : ""}${move.priority}`,
          })}
        </p>
      )}
      {(move.disabled || move.pp === 0) && (
        <p className="poke-move-unavailable">
          {t(move.pp === 0 ? "board.pokemon.noPp" : "board.pokemon.moveUnavailable")}
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
