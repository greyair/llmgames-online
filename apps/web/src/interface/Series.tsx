import { z } from "zod";
import { seriesViewSchema } from "@/domain/series-contracts";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/ui/icon";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import {
  SERIES_DEFAULT_MATCH_TIME,
  SERIES_DEFAULT_TURN_TIME,
  SERIES_GAMES,
  seriesStandings,
  type SeriesConfig,
  type SeriesRound,
  type SeriesView,
} from "@llmgames/game-catalog";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { getCurrentUser, type User } from "@/services/auth";
import { go, useBrowserHref } from "@/lib/navigate";
import { Chrome } from "./Chrome";
import { Room } from "./Room";
import { GameMark } from "./GameMark";
import { getGame } from "./catalog";
import "./series.css";

type BuilderRound = SeriesRound & { key: string };

const savedSeriesSchema = z.object({ code: z.string(), name: z.string(), status: z.string() });

const initialRound = (gameType: SeriesRound["gameType"]): BuilderRound => ({
  key: crypto.randomUUID(),
  gameType,
  repeats: 1,
  gameTotalTime: SERIES_DEFAULT_MATCH_TIME,
  turnTime: SERIES_DEFAULT_TURN_TIME,
});

const message = <T,>(error: T) =>
  error instanceof Error ? error.message : "Could not update the series";

async function request<T>(
  schema: z.ZodType<T>,
  path: string,
  body?: { config?: SeriesConfig; playing?: boolean; modelLabel?: string; promptLabel?: string },
): Promise<T> {
  const options: RequestInit = { credentials: "include" };

  if (body) {
    options.method = "POST";
    options.headers = { "content-type": "application/json" };
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`/api/v1/series${path}`, options);
  const data = await response.json();

  if (!response.ok)
    throw new Error(
      z.object({ error: z.string().optional() }).safeParse(data).data?.error ||
        "Series request failed",
    );

  return schema.parse(data);
}

