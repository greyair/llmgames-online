import { isNumber } from "@llmgames/game-catalog";

import { useT } from "@/i18n";
import { useMatchClock } from "./useMatchClock";
import { MatchResult } from "./MatchResult";
import { ThemeToggle } from "@/interface/ThemeToggle";
import { GameAvatarContext, GamePlayerAvatar } from "./GamePlayerAvatar";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import type { ClientView } from "@/domain/game-state";
import { Button } from "@/components/ui/button";
import "./match-layout.css";
import { SoundControl, playTurnTick, playTurnStart } from "@/interface/Feedback";
import { getGame } from "@/interface/catalog";
import { isAgentIdentity } from "@/features/shared/playerIdentity";
import { JevStatusContext, PlayerName } from "./PlayerName";
import {
  PokemonPlaybackSettledContext,
  PokerPlaybackSettledContext,
} from "./pokemon/PokemonPlaybackContext";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function clockText(ms?: number) {
  if (!isNumber(ms) || !Number.isFinite(ms)) return "";
  const seconds = Math.ceil(Math.max(0, ms) / 1000);

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen().catch(() => {});
}

function decisionVisible(state: ClientView, remaining: number | undefined): remaining is number {
  return (
    state.type !== "contexto" &&
    state.status === "playing" &&
    isNumber(remaining) &&
    Number.isFinite(remaining) &&
    !(
      state.type === "poker" &&
      ["hand_over", "showdown", "waiting", "ended"].includes(state.turnState?.phase ?? "")
    )
  );
}

function TurnProgress({ state, duration }: { state: ClientView; duration: number }) {
  const remaining = useMatchClock(state).turn;

  if (!decisionVisible(state, remaining)) return null;
  const progress = Math.max(0, Math.min(100, (remaining / duration) * 100));

  return (
    <span className="desk-player-timer" data-urgent={remaining < 10000} aria-hidden="true">
      <span style={{ width: `${progress}%` }} />
    </span>
  );
}

function DecisionClock({ state, duration }: { state: ClientView; duration: number }) {
  const t = useT();
  const remaining = useMatchClock(state).turn;
  const visible = decisionVisible(state, remaining);
  const turnKey = `${state.roomCode ?? ""}:${state.turnState?.turnNumber ?? ""}:${state.turnState?.phase ?? ""}:${state.turnState?.currentPlayerId ?? ""}:${state.turnState?.startedAt ?? ""}`;

  const tickSecond =
    visible && !state.replayReadOnly && state.you?.isYourTurn && remaining > 0 && remaining < 10000
      ? Math.floor(remaining / 1000)
      : null;

  const lastTick = useRef<{ turnKey: string; second: number } | null>(null);
  useEffect(() => {
    if (
      tickSecond === null ||
      document.hidden ||
      (lastTick.current?.turnKey === turnKey && lastTick.current.second === tickSecond)
    )
      return;
    lastTick.current = { turnKey, second: tickSecond };
    playTurnTick();
  }, [tickSecond, turnKey]);

  if (!visible) return null;
  const progress = Math.round(Math.max(0, Math.min(100, ((remaining ?? 0) / duration) * 100)));
  const urgent = remaining < 10000;

  return (
    <div
      className="desk-decision-clock"
      data-urgent={urgent}
      data-own={Boolean(state.you?.isYourTurn && !state.replayReadOnly)}
      data-progress={progress}
      aria-label={t("match.turnTimeRemaining")}
    >
      <strong>{clockText(remaining)}</strong>
      <span className="desk-decision-track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </span>
    </div>
  );
}

function MatchClock({ state, label }: { state: ClientView; label?: string }) {
  const t = useT();
  const remaining = useMatchClock(state).game;

  if (state.status === "ended" || !isNumber(remaining) || !Number.isFinite(remaining)) return null;

  return (
    <span className="desk-match-time" aria-label={label ?? t("match.matchTimeRemaining")}>
      {clockText(remaining)}
    </span>
  );
}

