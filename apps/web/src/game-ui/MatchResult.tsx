import { knownValue } from "@/domain/view-contracts";
import { isNumber } from "@llmgames/game-catalog";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import { play } from "@/lib/sound";
import type { ClientView } from "@/domain/game-state";
import { Button } from "@/components/ui/button";
import { getGame } from "@/interface/catalog";
import { playerPrimaryName } from "@/features/shared/playerIdentity";
import { GamePlayerAvatar } from "./GamePlayerAvatar";
import { PlayerName } from "./PlayerName";
import "./match-result.css";
import { FinalState } from "./FinalState";
import { VictoryConfetti } from "./VictoryConfetti";

function outcome(state: ClientView) {
  const team = state.winnerTeam;
  const winner = state.players?.find((player) => player.id === state.winner);
  const draw = state.winner === "draw";

  const won =
    !state.you?.isSpectator &&
    ((winner?.id === state.you?.playerId && Boolean(winner)) ||
      Boolean(team && team === state.you?.team));

  const title = draw
    ? "A draw. Well played."
    : won
      ? "You win!"
      : team
        ? `${team === "red" ? "Red" : "Blue"} team wins!`
        : winner
          ? `${playerPrimaryName(winner)} wins!`
          : "Match complete";

  const tone =
    draw || !(winner || team)
      ? "neutral"
      : won
        ? "win"
        : state.you?.playerId && !state.you?.isSpectator
          ? "loss"
          : "neutral";

  return { title, winner, team, tone, celebrate: !draw && Boolean(winner || team) };
}

// 14x12 pixel cup: a = bright gold, b = shade, c = shine, d = dark base.
const TROPHY = [
  "..aaaaaaaaaa..",
  "aaacaaaaaaabaa",
  "a.acaaaaaaab.a",
  "a.acaaaaaaab.a",
  ".a.caaaaaab.a.",
  "...aaaaaaabb..",
  "....aaaaabb...",
  "......abb.....",
  "......abb.....",
  "....dddddd....",
  "...dddddddd...",
  "...dddddddd...",
];

const trophyFill = {
  a: "var(--palette-sun)",
  b: "var(--palette-sun-deep)",
  c: "var(--palette-white)",
  d: "var(--palette-g800)",
} satisfies Record<string, string>;

function Trophy({ celebrate }: { celebrate: boolean }) {
  return (
    <div className="result-art" data-celebrate={celebrate} aria-hidden="true">
      <svg viewBox="0 0 14 12" {...{ "shapeRendering": "crispEdges" }}>
        {TROPHY.flatMap((row, y) =>
          [...row].map((cell, x) =>
            cell === "." ? null : (
              <rect
                key={`${x}-${y}`}
                x={x}
                y={y}
                width={1}
                height={1}
                fill={knownValue(trophyFill, cell)}
              />
            ),
          ),
        )}
      </svg>
    </div>
  );
}

function Burst({ tone }: { tone: string }) {
  return (
    <div className="result-burst" data-tone={tone} aria-hidden="true">
      {[1, 2, 3, 4, 5, 6].map((ring) => (
        <span
          key={ring}
          style={
            { "--ring": ring } satisfies CSSProperties & {
              [property: `--${string}`]: string | number | undefined;
            }
          }
        />
      ))}
    </div>
  );
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function CountUp({ value, silent }: { value: number; silent: boolean }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  useEffect(() => {
    if (reducedMotion() || value <= 0) {
      setShown(value);

      return;
    }

    let frame = 0,
      last = 0,
      lastSound = 0;

    const start = performance.now(),
      duration = Math.min(900, 260 + value * 24);

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration),
        next = Math.round(value * (1 - Math.pow(1 - t, 3)));

      if (next !== last) {
        last = next;
        setShown(next);

        if (!silent && now - lastSound > 70) {
          lastSound = now;
          play("count", { pitch: 0.9 + t * 0.5 });
        }
      }

      if (t < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frame);
  }, [value, silent]);

  return <>{shown}</>;
}

