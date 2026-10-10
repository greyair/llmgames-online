import type { WireValue } from "@llmgames/game-catalog";
import type { ClientView } from "@/domain/game-state";

import { useContext, useEffect, useState } from "react";
import { Battlefield } from "./pokemon/Battlefield";
import { BattleControls, type Decision } from "./pokemon/BattleControls";
import { BattleLog } from "./pokemon/BattleLog";
import { SpectatorTeams } from "./pokemon/SpectatorTeams";
import "./pokemon/pokemon.css";
import "./sketch/pokemon.css";
import { usePokemonPlayback } from "./pokemon/useBattlePlayback";
import { playerPrimaryName, playerIdentityDetail } from "@/features/shared/playerIdentity";
import { PokemonPlaybackSettledContext } from "./pokemon/PokemonPlaybackContext";

export function Pokemon({
  state,
  send,
}: {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
}) {
  const sides = state.sides ?? [];
  const ownSeat = state.yourSeat ?? state.battleSeats?.[state.you?.playerId ?? ""] ?? "p1";
  const onPlaybackSettled = useContext(PokemonPlaybackSettledContext) ?? undefined;

  const playback = usePokemonPlayback(
    sides,
    state.battleLog ?? [],
    state.battleLogOffset ?? 0,
    String(state.roomCode ?? "pokemon"),
    Boolean(state.replayReadOnly),
    onPlaybackSettled,
  );

  useEffect(() => {
    if (
      state.status === "ended" &&
      !playback.busy &&
      playback.sourceEnd >= (state.battleLogOffset ?? 0) + (state.battleLog?.length ?? 0)
    )
      onPlaybackSettled?.();
  }, [
    state.status,
    state.battleLogOffset,
    state.battleLog?.length,
    playback.busy,
    playback.sourceEnd,
    onPlaybackSettled,
  ]);
  const own = playback.sides.find((side) => side.seat === ownSeat);
  const allowed = state.status === "playing" && !state.you?.isSpectator && !state.replayReadOnly;
  const decision = allowed ? (state.decision ?? null) : null;
  const [heldDecision, setHeldDecision] = useState<Decision | null>(null);
  useEffect(() => {
    if (decision && !playback.busy) setHeldDecision(decision);
  }, [decision, playback.busy]);

  const shownDecision = playback.busy
    ? heldDecision
    : (decision ?? (allowed ? heldDecision : null));

  const canMove = Boolean(
    allowed &&
    !playback.busy &&
    !shownDecision?.forceSwitch &&
    state.you?.legalActions?.includes("pokemon_move"),
  );

  const canSwitch = Boolean(
    allowed && !playback.busy && state.you?.legalActions?.includes("pokemon_switch"),
  );

  const names = Object.fromEntries(
    sides.map((side, index) => {
      const player = state.players?.find(
        (player) => state.battleSeats?.[player.id] === side.seat,
      ) ??
        state.players?.[index] ?? { id: side.seat, name: `Trainer ${index + 1}` };

      return [side.seat, playerPrimaryName(player, `Trainer ${index + 1}`)];
    }),
  );

  const details = Object.fromEntries(
    sides.map((side, index) => [
      side.seat,
      playerIdentityDetail(
        state.players?.find((player) => state.battleSeats?.[player.id] === side.seat) ??
          state.players?.[index] ??
          {},
      ),
    ]),
  );

  const spectating = Boolean(state.you?.isSpectator || state.replayReadOnly);
  const publicLogs = state.battleLog ?? [];

  const displayedLogs = playback.busy
    ? publicLogs.slice(
        0,
        Math.max(
          0,
          (playback.cue ? Math.floor(playback.cue.id / 2) + 1 : playback.sourceEnd) -
            (state.battleLogOffset ?? 0),
        ),
      )
    : publicLogs;

  const latestMove = [...displayedLogs]
    .reverse()
    .find((line) => line.startsWith("|move|"))
    ?.split("|");

  const moveAnnouncement =
    playback.cue?.label ||
    (latestMove
      ? `${latestMove[2]?.replace(/^p[12][a-z]?: /, "")} used ${latestMove[3]}`
      : "Waiting for the first move");

  const message =
    state.status === "ended"
      ? "Battle finished."
      : state.you?.isSpectator || state.replayReadOnly
        ? "Watching the battle."
        : "Choice submitted. Waiting for the other trainer.";

  const controlsMessage = playback.busy ? playback.cue?.label || moveAnnouncement : message;

  return (
    <div className="pokemon-stage poke-workspace" data-spectating={spectating}>
      {spectating && (
        <div className="poke-team-rail poke-team-rail-left">
          <SpectatorTeams
            sides={playback.sides.filter((side) => side.seat === ownSeat)}
            names={names}
            details={details}
            logs={displayedLogs}
          />
        </div>
      )}
      <Battlefield
        onComplete={playback.complete}
        cue={playback.cue}
        sides={playback.sides}
        ownSeat={ownSeat}
        names={names}
        details={details}
        players={Object.fromEntries(
          sides.map((side, index) => [
            side.seat,
            state.players?.find((player) => state.battleSeats?.[player.id] === side.seat) ??
              state.players?.[index] ?? { id: side.seat, name: names[side.seat] },
          ]),
        )}
        turn={state.battleTurn ?? state.turnState?.turnNumber ?? 1}
      />
      <>
        {spectating ? (
          <div className="poke-spectator-announcement" role="status">
            <strong key={moveAnnouncement}>{moveAnnouncement}</strong>
          </div>
        ) : (
          <BattleControls
            own={own}
            decision={shownDecision}
            canMove={canMove}
            canSwitch={canSwitch}
            message={controlsMessage}
            send={send}
          />
        )}
      </>
      {spectating ? (
        <div className="poke-team-rail poke-team-rail-right">
          <SpectatorTeams
            sides={playback.sides.filter((side) => side.seat !== ownSeat)}
            names={names}
            details={details}
            logs={displayedLogs}
          />
        </div>
      ) : (
        <aside className="poke-observer-sidebar">
          <BattleLog lines={displayedLogs} offset={state.battleLogOffset} />
        </aside>
      )}
    </div>
  );
}
