import type { WireValue } from "@llmgames/game-catalog";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ClientView } from "@/domain/game-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { play, playRank } from "@/lib/sound";
import { GamePlayerAvatar } from "./GamePlayerAvatar";
import { PlayerName } from "./PlayerName";
import { contextoHeat, contextoRankStyle } from "./contextoRankStyle";
import "./contexto.css";
import "./sketch/contexto.css";

type OwnGuess = { word: string; submittedWord?: string; rank: number; sequence: number };

type MaskedGuess = { rank: number; masked: true };

type GuessAttempt = {
  submittedWord: string;
  canonicalWord?: string;
  status: "ranked" | "aliased" | "not_in_pool";
  rank?: number;
};

function isOwnGuess(guess: OwnGuess | MaskedGuess): guess is OwnGuess {
  return "word" in guess;
}

const ROW_SPRING = { type: "spring", stiffness: 520, damping: 38, mass: 0.8 } as const;

function RankRow({
  guess,
  masked = false,
  showSequence = false,
  latest = false,
}: {
  guess: OwnGuess | MaskedGuess;
  masked?: boolean;
  showSequence?: boolean;
  latest?: boolean;
}) {
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={ROW_SPRING}
      className="contexto-rank-row"
      data-heat={contextoHeat(guess.rank)}
      data-ranked={guess.rank <= 1000}
      data-latest={latest || undefined}
      style={contextoRankStyle(guess.rank)}
    >
      <span>{masked ? "••••••" : isOwnGuess(guess) ? guess.word : "••••••"}</span>
      {isOwnGuess(guess) && guess.submittedWord ? (
        <em>from {guess.submittedWord}</em>
      ) : showSequence && isOwnGuess(guess) ? (
        <em>Guess {guess.sequence}</em>
      ) : null}
      <strong>{guess.rank.toLocaleString()}</strong>
    </motion.li>
  );
}

function Secret({ word }: { word: string }) {
  return (
    <div className="contexto-secret" style={contextoRankStyle(1)}>
      <span>The hidden word was</span>
      <strong>{word}</strong>
    </div>
  );
}

/** Fifty pixel cells: ink for guesses still available, grey for spent ones. */
function GuessMeter({ left, limit }: { left: number; limit: number }) {
  return (
    <span className="contexto-meter-track" aria-hidden="true">
      {Array.from({ length: limit }, (_, index) => (
        <i key={index} data-left={index < left || undefined} />
      ))}
    </span>
  );
}

/** Plays the rank cue once per newly accepted own guess; snapshots on mount or room change stay silent. */
function useGuessSounds(
  roomCode: string | undefined,
  guesses: OwnGuess[],
  attempt: GuessAttempt | null | undefined,
  silent: boolean,
) {
  const seen = useRef<{ room?: string; sequences: Set<number>; attempt: string } | null>(null);
  const attemptKey = attempt ? JSON.stringify(attempt) : "";
  const [shakeKey, setShakeKey] = useState(0);
  useEffect(() => {
    const sequences = new Set(guesses.map((guess) => guess.sequence));
    const before = seen.current;
    seen.current = { room: roomCode, sequences, attempt: attemptKey };

    if (!before || before.room !== roomCode || silent) return;
    const fresh = guesses.filter((guess) => !before.sequences.has(guess.sequence));

    if (fresh.length > 0 && fresh.length <= 2)
      fresh.forEach((guess, index) => window.setTimeout(() => playRank(guess.rank), index * 90));
    else if (attemptKey && attemptKey !== before.attempt && attempt?.status === "not_in_pool") {
      play("error");
      setShakeKey((key) => key + 1);
    }
  }, [roomCode, guesses, attemptKey, attempt?.status, silent]);

  return shakeKey;
}

