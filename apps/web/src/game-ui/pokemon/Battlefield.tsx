import { PokemonDetails } from "./PokemonDetails";
import { GamePlayerAvatar } from "../GamePlayerAvatar";
import { PlayerName } from "../PlayerName";
import type { GamePlayer } from "@/features/shared/gameOverCopy";
import { useEffect, useRef } from "react";
import { BattleEffects } from "./BattleEffects";
import type { Cue, Side } from "@/features/pokemon/playback";
import { MonsterStatus, Sprite } from "./MonsterView";
import { play, type SoundName } from "@/lib/sound";

const cueSound: Partial<Record<Cue["kind"], SoundName>> = {
  move: "attack",
  hit: "hit",
  faint: "faint",
  enter: "switch",
};

/** Cues exist only while new protocol lines play back; snaps and reduced motion clear them, so each sound marks a fresh event. */
function useCueSound(cue?: Cue | null) {
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!cue || last.current === cue.id) return;
    last.current = cue.id;
    const sound = cueSound[cue.kind];

    if (sound)
      play(
        sound,
        cue.kind === "move" && cue.animationPhase === "prepare"
          ? { pitch: 1.15, volume: 0.6 }
          : undefined,
      );
  }, [cue]);
}

export function Battlefield({
  sides,
  ownSeat,
  names,
  players,
  turn,
  cue,
  onComplete,
}: {
  onComplete: (id: number) => void;
  cue?: Cue | null;
  sides: Side[];
  ownSeat: string;
  names: Record<string, string>;
  details: Record<string, string | null>;
  players: Record<string, GamePlayer>;
  turn: number;
}) {
  const stage = useRef<HTMLElement>(null);
  useCueSound(cue);

  return (
    <section ref={stage} className="poke-field" aria-label="Active Pokémon">
      <span className="poke-sky" aria-hidden="true" />
      <span className="poke-horizon" aria-hidden="true" />
      <span className="poke-turn">Turn {turn}</span>
      {sides.map((side) => {
        const mon = side.pokemon.find((p) => p.active) ?? side.pokemon[0];
        const own = side.seat === ownSeat;
        const player = players[side.seat] ?? { id: side.seat, name: names[side.seat] };

        const trainer = (
          <div className="poke-trainer">
            <span className="game-player-identity">
              <GamePlayerAvatar player={player} />
              <PlayerName player={player} fallback={names[side.seat]} />
            </span>
            <div className="pokemon-team-row poke-roster" aria-label={`${names[side.seat]} team`}>
              {side.pokemon.map((member, i) => (
                <PokemonDetails key={i} mon={member} own={own && Boolean(member.moves)} />
              ))}
            </div>
          </div>
        );

        return (
          <article
            className="poke-combatant"
            data-own={own}
            key={side.seat}
            aria-label={names[side.seat]}
          >
            <div className="poke-hud">
              {trainer}
              {mon && <MonsterStatus mon={mon} own={own} />}
            </div>
            {mon && (
              <div
                className="poke-platform"
                data-pokemon-seat={side.seat}
                data-fainted={mon.fainted}
                data-animation={cue?.actor === side.seat ? cue.kind : undefined}
                key={cue?.actor === side.seat ? cue.id : "idle"}
              >
                <span className="poke-platform-glow" aria-hidden="true" />
                <span className="poke-battler-motion">
                  <Sprite mon={mon} back={own} animated />
                </span>
              </div>
            )}
          </article>
        );
      })}
      <BattleEffects stage={stage} cue={cue ?? null} bottomSeat={ownSeat} onComplete={onComplete} />
      {cue && (
        <div className="poke-effects" data-kind={cue.kind} data-own={cue.actor === ownSeat}>
          {cue.label && (
            <span className="poke-cue-label" role="status" key={cue.id}>
              {cue.label}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
