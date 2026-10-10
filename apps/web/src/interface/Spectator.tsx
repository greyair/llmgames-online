import { SITE_URL } from "@/lib/siteMetadata";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import type { ClientView } from "@/domain/game-state";
import { Chrome } from "./Chrome";
import { MatchDesk } from "@/game-ui/MatchDesk";
import { LoadingPanel } from "@/components/ui/loading-panel";
import { GameMark } from "./GameMark";
import "./spectator.css";
import { visibleGames } from "./catalog";

export type PublicMatch = ClientView & { broadcastId: string };

function hideRoomCode(match: PublicMatch): PublicMatch {
  const copy = { ...match };
  delete copy.roomCode;

  return copy;
}

export function Spectator({
  rooms,
  renderBoard,
  selectedState,
  selectedId,
  message,
  actions,
  operator,
  capture = false,
}: {
  rooms: PublicMatch[];
  renderBoard: (state: ClientView) => ReactNode;
  selectedState?: PublicMatch | null;
  selectedId?: string | null;
  message?: string;
  actions?: ReactNode;
  operator?: boolean;
  capture?: boolean;
}) {
  const liveRooms = rooms.filter((room) => room.status === "playing");
  const selected = selectedId === undefined ? (liveRooms[0]?.broadcastId ?? null) : selectedId;

  const match = selected
    ? selectedId === undefined
      ? liveRooms.find((room) => room.broadcastId === selected)
      : selectedState
    : null;

  if (selected && match) {
    const publicView = {
      ...hideRoomCode(match),
      you: { isSpectator: true, isHost: false, isYourTurn: false, legalActions: [] },
      replayReadOnly: false,
      broadcastPublic: true,
    };

    const desk = (
      <MatchDesk broadcast state={publicView} onExit={() => {}}>
        {renderBoard(publicView)}
      </MatchDesk>
    );

    return operator ? (
      <SpectatorFrame actions={actions} operator capture={capture}>
        {desk}
      </SpectatorFrame>
    ) : (
      desk
    );
  }

  if (selected)
    return (
      <SpectatorFrame actions={actions} operator={operator} capture={capture}>
        <LoadingPanel label={message || "Loading match…"} />
      </SpectatorFrame>
    );

  return (
    <SpectatorFrame actions={actions} operator={operator} capture={capture}>
      <section className="watch-empty" data-surface="dark">
        <div className="watch-empty-inner">
          <div className="watch-empty-brand">
            <img src="/llmgames-mark-v4.svg" width="36" height="36" alt="" />
            <span>llmgames.online</span>
          </div>
          <p className="watch-empty-status">
            <span aria-hidden="true" />
            Off air
          </p>
          <h1>No games are live right now</h1>
          <p className="watch-invitation">The next match will appear here automatically.</p>
          <section className="watch-previews" aria-label="Games you can play">
            {visibleGames.map((game, index) => (
              <figure
                key={game.id}
                className="reveal-pop"
                style={
                  { "--i": index } satisfies CSSProperties & {
                    [property: `--${string}`]: string | number | undefined;
                  }
                }
              >
                <GameMark id={game.id} size={52} />
                <figcaption>{game.title}</figcaption>
              </figure>
            ))}
          </section>
          <a className="watch-address" href={SITE_URL}>
            llmgames.online <Icon name="arrow" size={24} />
          </a>
        </div>
      </section>
    </SpectatorFrame>
  );
}

function SpectatorFrame({
  children,
  actions,
  operator = false,
  capture = false,
}: {
  children: ReactNode;
  actions?: ReactNode;
  operator?: boolean;
  capture?: boolean;
}) {
  const frame = (
    <Chrome active="watch" actions={actions} operator={operator} fitViewport={operator}>
      {children}
    </Chrome>
  );

  return capture ? <div className="spectator-capture">{frame}</div> : frame;
}
