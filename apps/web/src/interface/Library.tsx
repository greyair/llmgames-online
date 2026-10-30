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
import { BilingualText, gameMessage, useT, type GameField } from "@/i18n";
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
  const t = useT();
  const game = getGame(id);

  // A game that has not shipped its copy yet keeps the catalog text instead of
  // showing a raw key.
  const label = (field: GameField, fallback?: string) => {
    const key = gameMessage(id, field);
    const text = t(key);

    return text === key ? (fallback ?? text) : text;
  };

  const title = label("title", game?.title);
  const category = label("category", game?.category);
  const detail = label("detail", game?.detail);

  return (
    <a
      className={cn("game-tile reveal", className)}
      data-game={id}
      data-surface="dark"
      href={gameRoute(id)}
      aria-label={t("common.playGame", { game: title })}
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
            <h2>{title}</h2>
            <span>
              {t("common.playerCount", { count: game?.players ?? "" })} · {category}
            </span>
          </div>
        </div>
        <p className="game-tile-pitch">{pitch ?? detail}</p>
        {showPlay && (
          <span className={cn(buttonVariants({ size: "lg" }), "game-tile-play")} aria-hidden="true">
            {t("common.playGame", { game: title })}
          </span>
        )}
      </div>
      <GameGlyph id={id} crop />
    </a>
  );
}

const filters = [
  ["all", "library.all"],
  ["duel", "library.duel"],
  ["group", "library.group"],
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
  const t = useT();
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
        setError(t("library.invalidPaste"));

        return;
      }

      setCode(pasted);
      setError("");
    } catch {
      setError(t("library.clipboardUnavailable"));
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
      setError(t("library.invalidCode"));

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
      setError(e instanceof Error ? e.message : t("library.notFound"));
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
          <h1 className="reveal">
            <BilingualText k="library.title" />
          </h1>
          <p
            className="reveal"
            style={
              { "--i": 1 } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
          >
            <BilingualText k="library.lead" />
          </p>
        </div>
        <form
          className="library-join reveal"
          style={
            { "--i": 2 } satisfies CSSProperties & {
              [property: `--${string}`]: string | number | undefined;
            }
          }
          aria-label={t("room.joinForm")}
          onSubmit={(event) => {
            event.preventDefault();
            void join();
          }}
        >
          <label className="library-join-label" htmlFor="library-room-code">
            <BilingualText k="room.haveCode" />
          </label>
          <div className="library-code-field">
            <Input
              id="library-room-code"
              ref={codeInput}
              className="library-join-input"
              aria-label={t("room.roomCode")}
              placeholder={t("room.roomCodePlaceholder")}
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
              aria-label={t("library.paste")}
              title={t("library.paste")}
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
            {joining ? (
              <BilingualText k="library.finding" />
            ) : (
              <BilingualText k="library.join" />
            )}
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
        <div className="library-filters" role="group" aria-label={t("library.filter")}>
          {filters.map(([id, name]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              <BilingualText k={name} />
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
          <BilingualText k="library.series" />
          <Icon name="arrow" size={18} />
        </ButtonLink>
      </div>
      <GameGrid label={t("library.grid")} filter={filter} />
    </Chrome>
  );
}
