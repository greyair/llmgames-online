import type { Side } from "@/features/pokemon/playback";
import { HealthBar, Sprite } from "./MonsterView";
import { useT } from "@/i18n";

/** Only display the public team and move information in the current projection. */
export function SpectatorTeams({
  sides,
  names,
  details,
  logs,
}: {
  sides: Side[];
  names: Record<string, string>;
  logs: string[];
  details: Record<string, string | null>;
}) {
  const t = useT();

  return (
    <div className="poke-spectator-teams">
      {sides.map((side) => {
        const move = [...logs]
          .reverse()
          .find((line) => line.startsWith(`|move|${side.seat}`))
          ?.split("|");

        const remaining = side.pokemon.filter((mon) => !mon.fainted).length;

        return (
          <section
            className="poke-team-panel"
            data-seat={side.seat}
            key={side.seat}
            aria-label={`${names[side.seat]} team`}
          >
            <header>
              <span className="player-name-label">
                <strong>{names[side.seat]}</strong>
                {details[side.seat] && <small>{details[side.seat]}</small>}
              </span>
              <span className="poke-team-count">
                {t("board.pokemon.remaining", {
                  remaining,
                  total: side.pokemon.length,
                })}
              </span>
            </header>
            <div className="poke-last-move" aria-live="polite">
              <small>{t("board.pokemon.lastMove")}</small>
              {move ? (
                <>
                  <strong>{move[3]}</strong>
                  <span>
                    {t("board.pokemon.usedMove", {
                      name: move[2]?.replace(/^p[12][a-z]?: /, "") ?? "",
                      move: move[3] ?? "",
                    })}
                  </span>
                </>
              ) : (
                <span>{t("board.pokemon.noMoveYet")}</span>
              )}
            </div>
            <div className="poke-spectator-roster">
              {side.pokemon.map((mon, index) => {
                const label = mon.hidden
                  ? t("board.pokemon.unrevealed")
                  : mon.fainted
                    ? t("board.pokemon.fainted")
                    : mon.active
                      ? t("board.pokemon.inBattle")
                      : t("board.pokemon.onBench");

                return (
                  <div
                    className="poke-team-member"
                    data-state={mon.fainted ? "fainted" : mon.active ? "active" : "bench"}
                    key={mon.slot ?? index}
                  >
                    <Sprite mon={mon} />
                    <strong>
                      {mon.hidden
                        ? t("board.pokemon.unknown")
                        : (mon.name ?? mon.species ?? t("board.pokemon.unknown"))}
                    </strong>
                    <small>{label}</small>
                    {!mon.hidden && <HealthBar mon={mon} />}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
