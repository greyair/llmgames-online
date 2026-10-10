import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import { Button, ButtonLink, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Chrome } from "./Chrome";
import { GameScene } from "./GameScene";
import { SketchScene, hasSketchScene } from "./SketchScene";
import { GameMark } from "./GameMark";
import { gameRoute, visibleGames, getGame } from "./catalog";
import { getCurrentUser } from "@/services/auth";
import { go, useBrowserHref } from "@/lib/navigate";
import "./library.css";

const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;

export function GameGlyph({ id, crop = false }: { id: string; crop?: boolean }) {
  return (
    <div className={`game-glyph glyph-${id}`} data-game={id} data-surface="dark">
      {hasSketchScene(id) ? <SketchScene id={id} crop={crop} /> : <GameScene id={id} />}
    </div>
  );
}

/** A dark game card: native mark, title, pitch, an optional Play pill, and the game's pixel art peeking from the corner.
    The whole card is the link, so the Play pill is a styled span rather than a nested button. */
export function GameTile({
  id,
  pitch,
  className,
  index = 0,
  showPlay = true,
}: {
  id: string;
  pitch?: string;
  className?: string;
  index?: number;
  showPlay?: boolean;
}) {
  const game = getGame(id);

  return (
    <a
      className={cn("game-tile reveal", className)}
      data-game={id}
      data-surface="dark"
      href={gameRoute(id)}
      aria-label={`Play ${game?.title}`}
      style={
        { "--i": index } satisfies CSSProperties & {
          [property: `--${string}`]: string | number | undefined;
        }
      }
    >
      <div className="game-tile-copy">
        <div className="game-tile-head">
          <GameMark id={id} size={64} />
          <div className="library-caption">
            <h2>{game?.title}</h2>
            <span>
              {game?.players} players · {game?.category}
            </span>
          </div>
        </div>
        <p className="game-tile-pitch">{pitch ?? game?.detail}</p>
        {showPlay && (
          <span className={cn(buttonVariants({ size: "lg" }), "game-tile-play")} aria-hidden="true">
            Play {game?.title}
          </span>
        )}
      </div>
      <GameGlyph id={id} crop />
    </a>
  );
}

const filters = [
  ["all", "All games"],
  ["duel", "1 vs 1"],
  ["group", "Groups"],
] as const;

type Filter = (typeof filters)[number][0];

export function GameGrid({
  className = "library-grid",
  label,
  filter = "all",
}: {
  className?: string;
  label?: string;
  filter?: Filter;
}) {
  const games = visibleGames.filter(
    (game) => filter === "all" || (filter === "duel") === (game.players === "2"),
  );

  return (
    <section aria-label={label} className={className} data-dither-touch="off">
      {games.map((game, i) => (
        <GameTile key={game.id} id={game.id} index={i} showPlay={false} />
      ))}
    </section>
  );
}

export function Library({ onJoin }: { onJoin?: (code: string) => void } = {}) {
  const roomQuery = new URLSearchParams(useBrowserHref().split("?")[1] ?? "");
  const queryCode = (roomQuery.get("roomCode") ?? roomQuery.get("room"))?.toUpperCase() ?? "";

  const [ready, setReady] = useState(false),
    [pasting, setPasting] = useState(false),
    [filter, setFilter] = useState<Filter>("all");

  const codeInput = useRef<HTMLInputElement>(null);

  const pasteCode = async () => {
    setPasting(true);

    try {
      const pasted = (await navigator.clipboard.readText()).trim().toUpperCase();

      if (!ROOM_CODE.test(pasted)) {
        setError("Copy a 6-character room code and try again");

        return;
      }

      setCode(pasted);
      setError("");
    } catch {
      setError("Clipboard access is unavailable. Paste into the room-code field manually.");
    } finally {
      setPasting(false);
      codeInput.current?.focus();
    }
  };

  const [code, setCode] = useState(queryCode),
    [error, setError] = useState(""),
    [joining, setJoining] = useState(false);

  const join = async (roomCode = code.trim()) => {
    if (!ROOM_CODE.test(roomCode)) {
      setError("Enter a valid 6-character room code");

      return;
    }

    if (onJoin) {
      onJoin(roomCode);

      return;
    }

    setJoining(true);
    setError("");

    try {
      const user = await getCurrentUser();

      if (!user) {
        go(`/login?returnTo=${encodeURIComponent(`/play?roomCode=${roomCode}`)}`);

        return;
      }

      if (user.gamertag_selected !== 1) {
        go(`/onboarding?returnTo=${encodeURIComponent(`/play?roomCode=${roomCode}`)}`);

        return;
      }

      const { joinGameRoom } = await import("@/services/gameSocket");
      const room = await joinGameRoom({ roomCode });
      go(`${gameRoute(room.gameType)}?roomCode=${encodeURIComponent(room.roomCode)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Room not found");
    } finally {
      setJoining(false);
    }
  };

  useEffect(() => {
    setCode(queryCode);
    setReady(true);
  }, [queryCode]);
  useEffect(() => {
    if (!ROOM_CODE.test(queryCode) || onJoin) return;
    void join(queryCode);
  }, [queryCode, onJoin]);

  return (
    <Chrome>
      <header className="library-head">
        <div className="library-intro">
          <h1 className="reveal">What are we playing?</h1>
          <p
            className="reveal"
            style={
              { "--i": 1 } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
          >
            Pick a game to open a room, then invite a friend, your agent, or Jev.
          </p>
        </div>
        <form
          className="library-join reveal"
          style={
            { "--i": 2 } satisfies CSSProperties & {
              [property: `--${string}`]: string | number | undefined;
            }
          }
          aria-label="Join a game room"
          onSubmit={(event) => {
            event.preventDefault();
            void join();
          }}
        >
          <label className="library-join-label" htmlFor="library-room-code">
            Have a room code?
          </label>
          <div className="library-code-field">
            <Input
              id="library-room-code"
              ref={codeInput}
              className="library-join-input"
              aria-label="Room code"
              placeholder="ROOM CODE"
              maxLength={6}
              value={code}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
                setError("");
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "home-join-error" : undefined}
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="library-code-paste"
              aria-label="Paste room code"
              title="Paste room code"
              disabled={!ready || pasting || joining}
              onClick={() => void pasteCode()}
            >
              <Icon name="paste" size={18} />
            </Button>
          </div>
          <Button
            type="submit"
            size="lg"
            className="library-join-submit"
            disabled={!ready || joining}
          >
            {joining ? "Finding…" : "Join room"}
            <Icon name="arrow" size={18} />
          </Button>
          {error && (
            <p id="home-join-error" role="alert" className="library-join-error">
              {error}
            </p>
          )}
        </form>
      </header>
      <div className="library-toolbar">
        <div className="library-filters" role="group" aria-label="Filter games">
          {filters.map(([id, name]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {name}
              <span className="tabular">
                {
                  visibleGames.filter(
                    (game) => id === "all" || (id === "duel") === (game.players === "2"),
                  ).length
                }
              </span>
            </button>
          ))}
        </div>
        <ButtonLink href="/series" className="library-series">
          Create a game series
          <Icon name="arrow" size={18} />
        </ButtonLink>
      </div>
      <GameGrid label="Game library" filter={filter} />
    </Chrome>
  );
}
