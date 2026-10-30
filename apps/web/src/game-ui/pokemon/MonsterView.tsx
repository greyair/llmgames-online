import { useSyncExternalStore } from "react";
import { TypeBadge } from "./TypeBadge";
import { effectLabel, statusLabel, statLabel } from "./battleLabels";
import type { Monster } from "@/features/pokemon/playback";
import { useT } from "@/i18n";

export function health(mon: Monster) {
  const match = mon.condition?.match(/^(\d+)\/(\d+)/);

  return match
    ? Math.max(0, Math.min(100, (Number(match[1]) / Math.max(1, Number(match[2]))) * 100))
    : mon.fainted
      ? 0
      : null;
}

const motionQuery = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", onChange);

  return () => media.removeEventListener("change", onChange);
}

const prefersReducedMotion = () => window.matchMedia(motionQuery).matches;

const serverReducedMotion = () => true;

export function Sprite({
  mon,
  back = false,
  animated = false,
}: {
  mon: Monster;
  back?: boolean;
  animated?: boolean;
}) {
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    prefersReducedMotion,
    serverReducedMotion,
  );

  const name = (mon.sprite ?? mon.species ?? mon.name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const still = `/pokemon/${back ? "full-back" : "gen1"}/${name}.png`;
  const moving = animated && !reducedMotion && !mon.fainted;

  return mon.hidden || !name ? (
    <svg className="poke-unknown" role="img" aria-label="Unrevealed Pokémon" viewBox="0 0 32 32">
      <circle className="poke-unknown-shell" cx="16" cy="16" r="12.5" />
      <path className="poke-unknown-top" d="M3.5 16a12.5 12.5 0 0 1 25 0z" />
      <path className="poke-unknown-band" d="M3.5 16h25" />
      <circle className="poke-unknown-core" cx="16" cy="16" r="3.6" />
    </svg>
  ) : (
    <img
      key={`${name}-${back}-${moving}`}
      className="poke-sprite"
      data-animated={moving}
      src={moving ? `/pokemon/${back ? "gen5ani-back" : "gen5ani"}/${name}.gif` : still}
      alt=""
      onError={(event) => {
        const image = event.currentTarget;

        if (image.dataset.animated === "true") {
          image.dataset.animated = "false";
          image.src = still;
        } else if (!image.src.endsWith("/pokemon/placeholder.svg")) {
          image.src = "/pokemon/placeholder.svg";
        }
      }}
    />
  );
}

export function HealthBar({ mon }: { mon: Monster }) {
  const t = useT();
  const hp = health(mon);

  return (
    <div
      className="poke-health"
      role="meter"
      aria-label={t("board.pokemon.health", {
        name: mon.name ?? mon.species ?? t("board.pokemon.name"),
      })}
      aria-valuenow={hp ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={mon.condition ?? t("board.pokemon.unknown")}
    >
      <span
        data-range={hp !== null && hp <= 20 ? "low" : hp !== null && hp <= 50 ? "medium" : "high"}
        style={{ width: `${hp ?? 0}%` }}
      />
    </div>
  );
}

const statusCode = (status?: string) => status?.split(" ")[0];

/** Gen 1 shows badly poisoned as plain PSN. */
const statusSticker = (code?: string) =>
  ({ tox: "PSN", fnt: "FNT" })[code ?? ""] ?? code?.toUpperCase();

export function MonsterStatus({
  mon,
  showStats = false,
  own = false,
}: {
  mon: Monster;
  showStats?: boolean;
  own?: boolean;
}) {
  const t = useT();

  if (mon.hidden)
    return (
      <div className="poke-status" data-hidden="true">
        {t("board.pokemon.unrevealedPokemon")}
      </div>
    );

  const hp = health(mon),
    status = mon.condition?.split(" ").slice(1).join(" "),
    code = statusCode(status);

  const range = hp !== null && hp <= 20 ? "low" : hp !== null && hp <= 50 ? "medium" : "high";

  return (
    <div
      className="poke-status"
      data-own={own || undefined}
      data-fainted={mon.fainted || undefined}
    >
      <div className="poke-mon-name">
        <strong>{mon.name ?? mon.species ?? t("board.pokemon.name")}</strong>
        <span className="poke-level">Lv{mon.level ?? "?"}</span>
        {mon.fainted ? (
          <span className="poke-status-sticker" data-status="fnt">
            FNT
          </span>
        ) : (
          status && (
            <span className="poke-status-sticker" data-status={code} title={statusLabel(status)}>
              <span aria-hidden="true">{statusSticker(code)}</span>
              <span className="sr-only">{statusLabel(status)}</span>
            </span>
          )
        )}
      </div>
      <div className="poke-hp-row" data-range={range}>
        <span className="poke-hp-tag" aria-hidden="true">
          HP
        </span>
        <HealthBar mon={mon} />
      </div>
      <div className="poke-hp-line">
        <span>
          {mon.fainted
            ? t("board.pokemon.fainted")
            : (mon.condition?.split(" ")[0] ?? t("board.pokemon.hpUnknown"))}
        </span>
        <strong>{hp !== null ? `${Math.ceil(hp)}%` : ""}</strong>
      </div>
      <div className="poke-mon-chips">
        <div className="poke-mon-types">
          {mon.types?.map((type) => (
            <TypeBadge key={type} type={type} />
          ))}
        </div>
        <div className="poke-status-tags">
          {mon.effects?.map((effect) => (
            <span key={effect} data-effect="true">
              {effectLabel(effect)}
            </span>
          ))}
          {Object.entries(mon.boosts ?? {})
            .filter(([, value]) => value !== 0)
            .map(([stat, value]) => (
              <span key={stat} data-negative={value! < 0}>
                {statLabel(stat)} {value! > 0 ? "+" : ""}
                {value}
              </span>
            ))}
        </div>
      </div>
      {showStats && mon.stats && (
        <dl
          className="poke-stats"
          aria-label={t("board.pokemon.baseStatsYours")}
          title={t("board.pokemon.statsTip")}
        >
          {(
            [
              ["atk", "Atk"],
              ["def", "Def"],
              ["spa", "Special"],
              ["spe", "Speed"],
            ] as const
          ).map(
            ([key, label]) =>
              mon.stats?.[key] !== undefined && (
                <div key={key}>
                  <dt
                    title={
                      key === "spa"
                        ? t("board.pokemon.gen1Special")
                        : key === "atk"
                          ? t("board.pokemon.physicalAttack")
                          : key === "def"
                            ? t("board.pokemon.physicalDefense")
                            : t("board.pokemon.speed")
                    }
                  >
                    {label}
                  </dt>
                  <dd>{mon.stats[key]}</dd>
                </div>
              ),
          )}
        </dl>
      )}
    </div>
  );
}