export function PlayerRow({
  player,
  active,
  index,
  gameType,
  roleLabel,
  score,
  self,
  timer,
  activeLabel,
}: {
  player: NonNullable<ClientView["players"]>[number];
  active: boolean;
  index: number;
  gameType?: string;
  roleLabel?: string;
  score?: number;
  self?: boolean;
  timer?: ReactNode;
  activeLabel?: string;
}) {
  const t = useT();
  const twoTone = gameType === "checkers" || gameType === "reversi";
  const pieceColor = twoTone ? (index % 2 ? "white" : "black") : index % 2 ? "yellow" : "red";

  const colorName = t(
    pieceColor === "white"
      ? "match.colorWhite"
      : pieceColor === "black"
        ? "match.colorBlack"
        : pieceColor === "red"
          ? "match.colorRed"
          : "match.colorYellow",
  );

  const pieceLabel = t("match.piecesOf", { color: colorName });
  const showPiece = !gameType || ["connect4", "reversi", "checkers"].includes(gameType);

  return (
    <div
      className={`desk-player ${active ? "is-active" : ""}`}
      data-kind={isAgentIdentity(player) ? "agent" : "human"}
      data-self={self || undefined}
    >
      <span className="desk-avatar">
        <GamePlayerAvatar player={player} size={32} />
      </span>
      <div className="desk-player-name">
        <PlayerName player={player} extra={roleLabel} />
      </div>
      <span className="desk-player-meta">
        {active && <span className="desk-active-label">{activeLabel ?? t("match.toMove")}</span>}
        {showPiece && (
          <span className="desk-piece-stat">
            <span
              className={`desk-piece-key key-${twoTone ? pieceColor : index % 2}`}
              role="img"
              aria-label={pieceLabel}
            />
            {twoTone && isNumber(score) && (
              <strong
                className="desk-piece-count"
                aria-label={t(gameType === "checkers" ? "match.countPieces" : "match.countDiscs", {
                  count: score,
                  color: colorName,
                })}
              >
                {score}
              </strong>
            )}
          </span>
        )}
      </span>
      {active && timer}
    </div>
  );
}

function reversiScore(scores: ClientView["scores"], seat: number) {
  if (!scores || (seat !== 1 && seat !== 2)) return undefined;
  const value = scores[seat];

  return isNumber(value) && Number.isFinite(value) ? value : undefined;
}

