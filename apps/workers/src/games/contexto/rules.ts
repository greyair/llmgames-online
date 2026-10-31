import type { ContextoGameState, ContextoPlayerProgress } from "../../durable-objects/types";

/**
 * Shared Contexto rules: the guessing limit, per-seat progress and what each
 * viewer is allowed to read.
 *
 * Kept apart from the plugin so the projection can be reasoned about (and
 * tested) without dragging the state machine along.
 */

/** Official limit per seat for one match. */
export const GUESS_LIMIT = 50 as const;

export function emptyProgress(playerId: string): ContextoPlayerProgress {
  return { playerId, guesses: [], lastAttempt: null, bestRank: null, exhausted: false };
}

/** Closest guess wins; an equal best rank is a draw. */
export function bestPlayer(state: ContextoGameState): string {
  const ranked = Object.values(state.progress)
    .filter((entry) => entry.bestRank !== null)
    .sort((a, b) => a.bestRank! - b.bestRank!);

  if (!ranked[0] || ranked[0].bestRank === ranked[1]?.bestRank) return "draw";

  return ranked[0].playerId;
}

function maskedGuesses(entry: ContextoPlayerProgress) {
  return [...entry.guesses]
    .sort((a, b) => a.rank - b.rank || a.sequence - b.sequence)
    .map((guess) => ({ rank: guess.rank, masked: true }));
}

/**
 * Recipient-safe view.
 *
 * The rank table never leaves the server. Rivals' guesses are reduced to their
 * ranks unless the viewer is the empty id, which `BaseGameRoom` reserves for the
 * authorized public broadcast and for the archived rewatch.
 */
export function projectContexto(state: ContextoGameState, playerId: string) {
  const { rankTable: _rankTable, ...visibleState } = state;
  const ended = state.status === "ended";
  const publicBroadcast = playerId === "";

  const progress = Object.fromEntries(
    Object.entries(state.progress).map(([id, entry]) => {
      const own = id === playerId;

      const guesses = own || publicBroadcast ? entry.guesses : maskedGuesses(entry);

      return [
        id,
        {
          playerId: id,
          guesses,
          lastAttempt: own ? (entry.lastAttempt ?? null) : undefined,
          guessCount: entry.guesses.length,
          guessesRemaining: Math.max(0, GUESS_LIMIT - entry.guesses.length),
          bestRank: entry.bestRank,
          exhausted: entry.exhausted,
        },
      ];
    }),
  );

  return {
    ...visibleState,
    secret: ended ? state.secret : undefined,
    progress,
  };
}
