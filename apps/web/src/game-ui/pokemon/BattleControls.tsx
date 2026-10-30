import type { WireValue } from "@llmgames/game-catalog";
import type { Side } from "@/features/pokemon/playback";
import { Button } from "@/components/ui/button";
import { MoveButton } from "./MoveButton";
import { HealthBar, Sprite } from "./MonsterView";
import { PokemonDetails } from "./PokemonDetails";
import { useT } from "@/i18n";

export type Move = {
  slot: number;
  name: string;
  type?: string;
  pp?: number;
  maxpp?: number;
  disabled?: boolean;
  power?: number;
  accuracy?: number | boolean;
  description?: string;
  fullDescription?: string;
  category?: string;
  priority?: number;
  sameTypeBonus?: boolean;
  typeMatchup?: number;
  matchupTarget?: string;
  damage?: string;
};

export type Decision = {
  forceSwitch: boolean;
  moves: Move[];
  switches: { slot: number; name: string }[];
};

export function BattleControls({
  own,
  decision,
  canMove,
  canSwitch,
  message,
  send,
}: {
  own?: Side;
  decision: Decision | null;
  canMove: boolean;
  canSwitch: boolean;
  message: string;
  send: (name: string, data: WireValue) => void;
}) {
  const t = useT();
  const showMoves = Boolean(decision && !decision.forceSwitch && decision.moves.length > 0);

  return (
    <section
      className="pokemon-decision poke-controls"
      data-force-switch={decision?.forceSwitch || undefined}
      data-has-moves={showMoves || undefined}
      aria-label={t("board.pokemon.battleControls")}
      tabIndex={0}
    >
      {decision ? (
        <>
          {showMoves && (
            <div className="poke-control-group poke-control-moves">
              <div className="poke-moves">
                {decision.moves.map((move, index) => (
                  <MoveButton
                    key={move.slot}
                    move={move}
                    index={index}
                    disabled={!canMove || Boolean(move.disabled) || move.pp === 0}
                    onChoose={() => send("pokemon_move", { slot: move.slot })}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="poke-control-group poke-control-switches">
            {decision.forceSwitch && (
              <p className="poke-controls-label" aria-hidden="true">
                {t("board.pokemon.sendNext")}
              </p>
            )}
            <div className="poke-switches">
              {own?.pokemon.map((mon, index) => {
                const choice = decision.switches.find((option) => option.slot === index + 1),
                  available = canSwitch && Boolean(choice) && !mon.fainted && !mon.active;

                return (
                  <PokemonDetails key={index} mon={mon} own disabled={!available}>
                    <Button
                      className="poke-switch"
                      variant="secondary"
                      data-state={mon.fainted ? "fainted" : mon.active ? "active" : "bench"}
                      disabled={!available}
                      onClick={() => {
                        if (choice) send("pokemon_switch", { slot: choice.slot });
                      }}
                      aria-label={`${mon.name ?? mon.species ?? t("board.pokemon.name")}${
                        mon.fainted
                          ? `, ${t("board.pokemon.faintedLower")}`
                          : mon.active
                            ? `, ${t("board.pokemon.activeLower")}`
                            : ""
                      }`}
                      title={`${mon.name ?? mon.species} · ${mon.condition ?? ""}`}
                    >
                      <strong>{mon.name ?? mon.species}</strong>
                      <Sprite mon={mon} />
                      <HealthBar mon={mon} />
                      <small>
                        {mon.fainted
                          ? t("board.pokemon.fainted")
                          : mon.active
                            ? t("board.pokemon.active")
                            : mon.condition}
                      </small>
                    </Button>
                  </PokemonDetails>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <p className="poke-waiting" role="status">
          <span className="poke-waiting-dot" aria-hidden="true" />
          {message}
        </p>
      )}
    </section>
  );
}
