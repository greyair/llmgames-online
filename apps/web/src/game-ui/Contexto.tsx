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
import { useT, type Translate } from "@/i18n";

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

// The wire contract makes the alias and rank optional, so the spoken label falls
// back to whichever parts the server actually sent instead of reading out blanks.
function lastGuessLabel(attempt: GuessAttempt, t: Translate): string {
  const { submittedWord: word, status, canonicalWord, rank } = attempt;

  if (status === "not_in_pool") return t("board.contexto.lastGuessNotInPool", { word });

  if (status === "aliased" && canonicalWord && rank !== undefined) {
    return t("board.contexto.lastGuessAliased", { word, canonical: canonicalWord, rank });
  }

  if (rank !== undefined) return t("board.contexto.lastGuessRank", { word, rank });

  return word;
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
  const t = useT();

  return (
    <div className="contexto-secret" style={contextoRankStyle(1)}>
      <span>{t("board.contexto.hiddenWord")}</span>
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
  const t = useT();
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
              ? t("board.contexto.publicStream")
              : spectating
                ? t("board.contexto.spectatorRanks")
                : t("board.contexto.allPlayers")
          }
        >
          {!fullBoard && (
            <header className="contexto-replay-head">
              <div>
                <span>{t("board.contexto.replayTrail")}</span>
                <strong>{t("board.contexto.everyWord")}</strong>
              </div>
              <span>{t("board.contexto.guessesSoFar", { count: state.totalGuesses ?? 0 })}</span>
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
                          ? t("board.contexto.best", { rank: entry.bestRank.toLocaleString() })
                          : t("board.contexto.noGuesses")}
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
                    <p className="contexto-empty">{t("board.contexto.noGuessesFrame")}</p>
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
      <section className="contexto-own" aria-label={t("board.contexto.yourGuesses")}>
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
        <p className="contexto-rank-help">{t("board.contexto.rankHelp")}</p>
        <form className="contexto-form" onSubmit={submit} data-disabled={!canGuess}>
          <Input
            aria-label={t("board.contexto.guessWord")}
            placeholder={t("board.contexto.typeOneWord")}
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
              {t("board.contexto.lastGuessLabel")}
            </span>
            {lastAttempt ? (
              <div
                key={shakeKey}
                className={`contexto-last-guess${shakeKey ? " is-shaking" : ""}`}
                data-status={lastAttempt.status}
                style={lastAttempt.rank ? contextoRankStyle(lastAttempt.rank) : undefined}
                role={lastAttempt.status === "not_in_pool" ? "status" : undefined}
                aria-label={lastGuessLabel(lastAttempt, t)}
              >
                <strong>{lastAttempt.submittedWord}</strong>
                {lastAttempt.status === "aliased" && lastAttempt.canonicalWord ? (
                  <>
                    <small>
                      {t("board.contexto.countedAs", { word: lastAttempt.canonicalWord })}
                    </small>
                    <b>{lastAttempt.rank?.toLocaleString()}</b>
                  </>
                ) : lastAttempt.status === "not_in_pool" ? (
                  <b>{t("board.contexto.notInPool")}</b>
                ) : (
                  <b>{lastAttempt.rank?.toLocaleString()}</b>
                )}
              </div>
            ) : (
              lastGuess && (
                <div
                  className="contexto-last-guess"
                  style={contextoRankStyle(lastGuess.rank)}
                  aria-label={t("board.contexto.lastGuessRank", {
                    word: lastGuess.word,
                    rank: lastGuess.rank,
                  })}
                >
                  <strong>{lastGuess.word}</strong>
                  <b>{lastGuess.rank.toLocaleString()}</b>
                </div>
              )
            )}
          </div>
        )}
        {state.status === "ended" && state.secret && <Secret word={state.secret} />}
        <ol className="contexto-own-list" tabIndex={0} aria-label={t("board.contexto.rankedHistory")}>
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
            <li className="contexto-empty">{t("board.contexto.tryBroadWord")}</li>
          )}
        </ol>
      </section>
      <section className="contexto-rivals" aria-label={t("board.contexto.rivals")}>
        <header className="contexto-rivals-head">
          <h2>{t("board.contexto.rivals")}</h2>
          <span>{t("board.contexto.ranksOnly")}</span>
        </header>
        <div
          className="contexto-rival-grid"
          data-player-count={opponents.length}
          tabIndex={0}
          aria-label={t("board.contexto.standings")}
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
                    <ol
                      aria-label={t("board.contexto.bestRanks", {
                        player: player.name ?? player.codename ?? t("common.player"),
                      })}
                    >
                      <AnimatePresence initial={false}>
                        {entry!.guesses.map((guess) => (
                          <RankRow key={`r${guess.rank}`} guess={guess} masked />
                        ))}
                      </AnimatePresence>
                    </ol>
                  ) : (
                    <p className="contexto-empty">{t("board.contexto.noRankedGuesses")}</p>
                  )}
                </article>
              );
            })
          ) : (
            <div className="contexto-waiting">
              <strong>{t("board.contexto.youHaveRoom")}</strong>
              <span>{t("board.contexto.inviteMore")}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
