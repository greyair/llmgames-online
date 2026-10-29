import { playerIdentityDetail } from "@/features/shared/playerIdentity";
import { GamePlayerAvatar } from "@/game-ui/GamePlayerAvatar";
import { HistoryEntry } from "./HistoryEntry";
import { GameLog } from "./GameLog";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import {
  getCurrentUser,
  peekCurrentUser,
  getAgentActivity,
  deleteAgentIdentity,
  deleteAllAgentIdentities,
  getAgentGameLogs,
  getAgentGameLog,
  type AgentActivity,
  type AgentGameLogSummary,
  type AgentGameLogDocument,
} from "@/services/auth";
import { go } from "@/lib/navigate";
import { play } from "@/lib/sound";
import {
  parseRewatch,
  readOnlyReplayState,
  type RewatchPayload,
} from "@/features/replay/rewatchPayload";
import { GameBoard } from "@/game-ui/GameBoard";
import { MatchDesk } from "@/game-ui/MatchDesk";
import { Chrome } from "./Chrome";
import { getGame } from "./catalog";
import { HoleyLoader } from "@/components/ui/holey-loader";
import { LoadingPanel } from "@/components/ui/loading-panel";
import { gameMessage, useT } from "@/i18n";
import "./archive.css";

const message = <T,>(e: T) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";

const date = (value: number) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// Last lists seen this tab, keyed by account, so returning to a page paints
// immediately while a background request refreshes it.
interface ArchiveCache {
  owner?: string;
  agents?: AgentActivity[];
  history?: { games: AgentGameLogSummary[]; cursor: string | null };
}

const cache: ArchiveCache = {};

function cached<K extends "agents" | "history">(key: K) {
  const owner = peekCurrentUser()?.id;

  return owner && cache.owner === owner ? cache[key] : undefined;
}

function remember<K extends "agents" | "history">(key: K, value: NonNullable<(typeof cache)[K]>) {
  const owner = peekCurrentUser()?.id;

  if (!owner) return;

  if (cache.owner !== owner) {
    cache.owner = owner;
    delete cache.agents;
    delete cache.history;
  }

  cache[key] = value;
}

const slide = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { type: "spring", stiffness: 420, damping: 38, opacity: { duration: 0.18 } },
} as const;

function ProfileLink() {
  const t = useT();

  return (
    <ButtonLink href="/profile" variant="outline" size="sm">
      {t("archive.profile")}
    </ButtonLink>
  );
}

function Empty({
  title,
  detail,
  href,
  label,
}: {
  title: string;
  detail: string;
  href: string;
  label: string;
}) {
  return (
    <Card className="archive-empty reveal">
      <CardContent>
        <span className="archive-empty-mark" aria-hidden="true">
          <Icon name="agent" size={30} />
        </span>
        <h2>{title}</h2>
        <p>{detail}</p>
        <ButtonLink href={href}>
          {label}
          <Icon name="arrow" size={17} />
        </ButtonLink>
      </CardContent>
    </Card>
  );
}