export function Contexto({
  state,
  send,
}: {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
}) {
  const [word, setWord] = useState("");
  const playerId = state.you?.playerId;
  const progress = state.progress ?? {};
  const mine = playerId ? progress[playerId] : undefined;
  const ownAll = useMemo(() => [...(mine?.guesses ?? [])].filter(isOwnGuess), [mine?.guesses]);
  const ownGuesses = useMemo(() => [...ownAll].sort((a, b) => a.rank - b.rank), [ownAll]);
  const lastGuess = useMemo(() => [...ownAll].sort((a, b) => b.sequence - a.sequence)[0], [ownAll]);
  const lastAttempt = mine?.lastAttempt;
  const players = state.players ?? [];
  const opponents = players.filter((player) => player.id !== playerId);

  const canGuess =
    state.status === "playing" &&
    !state.replayReadOnly &&
    !state.you?.isSpectator &&
    state.you?.legalActions?.includes("guess_word") &&
    !mine?.exhausted;

  const spectating = Boolean(state.you?.isSpectator);
  const fullBoard = Boolean(state.broadcastPublic || spectating);

  const shakeKey = useGuessSounds(
    state.roomCode,
    ownAll,
    lastAttempt,
    Boolean(state.replayReadOnly || fullBoard),
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const guess = word.trim().toLowerCase();

    if (!guess || !canGuess) return;
    send("guess_word", { word: guess });
    setWord("");
  };

  const limit = state.guessLimit ?? 50;

  if (state.replayReadOnly || fullBoard)
    return (
      <div
        className="contexto-stage contexto-replay-stage"
        data-player-count={players.length}
        data-ended={state.status === "ended"}
        data-public={fullBoard || undefined}
      >
        <section
          className="contexto-replay"
          aria-label={
            state.broadcastPublic
              ? "Public stream guesses"
              : spectating
                ? "Spectator guess ranks"
                : "All players' replay guesses"
          }
        >
          {!fullBoard && (
            <header className="contexto-replay-head">
              <div>
                <span>Replay trail</span>
                <strong>Every word and rank</strong>
              </div>
              <span>{state.totalGuesses ?? 0} guesses so far</span>
            </header>
          )}
          {state.status === "ended" && state.secret && <Secret word={state.secret} />}
          <div
            className="contexto-replay-grid"
            data-player-count={players.length}
            style={
              fullBoard
                ? ({ "--contexto-player-count": players.length } satisfies CSSProperties & {
                    [property: `--${string}`]: string | number | undefined;
                  })
                : undefined
            }
          >
            {players.map((player) => {
              const entry = progress[player.id];
              const visible = [...(entry?.guesses ?? [])];
              const guesses = visible.filter(isOwnGuess);
              const latest = [...guesses].sort((a, b) => b.sequence - a.sequence)[0];

              const ranked = [...visible].sort(
                (a, b) =>
                  a.rank - b.rank || (isOwnGuess(a) && isOwnGuess(b) ? b.sequence - a.sequence : 0),
              );

              const replay = [...guesses].sort((a, b) => b.sequence - a.sequence);
              const best = entry?.bestRank ?? null;

              return (
                <article
                  key={player.id}
                  className="contexto-replay-player"
                  data-heat={best ? contextoHeat(best) : undefined}
                  style={best ? contextoRankStyle(best) : undefined}
                >
                  <header>
                    {fullBoard && <GamePlayerAvatar player={player} size={42} />}
                    <PlayerName player={player} />
                    <span className="contexto-guess-count">
                      {fullBoard
                        ? `${entry?.guessCount ?? 0}/${limit}`
                        : entry?.bestRank
                          ? `Best ${entry.bestRank.toLocaleString()}`
                          : "No guesses yet"}
                    </span>
                  </header>
                  {visible.length ? (
                    state.broadcastPublic ? (
                      <>
                        {latest && (
                          <ol className="contexto-latest-guess">
                            <AnimatePresence initial={false} mode="popLayout">
                              <RankRow key={latest.sequence} guess={latest} latest />
                            </AnimatePresence>
                          </ol>
                        )}
                        <ol className="contexto-ranked-guesses">
                          <AnimatePresence initial={false}>
                            {ranked.map((guess) => (
                              <RankRow
                                key={isOwnGuess(guess) ? guess.sequence : `r${guess.rank}`}
                                guess={guess}
                              />
                            ))}
                          </AnimatePresence>
                        </ol>
                      </>
                    ) : spectating ? (
                      <ol className="contexto-ranked-guesses">
                        <AnimatePresence initial={false}>
                          {ranked.map((guess) => (
                            <RankRow key={`r${guess.rank}`} guess={guess} masked />
                          ))}
                        </AnimatePresence>
                      </ol>
                    ) : (
                      <ol className="contexto-replay-list">
                        <AnimatePresence initial={false}>
                          {replay.map((guess) => (
                            <RankRow key={guess.sequence} guess={guess} showSequence />
                          ))}
                        </AnimatePresence>
                      </ol>
                    )
                  ) : (
                    <p className="contexto-empty">No guesses in this frame</p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    );
  const left = mine?.guessesRemaining ?? limit;

  return (
    <div
      className="contexto-stage"
      data-player-count={players.length}
      data-ended={state.status === "ended"}
    >
      <section className="contexto-own" aria-label="Your guesses">
        <header className="contexto-own-head">
          <div className="contexto-meter" data-low={left <= 5 || undefined}>
            <strong aria-label={`${left} ${left === 1 ? "guess" : "guesses"} left`}>
              <b>{left}</b>
              <span aria-hidden="true">
                /{limit} {left === 1 ? "guess" : "guesses"} left
              </span>
            </strong>
            <GuessMeter left={left} limit={limit} />
          </div>
        </header>
        <p className="contexto-rank-help">Lower is closer · Rank 1 wins</p>
        <form className="contexto-form" onSubmit={submit} data-disabled={!canGuess}>
          <Input
            aria-label="Guess a word"
            placeholder="type one word"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={18}
            value={word}
            onChange={(event) =>
              setWord(event.target.value.replace(/[^a-zA-Z]/g, "").toLowerCase())
            }
            disabled={!canGuess}
          />
          <Button type="submit" size="lg" data-sound="none" disabled={!canGuess || !word.trim()}>
            Guess
          </Button>
        </form>
        {(lastAttempt || lastGuess) && (
          <div className="contexto-last">
            <span className="contexto-last-label" aria-hidden="true">
              Last guess
            </span>
            {lastAttempt ? (
              <div
                key={shakeKey}
                className={`contexto-last-guess${shakeKey ? " is-shaking" : ""}`}
                data-status={lastAttempt.status}
                style={lastAttempt.rank ? contextoRankStyle(lastAttempt.rank) : undefined}
                role={lastAttempt.status === "not_in_pool" ? "status" : undefined}
                aria-label={
                  lastAttempt.status === "not_in_pool"
                    ? `Last guess ${lastAttempt.submittedWord}, not in pool`
                    : lastAttempt.status === "aliased"
                      ? `Last guess ${lastAttempt.submittedWord}, counted as ${lastAttempt.canonicalWord}, rank ${lastAttempt.rank}`
                      : `Last guess ${lastAttempt.submittedWord}, rank ${lastAttempt.rank}`
                }
              >
                <strong>{lastAttempt.submittedWord}</strong>
                {lastAttempt.status === "aliased" ? (
                  <>
                    <small>
                      counted as <b>{lastAttempt.canonicalWord}</b>
                    </small>
                    <b>{lastAttempt.rank?.toLocaleString()}</b>
                  </>
                ) : lastAttempt.status === "not_in_pool" ? (
                  <b>not in pool</b>
                ) : (
                  <b>{lastAttempt.rank?.toLocaleString()}</b>
                )}
              </div>
            ) : (
              lastGuess && (
                <div
                  className="contexto-last-guess"
                  style={contextoRankStyle(lastGuess.rank)}
                  aria-label={`Last guess ${lastGuess.word}, rank ${lastGuess.rank}`}
                >
                  <strong>{lastGuess.word}</strong>
                  <b>{lastGuess.rank.toLocaleString()}</b>
                </div>
              )
            )}
          </div>
        )}
        {state.status === "ended" && state.secret && <Secret word={state.secret} />}
        <ol className="contexto-own-list" tabIndex={0} aria-label="Your ranked guess history">
          {ownGuesses.length ? (
            <AnimatePresence initial={false}>
              {ownGuesses.map((guess) => (
                <RankRow
                  key={guess.sequence}
                  guess={guess}
                  latest={guess.sequence === lastGuess?.sequence}
                />
              ))}
            </AnimatePresence>
          ) : (
            <li className="contexto-empty">Try a broad word. Follow the lower ranks.</li>
          )}
        </ol>
      </section>
      <section className="contexto-rivals" aria-label="Other players' hidden guesses">
        <header className="contexto-rivals-head">
          <h2>Rivals</h2>
          <span>Ranks only. Words stay secret.</span>
        </header>
        <div
          className="contexto-rival-grid"
          data-player-count={opponents.length}
          tabIndex={0}
          aria-label="Hidden rank standings"
        >
          {opponents.length ? (
            opponents.map((player) => {
              const entry = progress[player.id];
              const rivalBest = entry?.bestRank ?? null;

              return (
                <article
                  key={player.id}
                  className="contexto-rival"
                  data-heat={rivalBest ? contextoHeat(rivalBest) : undefined}
                  style={rivalBest ? contextoRankStyle(rivalBest) : undefined}
                >
                  <div className="contexto-rival-head">
                    <PlayerName player={player} />
                    <span>
                      {entry?.guessCount ?? 0} / {limit}
                    </span>
                  </div>
                  {rivalBest ? (
                    <ol aria-label={`${player.name ?? player.codename ?? "Player"} best ranks`}>
                      <AnimatePresence initial={false}>
                        {entry!.guesses.map((guess) => (
                          <RankRow key={`r${guess.rank}`} guess={guess} masked />
                        ))}
                      </AnimatePresence>
                    </ol>
                  ) : (
                    <p className="contexto-empty">No ranked guesses yet</p>
                  )}
                </article>
              );
            })
          ) : (
            <div className="contexto-waiting">
              <strong>You have the room.</strong>
              <span>Invite up to five more players.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
