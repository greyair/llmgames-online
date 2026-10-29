import { HistorySymbol } from "./HistorySymbol";
import { GameAvatarContext, GamePlayerAvatar } from "@/game-ui/GamePlayerAvatar";
import { DownloadReplayButton } from "./DownloadReplayButton";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import {
  getAgentGameLog,
  type AgentGameLogSummary,
  type AgentGameLogDocument,
} from "@/services/auth";
import { parseRewatch, type RewatchPayload } from "@/features/replay/rewatchPayload";
import { getGame } from "./catalog";
import { ReplayViewer } from "./Archive";
import { HoleyLoader } from "@/components/ui/holey-loader";
import { PlayerName } from "@/game-ui/PlayerName";
import { gameMessage, useT } from "@/i18n";

const date = (value: number) =>
  new Date(value * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function HistoryEntry({
  game,
}: {
  game: AgentGameLogSummary;
  onReplay: () => void;
  onInspect: () => void;
}) {
  const t = useT();
  const reduceMotion = useReducedMotion();

  const [expanded, setExpanded] = useState(false),
    [detail, setDetail] = useState<AgentGameLogDocument | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [replay, setReplay] = useState<RewatchPayload | null>(null);

  const result =
    game.winner === "draw"
      ? "Draw"
      : !game.winner
        ? "Finished"
        : game.participants.some((p) => p.isYours && p.ref === game.winner)
          ? "Win"
          : "Loss";

  async function load() {
    setLoading(true);
    setError("");

    try {
      setDetail(await getAgentGameLog(game.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load game log");
    } finally {
      setLoading(false);
    }
  }

  const parsed = detail ? parseRewatch(detail.rewatch, game.gameType) : null;

  return (
    <Card
      className="history-entry"
      data-game={game.gameType}
      data-result={result.toLowerCase()}
      data-expanded={expanded || undefined}
    >
      <button
        className="history-summary"
        type="button"
        aria-expanded={expanded}
        aria-controls={`history-${game.id}`}
        data-sound={expanded ? "close" : "open"}
        onClick={() => {
          setExpanded(!expanded);

          if (!expanded && !detail && !loading) void load();
        }}
      >
        <HistorySymbol
          gameType={game.gameType}
          humanWon={Boolean(
            game.winner &&
            game.winner !== "draw" &&
            game.participants.some((p) => !p.isAgent && p.ref === game.winner),
          )}
        />
        <div className="history-summary-main">
          <div className="history-title-row">
            <h2>{t(gameMessage(game.gameType, "title")) || getGame(game.gameType)?.title || game.gameType}</h2>
            <Badge
              className={
                result === "Finished" ? "history-result history-result-finished" : "history-result"
              }
              data-result={result.toLowerCase()}
              tone={
                result === "Win"
                  ? "live"
                  : result === "Loss"
                    ? "danger"
                    : result === "Draw"
                      ? "warning"
                      : "neutral"
              }
            >
              {t(result === "Win" ? "history.win" : result === "Loss" ? "history.loss" : result === "Draw" ? "history.draw" : "history.finished")}
            </Badge>
          </div>
          <GameAvatarContext.Provider value={game.participants.map((p) => p.ref)}>
            <p className="history-players">
              {game.participants.map((p, i) => {
                const identity = {
                  id: p.ref,
                  isAgent: p.isAgent,
                  codename: p.codename,
                  name: p.displayName,
                  ownerGamertag: p.ownerGamertag,
                  environmentLabel: p.environmentLabel,
                };

                return (
                  <span
                    key={p.ref}
                    className="history-player"
                    data-kind={p.isAgent ? "agent" : "human"}
                  >
                    {i > 0 && <small className="history-vs">vs</small>}
                    <GamePlayerAvatar player={identity} size={32} />
                    <PlayerName player={identity} />
                  </span>
                );
              })}
            </p>
          </GameAvatarContext.Provider>
        </div>
        <dl className="archive-metadata history-metadata">
          <div>
            <dt>{t("history.ended")}</dt>
            <dd>{date(game.endedAt)}</dd>
          </div>
          <div>
            <dt>{t("history.events")}</dt>
            <dd>{game.eventCount}</dd>
          </div>
        </dl>
        <span className="history-chevron" aria-hidden="true">
          <Icon name="chevronDown" size={18} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="expanded"
            id={`history-${game.id}`}
            className="history-expanded"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 36, opacity: { duration: 0.2 } }}
          >
            <div className="history-expanded-inner">
              {loading ? (
                <HoleyLoader compact showLabel size={24} label={t("history.loading")} />
              ) : error ? (
                <div role="alert" className="history-log-error">
                  <p>{error}</p>
                  <Button size="sm" variant="outline" onClick={() => void load()}>
                    {t("history.retry")}
                  </Button>
                </div>
              ) : (
                detail && (
                  <>
                    <div className="history-detail-meta mono">
                      <span>{t("history.reason", { reason: detail.endReason.replaceAll("_", " ") })}</span>
                      <span>{t("history.frames", { count: parsed?.frames.length ?? 0 })}</span>
                    </div>
                    {parsed ? (
                      <div className="history-replay-actions">
                        {!replay && (
                          <Button size="sm" data-sound="open" onClick={() => setReplay(parsed)}>
                            {t("history.rewatch")} <Icon name="play" size={16} />
                          </Button>
                        )}
                        <DownloadReplayButton loadReplay={async () => parsed} />
                      </div>
                    ) : (
                      <p role="alert" className="history-log-error">
                        {t("archive.replayUnavailable")}
                      </p>
                    )}
                    {replay && (
                      <ReplayViewer replay={replay} embedded onExit={() => setReplay(null)} />
                    )}
                    <ol className="history-events" aria-label={t("history.gameEvents")}>
                      {detail.events.map((event) => (
                        <li key={event.seq}>
                          <div>
                            <span className="history-event-seq">
                              {String(event.seq).padStart(3, "0")}
                            </span>
                            <strong>{event.type.replaceAll("_", " ")}</strong>
                            <time>{date(Math.floor(event.at / 1000))}</time>
                          </div>
                          <pre tabIndex={0}>{JSON.stringify(event.summary, null, 2)}</pre>
                        </li>
                      ))}
                    </ol>
                    {!detail.events.length && (
                      <p className="history-no-events">{t("history.noEvents")}</p>
                    )}
                  </>
                )
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
