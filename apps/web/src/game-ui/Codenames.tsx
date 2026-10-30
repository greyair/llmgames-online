import { isWordBoard } from "@/domain/view-contracts";
import type { WireValue } from "@llmgames/game-catalog";
import { isNumber } from "@llmgames/game-catalog";

import { GamePlayerAvatar } from "./GamePlayerAvatar";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ClientView } from "@/domain/game-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { play } from "@/lib/sound";
import { PlayerName } from "./PlayerName";
import "./codenames.css";
import "./sketch/codenames.css";
import { useT } from "@/i18n";

/** Turns rows of '#' (fill) and '+' (shade) into crisp SVG pixel paths. */
function pixelPaths(rows: string[]) {
  const paths = { fill: "", shade: "" };
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];

      if (cell === "#") paths.fill += `M${x} ${y}h1v1h-1z`;
      else if (cell === "+") paths.shade += `M${x} ${y}h1v1h-1z`;
    }
  });

  return paths;
}

const AGENT = pixelPaths([
  "....####....",
  "...######...",
  "...######...",
  ".##########.",
  "....####....",
  "....#++#....",
  ".....##.....",
  "..###++###..",
  ".####++####.",
  ".#####+####.",
  ".##########.",
  ".##########.",
]);

const SKULL = pixelPaths([
  "...#####...",
  ".#########.",
  "###########",
  "##++###++##",
  "#+++###+++#",
  "##++#+#++##",
  "#####+#####",
  ".#########.",
  "..#.#.#.#..",
  "..#######..",
]);

function CardArt({ kind }: { kind: string }) {
  const art = kind === "assassin" ? SKULL : AGENT;
  const width = kind === "assassin" ? 11 : 12;

  return (
    <svg
      className="word-card-art"
      viewBox={`0 0 ${width} ${kind === "assassin" ? 10 : 12}`}
      aria-hidden="true"
    >
      <path className="word-art-fill" d={art.fill} />
      <path className="word-art-shade" d={art.shade} />
    </svg>
  );
}

