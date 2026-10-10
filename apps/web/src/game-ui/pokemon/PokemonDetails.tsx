import { knownValue } from "@/domain/view-contracts";
import type { ReactNode } from "react";
import type { Monster } from "@/features/pokemon/playback";
import { Sprite, HealthBar } from "./MonsterView";
import { TypeBadge } from "./TypeBadge";
import { BattleInspect } from "./BattleInspect";
import { effectLabel, effectDescription, statusLabel, statLabel } from "./battleLabels";

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
      description={own ? "Your Pokémon" : "Revealed information"}
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
                  ? "Fainted"
                  : `${mon.condition?.split(" ")[0] ?? "Unknown"}${own ? " HP" : " public HP"}`}{" "}
                {statusLabel(mon.condition?.split(" ")[1] ?? "")}
              </p>
              {mon.active && <small>Currently battling</small>}
            </div>
          </div>
          {own && mon.stats && (
            <>
              <h3>Base stats</h3>
              <dl className="poke-detail-stats">
                {(["atk", "def", "spa", "spe"] as const).map((stat) => (
                  <div key={stat}>
                    <dt>{statLabel(stat)}</dt>
                    <dd>{mon.stats?.[stat] ?? "?"}</dd>
                  </div>
                ))}
              </dl>
              <p className="poke-detail-note">
                Before battle modifiers. Gen 1 uses one Special stat.
              </p>
            </>
          )}
          {mon.effects?.length || Object.values(mon.boosts ?? {}).some(Boolean) ? (
            <section>
              <h3>Battle effects</h3>
              <div className="poke-status-tags">
                {Object.entries(mon.boosts ?? {})
                  .filter(([, value]) => value)
                  .map(([stat, value]) => (
                    <span key={stat}>
                      {statLabel(stat)} {value! > 0 ? "+" : ""}
                      {value} stages
                    </span>
                  ))}
              </div>
              {mon.effects?.map((effect) => (
                <p key={effect}>
                  <strong>{effectLabel(effect)}</strong> ·{" "}
                  {knownValue(effectDescription, effect) ?? "Active battle effect."}
                </p>
              ))}
            </section>
          ) : null}
          <h3>{own ? "Moves" : "Revealed moves"}</h3>
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
                  <span>Revealed</span>
                </div>
              ))
            ) : (
              <p>
                {own
                  ? "Move details are not available in this snapshot."
                  : "No moves revealed yet."}
              </p>
            )}
          </div>
          {!own && (
            <p className="poke-detail-note">Unrevealed moves and exact stats stay hidden.</p>
          )}
        </>
      }
    >
      {children ?? (
        <button
          className="poke-roster-slot poke-inspect-roster"
          aria-label={`Inspect ${name}`}
          data-active={mon.active}
          data-fainted={mon.fainted}
        >
          <Sprite mon={mon} />
        </button>
      )}
    </BattleInspect>
  );
}
