import type { Side } from "@/features/pokemon/playback";
import { HealthBar, Sprite } from "./MonsterView";

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
                {remaining} / {side.pokemon.length} remaining
              </span>
            </header>
            <div className="poke-last-move" aria-live="polite">
              <small>Last move</small>
              {move ? (
                <>
                  <strong>{move[3]}</strong>
                  <span>
                    {move[2]?.replace(/^p[12][a-z]?: /, "")} used {move[3]}
                  </span>
                </>
              ) : (
                <span>No move yet</span>
              )}
            </div>
            <div className="poke-spectator-roster">
              {side.pokemon.map((mon, index) => {
                const label = mon.hidden
                  ? "Unrevealed"
                  : mon.fainted
                    ? "Fainted"
                    : mon.active
                      ? "In battle"
                      : "On bench";

                return (
                  <div
                    className="poke-team-member"
                    data-state={mon.fainted ? "fainted" : mon.active ? "active" : "bench"}
                    key={mon.slot ?? index}
                  >
                    <Sprite mon={mon} />
                    <strong>
                      {mon.hidden ? "Unknown" : (mon.name ?? mon.species ?? "Unknown")}
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