export function Codenames({
  state,
  send,
}: {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
}) {
  const t = useT();

  const [word, setWord] = useState(""),
    [count, setCount] = useState("2");

  const [rosters, setRosters] = useState({ blue: false, red: false });
  const board = state.board && isWordBoard(state.board) ? state.board : [];
  const clue = state.clue ?? null;
  const remaining = state.remaining;

  const interactive =
    state.status === "playing" && !state.you?.isSpectator && !state.replayReadOnly;

  const can = (action: string) => interactive && Boolean(state.you?.legalActions?.includes(action));
  const seesKey = Boolean(state.you?.canSeeKey) || state.status === "ended";
  const assignments = state.assignments ?? {};
  const boardRef = useRef<HTMLDivElement>(null);

  const revealedKey = board
    .filter((card) => card.revealed)
    .map((card) => card.index)
    .join(",");

  const clueKey = clue ? `${clue.word}:${clue.count}` : "";
  const previous = useRef({ room: state.roomCode, revealed: revealedKey, clue: clueKey });
  useEffect(() => {
    const before = previous.current;
    previous.current = { room: state.roomCode, revealed: revealedKey, clue: clueKey };

    if (before.room !== state.roomCode || state.replayReadOnly) return;

    const timers: number[] = [],
      animations: Animation[] = [];

    if (clueKey && clueKey !== before.clue) {
      play("clue");
      const tile = boardRef.current?.parentElement?.querySelector<HTMLElement>(".words-clue-tile");

      if (tile && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        animations.push(
          tile.animate(
            [
              { translate: "0 -30%", opacity: 0 },
              { translate: "0 0", opacity: 1 },
            ],
            { duration: 320, easing: "steps(4,end)" },
          ),
        );
    }

    const old = new Set(before.revealed ? before.revealed.split(",") : []);
    const fresh = board.filter((card) => card.revealed && !old.has(String(card.index)));

    // Several reveals at once come from a reconnect snapshot, not a guess.
    if (fresh.length === 1) {
      const card = fresh[0]!;
      const element = boardRef.current?.querySelector<HTMLElement>(`[data-index="${card.index}"]`);
      play("cardFlip");

      if (card.affiliation === "assassin")
        timers.push(window.setTimeout(() => play("assassin"), 220));

      if (element && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        animations.push(
          element.animate(
            [
              { scale: "1 1", filter: "brightness(1)" },
              { scale: "1 0.08", filter: "brightness(1.6)", offset: 0.45 },
              { scale: "1 1", filter: "brightness(1)" },
            ],
            { duration: 420, easing: "steps(7,end)" },
          ),
        );
    }

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      animations.forEach((animation) => animation.cancel());
    };
  }, [revealedKey, clueKey, state.roomCode, state.replayReadOnly]);

  const teamPanel = (team: "blue" | "red") => {
    const count = remaining?.[team];
    const name = t(team === "blue" ? "lobby.blue" : "lobby.red");
    const active = state.status === "playing" && state.activeTeam === team;
    const winner = state.status === "ended" && state.winnerTeam === team;

    return (
      <aside
        className={`word-team word-team-${team}`}
        aria-label={t("board.codenames.teamLabel", { team: name })}
        data-team={team}
        data-expanded={rosters[team]}
        data-active={active}
        data-winner={winner || undefined}
      >
        <div className="word-team-head">
          <span
            className="word-team-score"
            data-team={team}
            aria-label={
              isNumber(count)
                ? t("board.codenames.agentsLeft", { count })
                : t("board.codenames.agentsUnknown")
            }
          >
            <b key={count}>{count ?? "—"}</b>
            <small aria-hidden="true">{t("board.codenames.left")}</small>
          </span>
          <button
            type="button"
            className="word-roster-toggle"
            aria-expanded={rosters[team]}
            aria-controls={`word-roster-${team}`}
            onClick={() => setRosters((current) => ({ ...current, [team]: !current[team] }))}
          >
            <span className="word-team-name">
              {name}
              <span className="word-team-suffix"> team</span>
            </span>
            <span className="word-team-status">
              {winner
                ? t("board.codenames.winners")
                : active
                  ? state.turnState?.phase === "clue"
                    ? t("board.codenames.givingClue")
                    : t("board.codenames.guessing")
                  : t("match.waiting")}
            </span>
            <span className="word-team-left">{count ?? "—"} {t("board.codenames.left")}</span>
            <i className="word-roster-chevron" aria-hidden="true">
              {rosters[team] ? "−" : "+"}
            </i>
          </button>
        </div>
        <div
          className="word-team-card"
          id={`word-roster-${team}`}
          tabIndex={0}
          aria-label={t("board.codenames.roster", { team: name })}
        >
          {(["spymaster", "operative"] as const).map((role) => {
            const acting = active && (state.turnState?.phase === "clue") === (role === "spymaster");

            const members =
              state.players?.filter(
                (player) =>
                  assignments[player.id]?.team === team && assignments[player.id]?.role === role,
              ) ?? [];

            return (
              <section key={role} data-active={acting}>
                <h2>{t(role === "operative" ? "lobby.operatives" : "lobby.spymaster")}</h2>
                {members.length ? (
                  members.map((player) => (
                    <p key={player.id} data-active={acting}>
                      <GamePlayerAvatar player={player} />
                      <PlayerName player={player} />
                      {acting && <span className="desk-active-label">{t("board.codenames.move")}</span>}
                    </p>
                  ))
                ) : (
                  <p className="word-team-empty">{t("board.codenames.openSeat")}</p>
                )}
              </section>
            );
          })}
        </div>
      </aside>
    );
  };

  const headingTeam = state.status === "ended" ? (state.winnerTeam ?? undefined) : state.activeTeam;

  const heading =
    state.status === "ended"
      ? t("board.codenames.gameFinishedUpper")
      : t("board.codenames.turnHeader", {
          team: t(state.activeTeam === "blue" ? "lobby.blue" : "lobby.red"),
          role: t(
            state.turnState?.phase === "clue"
              ? "board.codenames.spymasterUpper"
              : "board.codenames.operativesUpper",
          ),
        });

  const affiliationName = (kind: string) =>
    t(
      kind === "red"
        ? "board.codenames.redAgent"
        : kind === "blue"
          ? "board.codenames.blueAgent"
          : kind === "assassin"
            ? "board.codenames.assassin"
            : "board.codenames.bystander",
    );

  const countLabel = clue ? (clue.count === "unlimited" ? "∞" : String(clue.count)) : "";

  return (
    <div
      className="word-workspace"
      data-status={state.status}
      data-active-team={state.status === "playing" ? state.activeTeam : undefined}
    >
      {teamPanel("blue")}
      <div className="words-stage">
        <header className="words-heading">
          <strong className="words-turn-heading" data-team={headingTeam} key={heading}>
            <i aria-hidden="true" />
            {heading}
          </strong>
        </header>
        <div className="words-controls" role="region" aria-label={t("board.codenames.clueControls")}>
          {can("give_clue") ? (
            <form
              className="words-clue-form"
              onSubmit={(event) => {
                event.preventDefault();

                if (word.trim() && !/\s/.test(word.trim()))
                  send("give_clue", {
                    word: word.trim(),
                    count: count === "unlimited" ? count : Number(count),
                  });
              }}
            >
              <label className="words-field words-field-word">
                <span>{t("board.codenames.oneWordClue")}</span>
                <Input
                  aria-label={t("board.codenames.clueWord")}
                  value={word}
                  onChange={(event) => setWord(event.target.value)}
                  required
                  pattern="\S+"
                  maxLength={40}
                  placeholder={t("board.codenames.cluePlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="words-field words-field-count">
                <span>{t("board.codenames.count")}</span>
                <select
                  aria-label={t("board.codenames.clueCount")}
                  className="ui-input"
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                >
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "unlimited"].map((value) => (
                    <option value={value} key={value}>
                      {value === "unlimited" ? t("board.codenames.unlimitedOption") : value}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="submit"
                size="lg"
                data-sound="clue"
                disabled={!word.trim() || /\s/.test(word.trim())}
              >
                {t("board.codenames.giveClue")}
              </Button>
            </form>
          ) : (
            <div className="words-clue">
              {state.status === "ended" ? (
                <strong className="words-result" data-team={state.winnerTeam ?? undefined}>
                  {state.winnerTeam
                    ? t("board.codenames.teamWins", {
                        team: t(state.winnerTeam === "red" ? "lobby.red" : "lobby.blue"),
                      })
                    : t("board.codenames.gameFinished")}
                </strong>
              ) : clue ? (
                <>
                  <div className="words-clue-tile" data-team={state.activeTeam}>
                    <span>{t("board.codenames.clue")}</span>
                    <strong>{clue.word.toUpperCase()}</strong>
                    <b
                      aria-label={
                        clue.count === "unlimited"
                          ? t("board.codenames.unlimited")
                          : t("board.codenames.countValue", { count: clue.count })
                      }
                    >
                      {countLabel}
                    </b>
                  </div>
                  <div className="words-guesses-tile">
                    <b>{state.guessesRemaining == null ? "∞" : state.guessesRemaining}</b>
                    <span>
                      {state.guessesRemaining == null
                        ? t("board.codenames.unlimitedGuesses")
                        : t(
                            state.guessesRemaining === 1
                              ? "board.codenames.guessLeft"
                              : "board.codenames.guessesLeft",
                          )}
                    </span>
                  </div>
                </>
              ) : (
                <p className="words-waiting">
                  {state.you?.isSpectator
                    ? t("board.codenames.waitingClue")
                    : t("board.codenames.waitingOthers")}
                </p>
              )}
              {can("end_turn") && (
                <Button
                  variant="secondary"
                  size="lg"
                  className="words-end-turn"
                  onClick={() => send("end_turn", {})}
                >
                  {t("board.codenames.endTurn")}
                </Button>
              )}
            </div>
          )}
        </div>
        <div
          ref={boardRef}
          className="words-board"
          role="group"
          aria-label={t("board.codenames.boardTitle")}
          data-key={seesKey}
          data-guessing={can("guess_word") || undefined}
        >
          {board.map((card) => {
            const affiliation = card.revealed || seesKey ? card.affiliation : null;

            return (
              <button
                key={card.index}
                type="button"
                data-index={card.index}
                className="word-card"
                data-team={affiliation ?? "hidden"}
                data-revealed={card.revealed}
                data-sound="guess"
                disabled={!can("guess_word") || card.revealed}
                style={
                  { "--len": Math.max(5, card.word.length) } satisfies CSSProperties & {
                    [property: `--${string}`]: string | number | undefined;
                  }
                }
                aria-label={[
                  card.word,
                  card.revealed ? `, ${t("board.codenames.revealed")}` : "",
                  affiliation ? `, ${affiliationName(affiliation)}` : "",
                ].join("")}
                onClick={() => send("guess_word", { index: card.index })}
              >
                {card.revealed && affiliation && <CardArt kind={affiliation} />}
                <span className="word-card-word">{card.word}</span>
              </button>
            );
          })}
        </div>
      </div>
      {teamPanel("red")}
    </div>
  );
}