export function ReplayViewer({
  replay,
  onExit,
  embedded = false,
}: {
  replay: RewatchPayload;
  onExit: () => void;
  embedded?: boolean;
}) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!playing) return;

    const timer = setTimeout(() => {
      if (index >= replay.frames.length - 1) setPlaying(false);
      else setIndex(index + 1);
    }, 900 / speed);

    return () => clearTimeout(timer);
  }, [playing, index, replay.frames.length, speed]);
  const current = replay.frames[index]!;
  const state = { ...readOnlyReplayState(current.state), type: replay.gameType };
  const last = replay.frames.length - 1;
  const progress = last > 0 ? (index / last) * 100 : 100;

  const speeds = (
    <div className="replay-speeds segmented" role="group" aria-label={t("archive.playbackSpeed")}>
      {[0.5, 1, 2].map((value) => (
        <button
          type="button"
          key={value}
          aria-pressed={speed === value}
          onClick={() => setSpeed(value)}
        >
          {value}×
        </button>
      ))}
    </div>
  );

  const controls = (
    <div className="replay-controls">
      <div className="replay-caption">
        <strong>{t("archive.replay")}</strong>
        <span className="replay-label">{current.label}</span>
      </div>
      <div className="replay-transport">
        <Button
          size="icon"
          variant="secondary"
          aria-label={t("archive.previousFrame")}
          disabled={index === 0}
          onClick={() => {
            setPlaying(false);
            setIndex(index - 1);
          }}
        >
          <Icon name="chevronLeft" size={18} />
        </Button>
        <Button
          size="icon"
          className="replay-play"
          data-playing={playing || undefined}
          onClick={() => {
            if (!playing && index === last) setIndex(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Icon name="pause" size={18} /> : <Icon name="play" size={18} />}
          <span className="sr-only">{t(playing ? "archive.pauseReplay" : "archive.playReplay")}</span>
        </Button>
        <Button
          size="icon"
          variant="secondary"
          aria-label={t("archive.nextFrame")}
          disabled={index === last}
          onClick={() => {
            setPlaying(false);
            setIndex(index + 1);
          }}
        >
          <Icon name="chevronRight" size={18} />
        </Button>
        <label className="replay-scrubber">
          <span className="replay-frame mono">
            {t("archive.frame", { current: index + 1, total: replay.frames.length })}
          </span>
          <input
            type="range"
            aria-label={t("room.replayPosition")}
            min={0}
            max={last}
            value={index}
            style={
              { "--p": `${progress}%` } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
          />
        </label>
        {speeds}
      </div>
      {replay.truncated && (
        <small className="replay-note">{t("archive.shortReplay")}</small>
      )}
    </div>
  );

  if (embedded)
    return (
      <motion.section
        className="inline-replay"
        aria-label={t("archive.replay")}
        data-surface="dark"
        data-game={replay.gameType}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        <div className="inline-replay-top">
          <Badge tone="game">
            <Icon name="play" size={12} />
            {t("archive.rewatching")}
          </Badge>
          <Button variant="secondary" size="sm" data-sound="close" onClick={onExit}>
            {t("archive.closeRewatch")}
          </Button>
        </div>
        <div className="inline-replay-board">
          <GameBoard state={state} />
        </div>
        {controls}
      </motion.section>
    );

  return (
    <MatchDesk state={state} onExit={onExit} controls={controls}>
      <GameBoard state={state} />
    </MatchDesk>
  );
}

function AgentCard({
  agent,
  ownerGamertag,
  index,
  confirming,
  busy,
  confirmation,
  onRemove,
}: {
  agent: AgentActivity;
  ownerGamertag?: string;
  index: number;
  confirming: boolean;
  busy: boolean;
  confirmation: ReactNode;
  onRemove: () => void;
}) {
  const t = useT();
  const status = t(agent.isActive ? "archive.inGame" : agent.hasRoomHistory ? "archive.available" : "archive.neverSeated");

  return (
    <motion.div
      layout="position"
      className="agent-card-shell reveal"
      style={
        { "--i": Math.min(index, 8) } satisfies CSSProperties & {
          [property: `--${string}`]: string | number | undefined;
        }
      }
    >
      <Card
        className="agent-card"
        data-active={agent.isActive || undefined}
        data-confirming={confirming || undefined}
      >
        <CardContent>
          <div className="agent-row">
            <span className="agent-symbol">
              <GamePlayerAvatar
                player={{ id: agent.codename, codename: agent.codename, isAgent: true }}
                size={40}
              />
            </span>
            <div className="agent-card-name">
              <h2>{agent.codename}</h2>
              <p>{playerIdentityDetail({ ...agent, isAgent: true, ownerGamertag })}</p>
            </div>
            <small className="agent-activity">
              {agent.isActive && <i className="live-dot" aria-hidden="true" />}
              {status}
            </small>
            <small className="agent-last-used">
              {t("archive.active")}{" "}
              <time dateTime={new Date((agent.lastUsedAt ?? agent.createdAt) * 1000).toISOString()}>
                {date((agent.lastUsedAt ?? agent.createdAt) * 1000)}
              </time>
            </small>
            <Button
              className="agent-remove"
              size="sm"
              variant="ghost"
              disabled={agent.isActive || busy || confirming}
              aria-label={t("archive.removeName", { name: agent.codename })}
              onClick={onRemove}
            >
              {t("archive.remove")}
            </Button>
          </div>
          <AnimatePresence initial={false}>
            {confirming && (
              <motion.div key="confirm" className="agent-confirm-slot" {...slide}>
                {confirmation}
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function Agents() {
  const t = useT();

  const [ownerGamertag, setOwnerGamertag] = useState<string | undefined>(
    () => peekCurrentUser()?.gamertag ?? undefined,
  );

  const [agents, setAgents] = useState<AgentActivity[]>(() => cached("agents") ?? []);
  const [loaded, setLoaded] = useState(() => cached("agents") !== undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getCurrentUser()
      .then((user) => setOwnerGamertag(user?.gamertag ?? undefined))
      .catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    setError("");

    try {
      const list = await getAgentActivity();
      remember("agents", list);
      setAgents(list);
      setLoaded(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove() {
    if (!confirm) return;
    setBusy(true);
    setError("");

    try {
      if (confirm === "all") {
        const result = await deleteAllAgentIdentities();
        setStatus(
          t("archive.removedAll", { deleted: result.deletedCount, kept: result.preservedActiveCount }),
        );
      } else {
        await deleteAgentIdentity(confirm);
        setStatus(t("archive.removedName", { name: confirm }));
      }

      play("close");
      setConfirm(null);
      await load();
    } catch (e) {
      play("error");
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const confirmation = (
    <div
      className="agent-confirm"
      role="group"
      aria-label={
        confirm === "all" ? t("archive.confirmAll") : t("archive.confirmName", { name: confirm ?? "" })
      }
    >
      <p>
        {confirm === "all"
          ? t("archive.removeAllQuestion")
          : t("archive.removeNameQuestion", { name: confirm ?? "" })}
      </p>
      {error && (
        <p key={error} className="archive-error is-shaking" role="alert">
          {error}
        </p>
      )}
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          data-sound="close"
          onClick={() => {
            setConfirm(null);
            setError("");
          }}
        >
          {t("profile.cancel")}
        </Button>
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>
          {t(busy ? "archive.removing" : "archive.removeIdentity")}
        </Button>
      </div>
    </div>
  );

  const live = agents.filter((a) => a.isActive).length;

  return (
    <MotionConfig reducedMotion="user">
      <Chrome active="agents" authenticated actions={<ProfileLink />}>
        <section className="page-head archive-head">
          <div className="page-head-row">
            <div className="archive-head-text">
              <h1>{t("archive.agents")}</h1>
              <p>{t("archive.agentsLead")}</p>
            </div>
            <div className="page-actions">
              <Button
                variant="outline"
                disabled={loading || busy}
                aria-busy={loading}
                onClick={() => void load()}
              >
                {t(loading && agents.length ? "archive.refreshing" : "archive.refresh")}
              </Button>
              <Button
                variant="destructive"
                disabled={loading || busy || !agents.some((a) => !a.isActive)}
                data-sound="open"
                onClick={() => setConfirm("all")}
              >
                {t("archive.removeInactive")}
              </Button>
            </div>
          </div>
        </section>
        {!confirm && error && (
          <div className="archive-error archive-error-banner is-shaking" role="alert">
            {error}
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t("archive.retry")}
            </Button>
          </div>
        )}
        <AnimatePresence initial={false}>
          {confirm === "all" && (
            <motion.div key="bulk" className="agent-bulk-confirm" {...slide}>
              {confirmation}
            </motion.div>
          )}
        </AnimatePresence>
        {loading && !loaded ? (
          <div className="archive-loading">
            <HoleyLoader label={t("archive.loadingAgents")} showLabel />
          </div>
        ) : (
          <p className="archive-status" role="status">
            {status}
          </p>
        )}
        {loaded && agents.length === 0 && !error ? (
          <Empty
            title={t("archive.emptyAgents")}
            detail={t("archive.emptyAgentsHelp")}
            href="/setup"
            label={t("archive.setupAgent")}
          />
        ) : agents.length > 0 ? (
          <>
            <p className="agent-summary">
              <strong className="mono">{agents.length}</strong>{" "}
              {t(agents.length === 1 ? "archive.identity" : "archive.identities")}
              <span aria-hidden="true">·</span>
              {live > 0 && <i className="live-dot" aria-hidden="true" />}
              {t("archive.liveCount", { count: live })}
            </p>
            <div className="agent-list">
              {agents.map((agent, index) => (
                <AgentCard
                  key={agent.codename}
                  agent={agent}
                  ownerGamertag={ownerGamertag}
                  index={index}
                  busy={busy}
                  confirming={confirm === agent.codename}
                  confirmation={confirmation}
                  onRemove={() => setConfirm(agent.codename)}
                />
              ))}
            </div>
          </>
        ) : null}
      </Chrome>
    </MotionConfig>
  );
}

function GameHistory() {
  const t = useT();
  const [games, setGames] = useState<AgentGameLogSummary[]>(() => cached("history")?.games ?? []);
  const [cursor, setCursor] = useState<string | null>(() => cached("history")?.cursor ?? null);
  const [loaded, setLoaded] = useState(() => cached("history") !== undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [details, setDetails] = useState<AgentGameLogDocument | null>(null);
  const [replay, setReplay] = useState<RewatchPayload | null>(null);
  const [opening, setOpening] = useState(false);
  const generation = useRef(0);

  async function load(before?: string) {
    setLoading(true);
    setError("");

    try {
      const result = await getAgentGameLogs(before);
      setGames((old) => {
        const next = before
          ? [
              ...old,
              ...result.games.filter((game) => !old.some((previous) => previous.id === game.id)),
            ]
          : result.games;

        remember("history", { games: next, cursor: result.nextCursor });

        return next;
      });
      setCursor(result.nextCursor);
      setLoaded(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();

    return () => {
      generation.current++;
    };
  }, []);

  async function open(game: AgentGameLogSummary, inspect = false) {
    const token = ++generation.current;
    setOpening(true);
    setError("");

    try {
      const result = await getAgentGameLog(game.id);

      if (inspect) {
        if (token === generation.current) setDetails(result);

        return;
      }

      const parsed = parseRewatch(result.rewatch, game.gameType);

      if (!parsed) throw Error(t("archive.replayUnavailable"));

      if (token === generation.current) setReplay(parsed);
    } catch (e) {
      if (token === generation.current) setError(message(e));
    } finally {
      if (token === generation.current) setOpening(false);
    }
  }

  if (replay) return <ReplayViewer replay={replay} onExit={() => setReplay(null)} />;

  if (opening)
    return (
      <Chrome active="history" actions={<ProfileLink />}>
        <LoadingPanel label={t("archive.openingReplay")}>
          <Button
            variant="outline"
            onClick={() => {
              generation.current++;
              setOpening(false);
            }}
          >
            {t("archive.backHistory")}
          </Button>
        </LoadingPanel>
      </Chrome>
    );
  const query = search.trim().toLowerCase();

  const filtered = games.filter((game) =>
    (
      getGame(game.gameType)?.title +
      " " +
      t(gameMessage(game.gameType, "title")) +
      " " +
      game.participants.map((p) => p.codename ?? p.displayName).join(" ")
    )
      .toLowerCase()
      .includes(query),
  );

  const entries = filtered.map((game) => ({
    key: "account:" + game.id,
    content: (
      <HistoryEntry
        key={game.id}
        game={game}
        onReplay={() => void open(game)}
        onInspect={() => void open(game, true)}
      />
    ),
  }));

  return (
    <Chrome active="history" authenticated actions={<ProfileLink />}>
      <section className="page-head archive-head">
        <div className="page-head-row">
          <div className="archive-head-text">
            <h1>{t("archive.history")}</h1>
            <p>{t("archive.historyLead")}</p>
          </div>
          <div className="page-actions">
            <Button
              variant="outline"
              disabled={loading}
              aria-busy={loading}
              onClick={() => void load()}
            >
              {t(loading && entries.length ? "archive.refreshing" : "archive.refresh")}
            </Button>
          </div>
        </div>
      </section>
      <div className="archive-toolbar">
        <label className="archive-search">
          <Icon name="search" size={18} aria-hidden="true" />
          <Input
            aria-label={t("archive.search")}
            placeholder={t("archive.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {games.length > 0 && (
          <span className="archive-count mono">
            {filtered.length} / {games.length}
          </span>
        )}
      </div>
      {error && (
        <div role="alert" className="archive-error archive-error-banner is-shaking">
          {error}
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("archive.retry")}
          </Button>
        </div>
      )}
      {loading && !loaded && (
        <div className="archive-loading">
          <HoleyLoader label={t("archive.loadingGames")} showLabel />
        </div>
      )}
      {loaded && !error && !entries.length && (
        <Empty
          title={t(query ? "archive.noMatching" : "archive.emptyHistory")}
          detail={t(query ? "archive.trySearch" : "archive.emptyHistoryHelp")}
          href="/play"
          label={t("archive.findGame")}
        />
      )}
      <div className="history-list">
        {entries.map((entry, index) => (
          <div
            key={entry.key}
            className="history-item reveal"
            style={
              { "--i": Math.min(index, 10) } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
          >
            {entry.content}
          </div>
        ))}
      </div>
      {cursor && (
        <div className="history-more-row">
          <Button
            className="history-more"
            variant="outline"
            disabled={loading}
            aria-busy={loading}
            onClick={() => void load(cursor)}
          >
            {t(loading ? "archive.loadingGames" : "archive.olderGames")}
          </Button>
        </div>
      )}
      {details && <GameLog game={details} onClose={() => setDetails(null)} />}
    </Chrome>
  );
}

export function Archive({ kind }: { kind: "agents" | "history" }) {
  const t = useT();
  const [ready, setReady] = useState(() => peekCurrentUser()?.gamertag_selected === 1);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((user) => {
        if (!active) return;

        if (!user) {
          go("/login?returnTo=" + encodeURIComponent(location.pathname), "replace");

          return;
        }

        if (user.gamertag_selected !== 1) {
          go("/onboarding?returnTo=" + encodeURIComponent(location.pathname), "replace");

          return;
        }

        setReady(true);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });

    return () => {
      active = false;
    };
  }, []);

  if (!ready)
    return (
      <Chrome active={kind === "agents" ? "agents" : "history"}>
        {error ? (
          <Card className="loading-card archive-problem">
            <CardContent>
              <h1>{t("archive.accountError")}</h1>
              <p role="alert">{error}</p>
              <Button onClick={() => location.reload()}>{t("common.retry")}</Button>
            </CardContent>
          </Card>
        ) : (
          <LoadingPanel label={t("room.checkingAccount")} />
        )}
      </Chrome>
    );

  return kind === "agents" ? <Agents /> : <GameHistory />;
}