export function MatchResult({
  state,
  finalReveal,
  onExit,
  controls,
  broadcast = false,
}: {
  state: ClientView;
  finalReveal?: ClientView | null;
  onExit: () => void;
  controls?: ReactNode;
  broadcast?: boolean;
}) {
  const layout = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = layout.current;

    if (!root) return;
    let offset = 0;

    const centerBoard = () => {
      if (!window.matchMedia("(min-width:900px) and (min-height:650px)").matches) {
        offset = 0;
        root.style.removeProperty("--result-offset");

        return;
      }

      const board =
        root.querySelector(".result-ships .sea-fit") ??
        root.querySelector(".result-board, .result-final");

      const summary = root.querySelector(".result-summary");

      if (!board || !summary) return;
      offset = parseFloat(getComputedStyle(summary).top) || 0;

      const area = root.getBoundingClientRect(),
        position = board.getBoundingClientRect();

      const heading = root.querySelector(".result-heading") ?? summary;

      const top = heading.getBoundingClientRect().top - offset,
        bottom = summary.getBoundingClientRect().bottom - offset;

      const padding = parseFloat(getComputedStyle(root).paddingTop);
      const desired = area.top + area.height / 2 - (position.top - offset + position.height / 2);
      offset = Math.max(
        area.top + padding - top,
        Math.min(desired, area.bottom - padding - bottom),
      );
      root.style.setProperty("--result-offset", `${offset}px`);
    };

    const observer = new ResizeObserver(centerBoard);
    observer.observe(root);

    for (const element of root.querySelectorAll(
      ".result-summary,.result-heading,.result-final,.result-board",
    ))
      observer.observe(element);
    centerBoard();

    return () => observer.disconnect();
  }, [state.type, state.status]);
  const result = outcome(state);
  const reduceMotion = useReducedMotion();
  const announced = useRef("");
  useEffect(() => {
    if (broadcast) return;
    const key = `${state.roomCode ?? ""}:${state.winner ?? ""}:${state.winnerTeam ?? ""}`;

    if (announced.current === key) return;
    announced.current = key;

    if (state.winner === "draw") play("draw");
    else if (result.tone === "win") play("win");
    else if (result.tone === "loss") play("loss");
    else if (result.celebrate) play("success");
  }, [broadcast, state.roomCode, state.winner, state.winnerTeam, result.tone, result.celebrate]);

  const factCount =
    state.type === "contexto" ? (state.totalGuesses ?? 0) : (state.turnState?.turnNumber ?? 0);

  const secret = state.type === "contexto" ? state.secret : undefined;

  const description =
    secret || state.type === "poker" || state.type === "battleship"
      ? undefined
      : state.lastAnnouncement?.trim();

  const exitLabel = "Find another game";

  const playerCards =
    state.players?.map((player) => {
      const team = state.assignments?.[player.id]?.team;

      const winner =
        player.id === result.winner?.id || Boolean(result.team && team === result.team);

      const seat = Array.isArray(state.seats)
        ? state.seats.find((value: { playerId?: string }) => value.playerId === player.id)
        : null;

      const chips = seat?.stack ?? seat?.chips;

      return (
        <div className="result-player" data-winner={winner} key={player.id}>
          <span className="result-avatar">
            <GamePlayerAvatar player={player} size={42} />
          </span>
          <PlayerName
            className="result-player-name"
            player={player}
            extra={winner ? "Won" : undefined}
          />
          <span className="result-player-status">
            {winner ? "Winner" : state.winner === "draw" ? "Draw" : "Finished"}
          </span>
          {isNumber(chips) && (
            <small className="result-player-chips" aria-label={`${chips.toLocaleString()} chips`}>
              {chips.toLocaleString()}
            </small>
          )}
        </div>
      );
    }) ?? [];

  const ships = state.type === "battleship";

  return (
    <main
      ref={layout}
      className="match-result"
      data-game={state.type}
      data-outcome={result.tone}
      data-broadcast={broadcast}
    >
      {result.celebrate && result.tone !== "loss" && <VictoryConfetti />}
      <section className="result-summary" aria-label="Match summary">
        <Burst tone={result.tone} />
        {result.celebrate && (
          <motion.div
            className="result-trophy"
            role="img"
            aria-label="Winner trophy"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.4, rotate: -18 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 16, delay: 0.05 }}
          >
            <Trophy celebrate />
          </motion.div>
        )}
        <motion.h1
          initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 22, delay: 0.12 }}
        >
          {result.title}
        </motion.h1>
        <div className="result-details">
          <div className="result-facts">
            {!broadcast && (
              <span className="result-game">
                {getGame(state.type)?.title ?? "Game"} · Final result
              </span>
            )}
            <span>
              <CountUp value={factCount} silent={broadcast} />{" "}
              {state.type === "contexto"
                ? factCount === 1
                  ? "room guess"
                  : "room guesses"
                : factCount === 1
                  ? "turn"
                  : "turns"}
            </span>
            {state.handNumber !== undefined && (
              <span>
                <CountUp value={state.handNumber} silent />{" "}
                {state.handNumber === 1 ? "hand" : "hands"}
              </span>
            )}
          </div>
          {description && <p className={secret ? "result-secret" : ""}>{description}</p>}
        </div>
        <div className="result-main">
          <div className="result-center">
            <FinalState
              state={state}
              reveal={finalReveal}
              renderShipPlayer={(id) => playerCards.find((card) => card.key === id)}
              renderCardPlayer={(id) => playerCards.find((card) => card.key === id)}
            />
            {!ships && state.type !== "poker" && (
              <div className="result-players" aria-label="Players">
                {playerCards}
              </div>
            )}

            {!broadcast && (
              <div className="result-actions">
                {controls}
                <Button onClick={onExit}>{exitLabel}</Button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