function SeriesChoices<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="series-setting">
      <p>{label}</p>
      <div className="series-choices segmented" role="group" aria-label={label}>
        {choices.map((choice) => (
          <button
            type="button"
            key={choice.value}
            aria-pressed={value === choice.value}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Series() {
  const reduceMotion = useReducedMotion();

  const href = useBrowserHref(),
    code = new URLSearchParams(href.split("?")[1] ?? "").get("code")?.toUpperCase() ?? "";

  const [user, setUser] = useState<User | null>(null),
    [view, setView] = useState<SeriesView | null>(null);

  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [watch, setWatch] = useState(true),
    [copied, setCopied] = useState(false);

  const [config, setConfig] = useState<Omit<SeriesConfig, "rounds"> & { rounds: BuilderRound[] }>({
    name: "My game series",
    rounds: [],
    firstSeat: "alternate",
    gapMs: 15_000,
    progression: "automatic",
  });

  const [showLabels, setShowLabels] = useState(false);

  const [dragging, setDragging] = useState<string | null>(null),
    [reorderMessage, setReorderMessage] = useState("");

  const gamesContainer = useRef<HTMLDivElement>(null);

  const builderHeader = useRef<HTMLElement>(null),
    gamePicker = useRef<HTMLDivElement>(null);

  const scrollToPicker = useRef(false);
  const dragStart = useRef<{ key: string; y: number } | null>(null);

  const [playing, setPlaying] = useState(true),
    [modelLabel, setModelLabel] = useState(""),
    [promptLabel, setPromptLabel] = useState("");

  const [saved, setSaved] = useState<Array<{ code: string; name: string; status: string }>>([]),
    [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((current) => {
        if (!active) return;

        if (!current) {
          go(
            `/login?returnTo=${encodeURIComponent("/series" + (code ? `?code=${code}` : ""))}`,
            "replace",
          );

          return;
        }

        if (current.gamertag_selected !== 1) {
          go(
            `/onboarding?returnTo=${encodeURIComponent("/series" + (code ? `?code=${code}` : ""))}`,
            "replace",
          );

          return;
        }

        setUser(current);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });

    return () => {
      active = false;
    };
  }, [code]);
  useEffect(() => {
    if (!user || code) return;
    let active = true;
    request(z.object({ series: z.array(savedSeriesSchema) }), "")
      .then((data) => {
        if (active) setSaved(data.series);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });

    return () => {
      active = false;
    };
  }, [user, code]);
  useEffect(() => {
    setView(null);
    setCopied(false);
    setError("");
    setWatch(true);

    if (!user || !code) return;

    let active = true,
      timer: ReturnType<typeof setTimeout>;

    const refresh = async () => {
      try {
        const data = await request(seriesViewSchema, `/${encodeURIComponent(code)}`);

        if (!active) return;
        setView(data);
        setError("");

        if (!["completed", "cancelled", "failed"].includes(data.status))
          timer = setTimeout(() => void refresh(), 2000);
      } catch (e) {
        if (active) {
          setError(message(e));
          timer = setTimeout(() => void refresh(), 5000);
        }
      }
    };

    void refresh();

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [user, code]);
  useEffect(() => {
    const header = builderHeader.current;

    if (!header) return;

    const nav =
      document.querySelector<HTMLElement>(".site-bar-slot") ??
      document.querySelector<HTMLElement>(".site-bar");

    const form = header.closest("form");

    const update = () => {
      const navStyle = nav ? getComputedStyle(nav) : null;

      const top = nav
        ? nav.getBoundingClientRect().height +
          (parseFloat(navStyle!.top) || 0) +
          (parseFloat(navStyle!.marginTop) || 0) +
          8
        : 8;

      form?.style.setProperty("--series-sticky-top", `${top}px`);
      form?.style.setProperty(
        "--series-header-offset",
        `${top + header.getBoundingClientRect().height + 16}px`,
      );
    };

    const observer = new ResizeObserver(update);
    observer.observe(header);

    if (nav) observer.observe(nav);
    update();

    return () => observer.disconnect();
  }, [user, code]);
  useEffect(() => {
    if (!scrollToPicker.current || !gamePicker.current || !gamesContainer.current) return;
    scrollToPicker.current = false;

    const container = gamesContainer.current,
      picker = gamePicker.current;

    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";

    if (container.scrollHeight > container.clientHeight) {
      container.scrollTo({
        top:
          container.scrollTop +
          picker.getBoundingClientRect().top -
          container.getBoundingClientRect().top -
          8,
        behavior,
      });
    } else picker.scrollIntoView({ block: "start", behavior });
  }, [config.rounds.length]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  async function act(action: string) {
    if (busy) return;
    setBusy(true);
    setError("");

    try {
      setView(
        await request(
          seriesViewSchema,
          `/${encodeURIComponent(code)}/${action}`,
          action === "join" ? { modelLabel, promptLabel } : {},
        ),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    setError("");

    try {
      const result = await request(seriesViewSchema, "/create", {
        config: {
          ...config,
          rounds: config.rounds.map((round) => ({
            gameType: round.gameType,
            repeats: 1,
            gameTotalTime: round.gameTotalTime,
            turnTime: round.turnTime,
          })),
        },
        playing,
        modelLabel,
        promptLabel,
      });

      go(`/series?code=${result.code}`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  function addGame(gameType: SeriesRound["gameType"]) {
    if (config.rounds.length >= 20) return;
    scrollToPicker.current = true;
    setConfig((old) => ({ ...old, rounds: [...old.rounds, initialRound(gameType)] }));
    setReorderMessage(`${getGame(gameType)?.title} added to the lineup`);
  }

  function moveRound(key: string, target: number) {
    const current = config.rounds.findIndex((round) => round.key === key);

    if (current < 0 || target < 0 || target >= config.rounds.length || current === target) return;
    setReorderMessage(
      `${getGame(config.rounds[current]!.gameType)?.title} moved to position ${target + 1}`,
    );
    setConfig((old) => {
      const from = old.rounds.findIndex((round) => round.key === key);

      if (from < 0 || target < 0 || target >= old.rounds.length || from === target) return old;
      const rounds = [...old.rounds];
      const [round] = rounds.splice(from, 1);
      rounds.splice(target, 0, round!);

      return { ...old, rounds };
    });
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/series?code=${code}`);
      setCopied(true);
    } catch {
      setError("Could not copy the invite");
    }
  }

  function download() {
    if (!view) return;

    const record = {
      code: view.code,
      config: view.config,
      status: view.status,
      participants: view.participants,
      results: view.results,
      totalMatches: view.totalMatches,
      createdAt: view.createdAt,
      expiresAt: view.expiresAt,
    };

    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              ...record,
              standings: seriesStandings(view),
              labelsAreSelfReported: true,
              decisionTimeDefinition:
                "Server elapsed time from turn start or previous accepted action to the next accepted action. Includes host and network delay.",
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );

    const link = document.createElement("a");
    link.href = url;
    link.download = `llmgames-series-${view.code}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const labels = (
    <div className="series-fields">
      <label>
        Model / version label
        <Input
          value={modelLabel}
          maxLength={100}
          placeholder="Optional, self-reported"
          onChange={(e) => setModelLabel(e.target.value)}
        />
      </label>
      <label>
        Prompt label
        <Input
          value={promptLabel}
          maxLength={100}
          placeholder="Optional"
          onChange={(e) => setPromptLabel(e.target.value)}
        />
      </label>
    </div>
  );

  if (view?.status === "playing" && view.currentMatch && watch)
    return (
      <>
        <div className="series-match-banner" data-surface="dark">
          <i className="live-dot" aria-hidden="true" />
          <span>
            {view.config.name} · Match {view.currentMatch.index + 1} of {view.totalMatches}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setWatch(false)}>
            Series results
          </Button>
        </div>
        <Room
          key={view.currentMatch.roomId}
          gameType={view.currentMatch.gameType}
          seriesRoom={view.currentMatch}
          onSeriesReturn={() => setWatch(false)}
        />
      </>
    );
  const matchCount = config.rounds.reduce((sum, round) => sum + round.repeats, 0);

  const maxMinutes = Math.round(
    config.rounds.reduce(
      (sum, round) =>
        sum +
        round.repeats * (round.gameTotalTime + (round.gameType === "battleship" ? 300000 : 0)),
      0,
    ) / 60000,
  );

  return (
    <MotionConfig reducedMotion="user">
      <Chrome authenticated={Boolean(user)} user={user ?? undefined}>
        <div className="series-page">
          {code && (
            <header className="series-heading">
              <ButtonLink href="/play" variant="ghost" size="sm">
                <Icon name="back" size={18} />
                Game library
              </ButtonLink>
              <h1>{view?.config.name ?? "Series"}</h1>
            </header>
          )}
          {error && (
            <p role="alert" className="room-error series-error is-shaking" key={error}>
              {error}
            </p>
          )}
          {!user ? (
            <p role="status" className="series-checking">
              Checking your account…
            </p>
          ) : !code ? (
            <>
              <form
                className="series-builder"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <header ref={builderHeader} className="series-builder-header">
                  <h1 className="sr-only">Create a series</h1>
                  <ButtonLink href="/play" variant="ghost" size="sm" className="series-back">
                    <Icon name="back" size={18} />
                    Game library
                  </ButtonLink>
                  <label className="series-name-field">
                    <span>Series name</span>
                    <Input
                      required
                      value={config.name}
                      maxLength={80}
                      onChange={(e) => setConfig({ ...config, name: e.target.value })}
                    />
                  </label>
                  <span className="series-header-count mono" aria-hidden="true">
                    {config.rounds.length} / 20
                  </span>
                </header>
                <div className="series-builder-games" ref={gamesContainer}>
                  <section aria-labelledby="series-games-title" className="series-lineup">
                    <div className="series-lineup-head">
                      <h2 id="series-games-title" className="series-games-prompt">
                        Add the games you want to play, in order.
                      </h2>
                    </div>
                    <p className="sr-only" role="status" aria-live="polite">
                      {reorderMessage}
                    </p>
                    <div className="series-rounds">
                      {config.rounds.length === 0 && (
                        <div className="series-rounds-empty" aria-hidden="true">
                          <span>1</span>
                          <span>2</span>
                          <span>3</span>
                        </div>
                      )}
                      <AnimatePresence initial={false}>
                        {config.rounds.map((round, index) => (
                          <motion.fieldset
                            initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.16 } }}
                            transition={{ type: "spring", stiffness: 520, damping: 38 }}
                            className={`series-round${dragging === round.key ? " is-dragging" : ""}`}
                            key={round.key}
                            data-round-key={round.key}
                            data-game={round.gameType}
                          >
                            <legend className="sr-only">Game {index + 1}</legend>
                            <div className="series-round-main">
                              <button
                                type="button"
                                className="series-icon-button series-drag-handle"
                                aria-label={`Reorder game ${index + 1}`}
                                title="Drag to reorder. Use arrow keys to move."
                                onKeyDown={(e) => {
                                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                                    e.preventDefault();
                                    moveRound(round.key, index + (e.key === "ArrowUp" ? -1 : 1));
                                  }
                                }}
                                onPointerDown={(e) => {
                                  if (e.button !== 0) return;
                                  e.currentTarget.setPointerCapture(e.pointerId);
                                  dragStart.current = { key: round.key, y: e.clientY };
                                }}
                                onPointerMove={(e) => {
                                  const start = dragStart.current;

                                  if (
                                    !start ||
                                    start.key !== round.key ||
                                    Math.abs(e.clientY - start.y) < 6
                                  )
                                    return;
                                  setDragging(round.key);

                                  const target = document
                                    .elementFromPoint(e.clientX, e.clientY)
                                    ?.closest("[data-round-key]")
                                    ?.getAttribute("data-round-key");

                                  if (target)
                                    moveRound(
                                      round.key,
                                      config.rounds.findIndex((item) => item.key === target),
                                    );
                                  const container = gamesContainer.current;

                                  if (
                                    container &&
                                    container.scrollHeight > container.clientHeight
                                  ) {
                                    const bounds = container.getBoundingClientRect();

                                    if (e.clientY < bounds.top + 48) container.scrollBy(0, -16);
                                    else if (e.clientY > bounds.bottom - 48)
                                      container.scrollBy(0, 16);
                                  } else if (e.clientY < 80) window.scrollBy(0, -12);
                                  else if (e.clientY > window.innerHeight - 80)
                                    window.scrollBy(0, 12);
                                }}
                                onPointerUp={() => {
                                  dragStart.current = null;
                                  setDragging(null);
                                }}
                                onPointerCancel={() => {
                                  dragStart.current = null;
                                  setDragging(null);
                                }}
                                onLostPointerCapture={() => {
                                  dragStart.current = null;
                                  setDragging(null);
                                }}
                              >
                                <Icon name="grip" size={18} />
                              </button>
                              <span className="series-round-number mono" aria-hidden="true">
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <div className="series-lineup-game">
                                <GameMark id={round.gameType} size={44} />
                                <div className="series-lineup-text">
                                  <strong>{getGame(round.gameType)?.title}</strong>
                                  <span>{getGame(round.gameType)?.category}</span>
                                </div>
                                {round.gameType === "battleship" && (
                                  <p>Fleet placement gets a separate five minutes.</p>
                                )}
                                {round.gameType === "pokemon" && (
                                  <p>
                                    Both players choose simultaneously. Starting seats alternate.
                                  </p>
                                )}
                                {round.gameType === "contexto" && (
                                  <p>
                                    Both players guess concurrently. Only the match timer applies.
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                className="series-icon-button series-remove"
                                aria-label={`Remove game ${index + 1}`}
                                title="Remove game"
                                data-sound="close"
                                onClick={() => {
                                  setConfig((old) => ({
                                    ...old,
                                    rounds: old.rounds.filter((item) => item.key !== round.key),
                                  }));
                                }}
                              >
                                <Icon name="close" size={18} />
                              </button>
                            </div>
                          </motion.fieldset>
                        ))}
                      </AnimatePresence>
                    </div>
                    <div
                      ref={gamePicker}
                      id="series-game-picker"
                      className="series-game-picker"
                      role="group"
                      aria-label="Choose a game"
                    >
                      <p className="series-picker-title">
                        <span>Choose a game</span>
                        <small className="mono">
                          {config.rounds.length >= 20 ? "Lineup full" : "Tap to add"}
                        </small>
                      </p>
                      <div className="series-game-tiles">
                        {SERIES_GAMES.map((id, index) => (
                          <button
                            key={id}
                            type="button"
                            className="series-game-tile"
                            data-game={id}
                            data-sound="place"
                            style={
                              { "--i": index } satisfies CSSProperties & {
                                [property: `--${string}`]: string | number | undefined;
                              }
                            }
                            aria-label={`Add ${getGame(id)?.title}`}
                            disabled={config.rounds.length >= 20}
                            onClick={() => addGame(id)}
                          >
                            <GameMark id={id} size={48} />
                            <span className="series-tile-label">{getGame(id)?.title}</span>
                            <span className="series-tile-add" aria-hidden="true">
                              <Icon name="plus" size={18} />
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                </div>
                <div className="series-builder-settings" data-surface="dark">
                  <section aria-labelledby="series-setup-title" className="series-setup">
                    <h2 id="series-setup-title">Match setup</h2>
                    <p className="series-timing-note mono">
                      Default timing: 15 minutes per game · 90 seconds per turn.
                    </p>
                    <div className="series-settings-fields">
                      <SeriesChoices
                        label="Who starts?"
                        value={config.firstSeat}
                        onChange={(firstSeat) => setConfig({ ...config, firstSeat })}
                        choices={[
                          { value: "alternate", label: "Take turns" },
                          { value: "random", label: "Random" },
                          { value: "participant1", label: "Player 1" },
                          { value: "participant2", label: "Player 2" },
                        ]}
                      />
                      <label className="series-break-field">
                        <span>Break seconds</span>
                        <Input
                          type="number"
                          required
                          min={0}
                          max={600}
                          value={config.gapMs / 1000}
                          onChange={(e) =>
                            setConfig({ ...config, gapMs: Number(e.target.value) * 1000 })
                          }
                        />
                      </label>
                      <SeriesChoices
                        label="Next match"
                        value={config.progression}
                        onChange={(progression) => setConfig({ ...config, progression })}
                        choices={[
                          { value: "automatic", label: "Automatic" },
                          { value: "ready", label: "Both ready" },
                        ]}
                      />
                      <SeriesChoices
                        label="Your seat"
                        value={playing ? "play" : "watch"}
                        onChange={(seat) => setPlaying(seat === "play")}
                        choices={[
                          { value: "play", label: "Play" },
                          { value: "watch", label: "Host & watch" },
                        ]}
                      />
                    </div>
                    {playing && (
                      <div className="series-labels">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={showLabels}
                          onClick={() => setShowLabels(!showLabels)}
                        >
                          {showLabels ? "Hide model labels" : "Add model labels (optional)"}
                        </Button>
                        <AnimatePresence initial={false}>
                          {showLabels && (
                            <motion.div
                              key="labels"
                              className="series-labels-body"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ type: "spring", stiffness: 420, damping: 38 }}
                            >
                              {labels}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </section>
                  <div className="series-create-footer">
                    <div className="series-summary">
                      <div className="series-summary-marks" aria-hidden="true">
                        {config.rounds.slice(0, 6).map((round) => (
                          <GameMark key={round.key} id={round.gameType} size={24} />
                        ))}
                      </div>
                      <p>
                        {matchCount} matches · {maxMinutes} minutes maximum play, plus breaks
                      </p>
                    </div>
                    <Button
                      type="submit"
                      size="lg"
                      data-sound="start"
                      disabled={busy || !config.rounds.length}
                    >
                      {busy ? "Creating…" : "Create series"}
                    </Button>
                  </div>
                </div>
              </form>
              {saved.length > 0 && (
                <section className="series-saved-section">
                  <h2>Your series</h2>
                  <ul className="series-saved">
                    {saved.map((item) => (
                      <li key={item.code}>
                        <a href={`/series?code=${item.code}`}>
                          <span>{item.name}</span>
                          <small className="mono">{item.code}</small>
                        </a>
                        <span className="series-saved-status" data-status={item.status}>
                          {item.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : !view ? (
            <section className="series-join reveal">
              <div>
                <h2>Join series {code}</h2>
                <p>Take one of the two participant seats. Your place carries across every match.</p>
                {labels}
              </div>
              <Button size="lg" data-sound="join" disabled={busy} onClick={() => void act("join")}>
                {busy ? "Joining…" : "Join series"}
              </Button>
            </section>
          ) : (
            <SeriesDetail
              view={view}
              now={now}
              busy={busy}
              copied={copied}
              act={act}
              copyInvite={copyInvite}
              download={download}
              openMatch={() => setWatch(true)}
            />
          )}
        </div>
      </Chrome>
    </MotionConfig>
  );
}

function statusHeadline(view: SeriesView, now: number) {
  return view.status === "break"
    ? view.nextAt && view.nextAt > now
      ? `Next match in ${Math.ceil((view.nextAt - now) / 1000)}s`
      : view.config.progression === "ready"
        ? "Waiting for both participants to be ready"
        : "Preparing the next match…"
    : view.status === "waiting"
      ? "Waiting for participants"
      : view.status === "preparing"
        ? "Preparing the match…"
        : view.status === "completed"
          ? "Series complete"
          : view.status === "playing"
            ? `Match ${view.results.length + 1} in progress`
            : view.status === "cancelled"
              ? "Series cancelled"
              : "Series stopped";
}

function SeriesDetail({
  view,
  now,
  busy,
  copied,
  act,
  copyInvite,
  download,
  openMatch,
}: {
  view: SeriesView;
  now: number;
  busy: boolean;
  copied: boolean;
  act: (action: string) => Promise<void>;
  copyInvite: () => Promise<void>;
  download: () => void;
  openMatch: () => void;
}) {
  const live = ["playing", "preparing", "break"].includes(view.status);
  const progress = view.totalMatches ? view.results.length / view.totalMatches : 0;

  const schedule = view.config.rounds.map((round, index) => {
    const start = view.config.rounds.slice(0, index).reduce((sum, item) => sum + item.repeats, 0);

    return { round, start, end: start + round.repeats };
  });

  const wins = (id?: string) =>
    id ? view.results.filter((result) => result.winnerId === id).length : 0;

  return (
    <>
      <section className="series-status reveal" data-surface="dark" data-status={view.status}>
        <div className="series-status-main">
          <span className="series-status-chip">
            {live && <i className="live-dot" aria-hidden="true" />}
            {view.status}
          </span>
          <p role="status">{statusHeadline(view, now)}</p>
          <span className="series-status-count mono">
            {view.results.length} / {view.totalMatches} results
          </span>
          <span className="series-progress" aria-hidden="true">
            <i
              style={
                { "--progress": progress } satisfies CSSProperties & {
                  [property: `--${string}`]: string | number | undefined;
                }
              }
            />
          </span>
          {view.error && (
            <p role="alert" className="series-status-error">
              {view.error}
            </p>
          )}
        </div>
        <div className="series-actions">
          {view.status === "waiting" && (
            <>
              <Button variant="secondary" data-sound="copy" onClick={() => void copyInvite()}>
                <Icon name="copy" size={18} />
                {copied ? "Invite copied" : "Copy invite"}
              </Button>
              <span className="series-code mono">Code {view.code}</span>
              {!view.you && view.participants.length < 2 && (
                <Button disabled={busy} data-sound="join" onClick={() => void act("join")}>
                  Take a seat
                </Button>
              )}
              {view.isHost && (
                <Button
                  variant="success"
                  data-sound="start"
                  disabled={busy || view.participants.length !== 2}
                  onClick={() => void act("start")}
                >
                  Start series
                </Button>
              )}
            </>
          )}
          {view.status === "break" && view.config.progression === "ready" && view.you && (
            <Button
              variant="success"
              disabled={busy || view.ready.includes(view.you)}
              onClick={() => void act("ready")}
            >
              {view.ready.includes(view.you) ? "You are ready" : "Ready for next match"}
            </Button>
          )}
          {view.status === "playing" && (
            <Button variant="success" onClick={openMatch}>
              Open current match
            </Button>
          )}
          {view.isHost && !["completed", "failed", "cancelled"].includes(view.status) && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Cancel the series and end its current match? Completed results will be kept.",
                  )
                )
                  void act("cancel");
              }}
            >
              Cancel series
            </Button>
          )}
          <Button variant="secondary" onClick={download}>
            <Icon name="download" size={18} />
            Export results
          </Button>
        </div>
      </section>
      <section
        className="series-section reveal"
        style={
          { "--i": 1 } satisfies CSSProperties & {
            [property: `--${string}`]: string | number | undefined;
          }
        }
      >
        <h2>Participants</h2>
        <div className="series-participants">
          {[0, 1].map((index) => {
            const participant = view.participants[index];

            return (
              <article
                key={index}
                className="series-participant"
                data-kind={participant?.kind ?? "open"}
                data-you={(participant && participant.id === view.you) || undefined}
              >
                {participant ? (
                  <PlayerAvatar
                    name={`${participant.kind}:${participant.name}`}
                    size={64}
                    label={`${participant.name} avatar`}
                  />
                ) : (
                  <span className="series-open-seat" aria-hidden="true">
                    ?
                  </span>
                )}
                <div className="series-participant-text">
                  <h3>{participant?.name ?? "Open seat"}</h3>
                  {participant && (
                    <p className="series-participant-detail">
                      {[
                        participant.environmentLabel,
                        participant.modelLabel,
                        participant.promptLabel,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Human player"}
                    </p>
                  )}
                </div>
                {participant && (
                  <strong className="series-participant-score mono" aria-hidden="true">
                    {wins(participant.id)}
                  </strong>
                )}
              </article>
            );
          })}
          <span className="series-vs" aria-hidden="true">
            vs
          </span>
        </div>
        <p className="series-footnote">Model and prompt labels are self-reported.</p>
      </section>
      <section
        className="series-section reveal"
        style={
          { "--i": 2 } satisfies CSSProperties & {
            [property: `--${string}`]: string | number | undefined;
          }
        }
      >
        <h2>Schedule</h2>
        <ol className="series-schedule series-timeline">
          {schedule.map(({ round, start, end }, index) => (
            <li
              key={index}
              data-state={
                view.results.length >= end
                  ? "done"
                  : view.results.length >= start && live
                    ? "current"
                    : "upcoming"
              }
            >
              <GameMark id={round.gameType} size={36} />
              <div>
                <strong>{getGame(round.gameType)?.title}</strong>
                <span>
                  {round.repeats} {round.repeats === 1 ? "match" : "matches"} ·{" "}
                  {round.gameTotalTime / 60000}m
                  {round.gameType !== "contexto" ? ` · ${round.turnTime / 1000}s per turn` : ""}
                </span>
              </div>
            </li>
          ))}
        </ol>
        <p className="series-footnote">
          {view.config.firstSeat === "alternate"
            ? "Starting seats alternate within each game."
            : view.config.firstSeat === "random"
              ? "Starting seats are randomized each match."
              : `Participant ${view.config.firstSeat === "participant1" ? "1" : "2"} gets the starting seat.`}{" "}
          {view.config.gapMs / 1000}s between matches.
        </p>
      </section>
      <section
        className="series-section reveal"
        style={
          { "--i": 3 } satisfies CSSProperties & {
            [property: `--${string}`]: string | number | undefined;
          }
        }
      >
        <h2>Results by game</h2>
        {!view.results.length ? (
          <p className="series-empty-results">
            Results appear when a match finishes and its final state is delivered.
          </p>
        ) : (
          seriesStandings(view).map((group) => (
            <div key={group.gameType} className="series-table-wrap" data-game={group.gameType}>
              <table>
                <caption>
                  <GameMark id={group.gameType} size={24} />
                  {getGame(group.gameType)?.title}
                </caption>
                <thead>
                  <tr>
                    <th>Participant</th>
                    <th>Wins</th>
                    <th>Draws</th>
                    <th>Losses</th>
                    <th>Timeouts</th>
                    <th>Avg. decision</th>
                  </tr>
                </thead>
                <tbody>
                  {group.participants.map((p) => (
                    <tr key={p.id}>
                      <th scope="row">{p.name}</th>
                      <td>{p.wins}</td>
                      <td>{p.draws}</td>
                      <td>{p.losses}</td>
                      <td>{p.timeouts}</td>
                      <td>
                        {p.averageDecisionMs === null
                          ? "—"
                          : `${(p.averageDecisionMs / 1000).toFixed(1)}s`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
        <p className="series-footnote">
          Decision times include network and host delay. Aborted matches are excluded from
          standings.
        </p>
      </section>
      {view.results.length > 0 && (
        <section
          className="series-section reveal"
          style={
            { "--i": 4 } satisfies CSSProperties & {
              [property: `--${string}`]: string | number | undefined;
            }
          }
        >
          <h2>Match log</h2>
          <ol className="series-schedule series-log">
            {view.results.map((result) => (
              <li key={result.index} data-outcome={result.outcome}>
                <GameMark id={result.gameType} size={28} />
                <div>
                  <strong>
                    {result.index + 1}. {getGame(result.gameType)?.title}
                  </strong>
                  <span>
                    {result.outcome === "aborted"
                      ? "Aborted"
                      : result.winnerId
                        ? `${view.participants.find((p) => p.id === result.winnerId)?.name} won`
                        : "Draw"}{" "}
                    · {result.reason}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
