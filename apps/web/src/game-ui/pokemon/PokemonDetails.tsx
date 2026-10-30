import type { ReactNode } from "react";
import type { Monster } from "@/features/pokemon/playback";
import { Sprite, HealthBar } from "./MonsterView";
import { TypeBadge } from "./TypeBadge";
import { BattleInspect } from "./BattleInspect";
import { effectLabel, effectNote, statusLabel, statLabel } from "./battleLabels";
import { useT } from "@/i18n";

export function PokemonDetails({
  mon,
  own = false,
  children,
  disabled = false,
}: {
  mon: Monster;
  own?: boolean;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const t = useT();

  if (mon.hidden)
    return (
      <span className="poke-roster-slot">
        <Sprite mon={mon} />
      </span>
    );
  const name = mon.name ?? mon.species ?? "Pokémon";

  return (
    <BattleInspect
      title={`${name} · Lv. ${mon.level ?? "?"}`}
      description={t(own ? "board.pokemon.yourPokemon" : "board.pokemon.revealedInfo")}
      className={children ? "poke-switch-card" : "poke-roster-inspect"}
      disabled={disabled}
      clickToOpen={!children}
      content={
        <>
          <div className="poke-detail-summary">
            <Sprite mon={mon} />
            <div>
              <div className="poke-mon-types">
                {mon.types?.map((type) => (
                  <TypeBadge key={type} type={type} />
                ))}
              </div>
              <HealthBar mon={mon} />
              <p>
                {mon.fainted
                  ? t("board.pokemon.fainted")
                  : t(own ? "board.pokemon.hpValue" : "board.pokemon.publicHpValue", {
                      condition: mon.condition?.split(" ")[0] ?? t("board.pokemon.unknown"),
                    })}{" "}
                {statusLabel(mon.condition?.split(" ")[1] ?? "", t)}
              </p>
              {mon.active && <small>{t("board.pokemon.currentlyBattling")}</small>}
            </div>
          </div>
          {own && mon.stats && (
            <>
              <h3>{t("board.pokemon.baseStats")}</h3>
              <dl className="poke-detail-stats">
                {(["atk", "def", "spa", "spe"] as const).map((stat) => (
                  <div key={stat}>
                    <dt>{statLabel(stat, t)}</dt>
                    <dd>{mon.stats?.[stat] ?? "?"}</dd>
                  </div>
                ))}
              </dl>
              <p className="poke-detail-note">{t("board.pokemon.beforeModifiers")}</p>
            </>
          )}
          {mon.effects?.length || Object.values(mon.boosts ?? {}).some(Boolean) ? (
            <section>
              <h3>{t("board.pokemon.battleEffects")}</h3>
              <div className="poke-status-tags">
                {Object.entries(mon.boosts ?? {})
                  .filter(([, value]) => value)
                  .map(([stat, value]) => (
                    <span key={stat}>
                      {statLabel(stat, t)} {value! > 0 ? "+" : ""}
                      {t("board.pokemon.stages", { value })}
                    </span>
                  ))}
              </div>
              {mon.effects?.map((effect) => (
                <p key={effect}>
                  <strong>{effectLabel(effect, t)}</strong> ·{" "}
                  {effectNote(effect, t) ?? t("board.pokemon.activeEffect")}
                </p>
              ))}
            </section>
          ) : null}
          <h3>{t(own ? "board.pokemon.moves" : "board.pokemon.revealedMoves")}</h3>
          <div className="poke-detail-moves">
            {own && mon.moves?.length ? (
              mon.moves.map((move) => (
                <div key={move.name}>
                  <strong>{move.name}</strong>
                  <span>
                    {move.pp}/{move.maxpp} PP
                  </span>
                </div>
              ))
            ) : mon.revealedMoves?.length ? (
              mon.revealedMoves.map((move) => (
                <div key={move}>
                  <strong>{move}</strong>
                  <span>{t("board.pokemon.revealed")}</span>
                </div>
              ))
            ) : (
              <p>
                {own
                  ? t("board.pokemon.noMoveDetails")
                  : t("board.pokemon.noRevealedMoves")}
              </p>
            )}
          </div>
          {!own && (
            <p className="poke-detail-note">{t("board.pokemon.hiddenNote")}</p>
          )}
        </>
      }
    >
      {children ?? (
        <button
          className="poke-roster-slot poke-inspect-roster"
          aria-label={t("board.pokemon.inspectName", { name })}
          data-active={mon.active}
          data-fainted={mon.fainted}
        >
          <Sprite mon={mon} />
        </button>
      )}
    </BattleInspect>
  );
}