export function MatchDesk({
  state,
  children,
  onExit,
  controls,
  broadcast = false,
  finalReveal,
}: {
  state: ClientView;
  children: ReactNode;
  onExit: () => void;
  controls?: ReactNode;
  broadcast?: boolean;
  finalReveal?: ClientView | null;
}) {
  const t = useT();

  const status =
    state.status === "waiting"
      ? t("match.lobby")
      : state.status === "ended"
        ? t("match.finished")
        : state.turnState?.phase === "hand_over"
          ? t("match.handFinished")
          : state.you?.isSpectator
            ? t("match.spectating")
            : state.you?.isYourTurn
              ? t("match.yourMove")
              : t("match.waiting");

  const deskRef = useRef<HTMLDivElement>(null);

  const ownDecision =
    state.status === "playing" &&
    state.turnState?.phase !== "hand_over" &&
    Boolean(state.you?.isYourTurn) &&
    !state.you?.isSpectator &&
    !state.replayReadOnly &&
    !broadcast &&
    state.type !== "contexto";

  const decisionKey = JSON.stringify([
    state.roomCode,
    state.turnState?.currentPlayerId,
    state.turnState?.phase,
    state.turnState?.startedAt,
    state.battleTurn,
    state.handNumber,
  ]);

  const previousDecision = useRef({ active: ownDecision, key: decisionKey });
  useEffect(() => {
    const previous = previousDecision.current;
    previousDecision.current = { active: ownDecision, key: decisionKey };

    if (!ownDecision || (previous.active && previous.key === decisionKey)) return;
    void playTurnStart();

    if (reducedMotion()) return;
    const flash = deskRef.current?.querySelector<HTMLElement>(".desk-turn-flash");

    const animation = flash?.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 0 }],
      { duration: 1100, easing: "cubic-bezier(.22,1,.36,1)" },
    );

    return () => animation?.cancel();
  }, [ownDecision, decisionKey]);

  const moveKey = JSON.stringify([
    state.type,
    state.roomCode,
    state.status,
    state.turnState?.turnNumber,
    state.turnState?.currentPlayerId,
    state.turnState?.phase,
    state.battleTurn,
  ]);

  const previousMove = useRef(moveKey);
  useEffect(() => {
    const changed = previousMove.current !== moveKey;
    previousMove.current = moveKey;

    if (
      !changed ||
      !(broadcast || state.you?.isSpectator) ||
      state.replayReadOnly ||
      state.status !== "playing" ||
      reducedMotion()
    )
      return;
    const animations: Animation[] = [];
    deskRef.current
      ?.querySelectorAll<HTMLElement>(".desk-title > span, .desk-decision-clock")
      .forEach((node) => {
        animations.push(
          node.animate(
            [
              { opacity: 0.35, translate: "0 5px" },
              { opacity: 1, translate: "0 0" },
            ],
            { duration: 450, easing: "cubic-bezier(.16,1,.3,1)" },
          ),
        );
      });
    deskRef.current
      ?.querySelectorAll<HTMLElement>(
        '.desk-player.is-active, .card-seat[data-active="true"], .word-team p[data-active="true"]',
      )
      .forEach((node) => {
        animations.push(
          node.animate([{ opacity: 0.55 }, { opacity: 1 }], {
            duration: 450,
            easing: "cubic-bezier(.16,1,.3,1)",
          }),
        );
      });

    return () => animations.forEach((animation) => animation.cancel());
  }, [moveKey, broadcast, state.you?.isSpectator, state.replayReadOnly, state.status]);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && menu.current && !menu.current.contains(event.target))
        menu.current.open = false;
    };

    document.addEventListener("pointerdown", close);

    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const serverTurnDuration =
    state.clock?.turnEndsAt == null
      ? undefined
      : Math.max(0, state.clock.turnEndsAt - state.clock.serverTime);

  const duration =
    state.type === "battleship" && state.turnState?.phase === "placement"
      ? 300000
      : (state.timerConfig?.turnTime ??
        serverTurnDuration ??
        state.turnState?.turnTimeRemaining ??
        60000);

  const replay = Boolean(state.replayReadOnly);
  const stream = broadcast && !replay;

  const terminalKey =
    state.status === "ended" && !replay
      ? JSON.stringify([state.type, state.roomCode, state.turnState?.turnNumber, state.handNumber])
      : null;

  const [finishedKey, setFinishedKey] = useState<string | null>(null);
  const finishing = Boolean(terminalKey && finishedKey !== terminalKey);
  useEffect(() => {
    if (!terminalKey) {
      setFinishedKey(null);

      return;
    }

    const reduced = reducedMotion();

    const duration = reduced
      ? 0
      : state.type === "connect4"
        ? 2050
        : state.type === "pokemon"
          ? 650
          : state.type === "poker"
            ? 1500
            : 1100;

    const timer = window.setTimeout(() => setFinishedKey(terminalKey), duration);

    return () => window.clearTimeout(timer);
  }, [terminalKey, state.type]);

  const pokemonResultKey =
    state.type === "pokemon" && state.status === "ended" && !replay
      ? JSON.stringify([
          state.roomCode,
          state.battleLogOffset,
          state.battleLog?.length,
          state.battleLog?.at(-1),
          state.battleTurn,
          state.winner,
        ])
      : null;

  const [settledPokemonResult, setSettledPokemonResult] = useState<string | null>(null);

  const pokemonResultPending = Boolean(
    pokemonResultKey && settledPokemonResult !== pokemonResultKey,
  );

  const settlePokemonPlayback = useCallback(() => {
    if (pokemonResultKey) setSettledPokemonResult(pokemonResultKey);
  }, [pokemonResultKey]);

  const [settledPokerResult, setSettledPokerResult] = useState<string | null>(null);

  const pokerResultPending = Boolean(
    state.type === "poker" && terminalKey && settledPokerResult !== terminalKey,
  );

  const settlePokerPlayback = useCallback(() => {
    if (terminalKey) setSettledPokerResult(terminalKey);
  }, [terminalKey]);

  const resultPending = finishing || pokemonResultPending || pokerResultPending;

  if (state.status === "ended" && !replay && !resultPending)
    return (
      <MatchResult
        state={state}
        finalReveal={finalReveal}
        onExit={onExit}
        controls={controls}
        broadcast={broadcast}
      />
    );

  const jevStatus =
    !replay &&
    state.status === "playing" &&
    state.jev?.playerId &&
    state.jev.status !== "ready" &&
    state.jev.status !== "thinking"
      ? { playerId: state.jev.playerId, status: state.jev.status }
      : null;

  const dockControls = !stream && (replay || state.status === "ended");
  const visibleControls = resultPending ? null : controls;
  const title = getGame(state.type)?.title ?? t("match.gameFallback");

  const subtitle =
    state.status === "waiting"
      ? t("match.lobby")
      : state.turnState?.phase === "hand_over"
        ? t("match.handSummary", { hand: state.handNumber ?? 1 })
        : state.type === "contexto"
          ? t("match.guessCount", { count: state.totalGuesses ?? 0 })
          : t("match.turnSummary", { turn: state.turnState?.turnNumber ?? 1 });

  const gameOptions = (
    <div className="desk-options-panel">
      <div className="desk-option desk-mobile-setting">
        <span>{t("match.sound")}</span>
        <SoundControl />
      </div>
      <div className="desk-option desk-mobile-setting">
        <span>{t("match.fullscreen")}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("match.fullscreenSettings")}
          onClick={toggleFullscreen}
        >
          <Icon name="expand" size={18} />
        </Button>
      </div>
      {state.type !== "contexto" &&
        state.status === "playing" &&
        isNumber(state.gameTimeRemaining) && (
          <div className="desk-option desk-mobile-setting">
            <span>{t("match.matchLeft")}</span>
            <MatchClock state={state} label={t("match.matchTimeSettings")} />
          </div>
        )}
      <div className="desk-option">
        <span>{t("match.theme")}</span>
        <ThemeToggle />
      </div>
      {!dockControls && visibleControls && (
        <div className="desk-host-controls">{visibleControls}</div>
      )}
      <Button variant="secondary" size="sm" onClick={onExit}>
        {t("match.leave")}
      </Button>
    </div>
  );

  return (
    <PokemonPlaybackSettledContext.Provider
      value={pokemonResultPending ? settlePokemonPlayback : null}
    >
      <PokerPlaybackSettledContext.Provider value={pokerResultPending ? settlePokerPlayback : null}>
        <GameAvatarContext.Provider
          value={[...(state.players ?? []), ...(state.spectators ?? [])].map((player) => player.id)}
        >
          <JevStatusContext.Provider value={jevStatus}>
            <div
              ref={deskRef}
              className="match-desk command-workspace"
              data-game={state.type}
              data-phase={state.status}
              data-finishing={resultPending}
              data-replay={replay || undefined}
              data-stream={stream}
              data-turn={ownDecision || undefined}
            >
              <span className="desk-turn-flash" aria-hidden="true" />
              <header className="desk-bar" aria-label={t("match.controlsLabel", { status })}>
                <div className="desk-bar-start">
                  {!stream && (
                    <Button
                      className="desk-round"
                      variant="secondary"
                      size="icon"
                      aria-label={t("match.leave")}
                      onClick={onExit}
                    >
                      <Icon name="back" size={20} />
                    </Button>
                  )}
                  <DecisionClock state={state} duration={duration} />
                </div>
                <div className="desk-title">
                  <h1>{title}</h1>
                  <span>{subtitle}</span>
                </div>
                <div className="desk-bar-end">
                  <MatchClock state={state} />
                  {!stream && (
                    <>
                      <span className="desk-round-slot">
                        <SoundControl />
                      </span>
                      <Button
                        className="desk-round"
                        variant="ghost"
                        size="icon"
                        aria-label={t("match.fullscreen")}
                        onClick={toggleFullscreen}
                      >
                        <Icon name="expand" size={18} />
                      </Button>
                      <details
                        className="desk-options"
                        ref={menu}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.currentTarget.open = false;
                            event.currentTarget.querySelector("summary")?.focus();
                          }
                        }}
                      >
                        <summary aria-label={t("match.options")}>
                          <Icon name="more" size={22} />
                        </summary>
                        {gameOptions}
                      </details>
                    </>
                  )}
                </div>
              </header>
              <main className="desk-layout">
                {state.status !== "waiting" && (
                  <section className="desk-players" aria-label={t("match.players")} tabIndex={0}>
                    {state.players?.map((player, index) => {
                      const seat =
                        ["connect4", "reversi", "checkers"].includes(state.type ?? "") &&
                        !Array.isArray(state.seats)
                          ? (state.seats?.[player.id] ?? index + 1)
                          : index + 1;

                      return (
                        <PlayerRow
                          key={player.id}
                          player={player}
                          index={seat - 1}
                          gameType={state.type}
                          score={
                            ["reversi", "checkers"].includes(state.type ?? "")
                              ? reversiScore(state.scores, seat)
                              : undefined
                          }
                          roleLabel={
                            state.type === "codenames"
                              ? (() => {
                                  const role = state.assignments?.[player.id];

                                  return role
                                    ? `${t(role.team === "red" ? "lobby.red" : "lobby.blue")} · ${t(role.role === "spymaster" ? "lobby.spymaster" : "match.operative")}`
                                    : t("match.unassigned");
                                })()
                              : undefined
                          }
                          active={
                            state.status === "playing" &&
                            player.id === state.turnState?.currentPlayerId
                          }
                          self={!state.you?.isSpectator && player.id === state.you?.playerId}
                          timer={<TurnProgress state={state} duration={duration} />}
                        />
                      );
                    })}
                  </section>
                )}
                <section className="desk-play" aria-label={t("match.board")}>
                  {children}
                </section>
                {dockControls && visibleControls && (
                  <aside className="desk-replay-controls" aria-label={t("match.replayControls")}>
                    {visibleControls}
                  </aside>
                )}
              </main>
            </div>
          </JevStatusContext.Provider>
        </GameAvatarContext.Provider>
      </PokerPlaybackSettledContext.Provider>
    </PokemonPlaybackSettledContext.Provider>
  );
}
