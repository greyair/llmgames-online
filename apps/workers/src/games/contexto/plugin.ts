import { ROOM_LIFETIME_MS, isString, isWireObject } from "@llmgames/game-catalog";

import { randomId, randomInt } from "../../lib/csprng";
import {
  CONTEXTO_TARGET_COUNT,
  CONTEXTO_VOCABULARY_SIZE,
  createContextoRanking,
  contextoGuessFamily,
  contextoRank,
  contextoTarget,
  normalizeContextoWord,
} from "../../lib/contextoRanks";
import type {
  ContextoGameState,
  ContextoGuess,
  ContextoPlayerProgress,
} from "../../durable-objects/types";
import type { GameActionResult, GameEffect, GameIntent, GamePlugin } from "../contract";
import { bestPlayer, emptyProgress, projectContexto, GUESS_LIMIT } from "./rules";

/**
 * Contexto as a game plugin (M3.7).
 *
 * Contexto has no turn order at all: every seat guesses whenever it likes, up
 * to fifty times, until someone finds the secret or everyone runs dry. That is
 * the first game where the platform's turn pointer stays `null` for the whole
 * match and "may I act?" is answered per seat rather than per turn.
 *
 * The dictionary rank table never leaves the server; other players' words are
 * masked down to ranks, and the secret is revealed only after the match ends.
 */

const DEFAULT_MATCH_MS = 15 * 60 * 1000;

const MAX_PLAYERS = 6;

function isGuessAction(actionType: string): boolean {
  return actionType === "guess_word" || actionType === "guess";
}

export const contextoPlugin: GamePlugin<ContextoGameState, "contexto"> = {
  id: "contexto",
  minPlayersToStart: 1,
  initialTurnPhase: "guessing",

  createInitialState(config, roomCode, now) {
    const gameTotalTime = config.gameTotalTime ?? DEFAULT_MATCH_MS;

    return {
      id: randomId(),
      roomCode,
      type: "contexto",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: Math.min(MAX_PLAYERS, Math.max(1, config.maxPlayers ?? MAX_PLAYERS)),
      // There is a single shared clock: the turn timer mirrors the match timer.
      timerConfig: { gameTotalTime, turnTime: gameTotalTime },
      gameTimeRemaining: gameTotalTime,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: gameTotalTime,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ROOM_LIFETIME_MS,
      secret: contextoTarget(0)!,
      rankTable: "",
      guessLimit: GUESS_LIMIT,
      vocabularySize: CONTEXTO_VOCABULARY_SIZE,
      progress: {},
      winner: null,
      totalGuesses: 0,
    };
  },

  start(state) {
    state.secret = contextoTarget(randomInt(CONTEXTO_TARGET_COUNT))!;
    state.rankTable = createContextoRanking(state.secret)!;
    state.progress = Object.fromEntries(
      state.players.map((player) => [player.id, emptyProgress(player.id)]),
    );
    state.winner = null;
    state.totalGuesses = 0;
    state.turnState.currentPlayerId = null;
    state.turnState.phase = "guessing";
    state.turnState.turnTimeRemaining = state.gameTimeRemaining;
  },

  /** Every seated player with guesses left may act at any time. */
  mayActNow(state, playerId) {
    if (state.status !== "playing") return false;

    const progress = state.progress[playerId];

    return Boolean(progress && !progress.exhausted && progress.guesses.length < GUESS_LIMIT);
  },

  turnActions(state, playerId) {
    if (state.status !== "playing") return [];

    const progress = state.progress[playerId];

    if (!progress || progress.exhausted) return [];

    return ["guess_word"];
  },

  /** Contexto exposes no seat or role: the platform's defaults are what it shipped with. */
  seatIdentity() {
    return {};
  },

  applyAction(state, playerId, intent: GameIntent, now): GameActionResult {
    if (!isGuessAction(intent.actionType))
      return { ok: false, message: `Unknown action: ${intent.actionType}` };

    if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

    const progress = state.progress[playerId];

    if (!progress) return { ok: false, message: "No player progress" };

    if (progress.exhausted || progress.guesses.length >= GUESS_LIMIT)
      return { ok: false, message: "You have used all 50 guesses" };

    if (!isWireObject(intent.data)) return { ok: false, message: "Word is required" };

    const raw = intent.data.word;

    if (!isString(raw)) return { ok: false, message: "Word is required" };

    const submittedWord = normalizeContextoWord(raw);

    if (!submittedWord) return { ok: false, message: "Use one English word with letters only" };

    const word = contextoGuessFamily(submittedWord);

    if (progress.guesses.some((guess) => guess.word === word))
      return { ok: false, message: "You already guessed that word or another form of it" };

    if (!state.rankTable) state.rankTable = createContextoRanking(state.secret)!;

    const rank = contextoRank(state.rankTable, word);

    if (rank === null) {
      // A word outside the shipped pool is bad input, not a rule violation: it
      // is rejected, but the attempt still lands in the state so every client
      // can show "not in pool" next to the guess box. The adapter persists this
      // rejection because `persist` is set.
      progress.lastAttempt = { submittedWord, status: "not_in_pool" };
      state.updatedAt = now;

      return { ok: false, message: "That word is not in this game's dictionary", persist: true };
    }

    state.totalGuesses += 1;

    const aliased = submittedWord !== word;

    progress.lastAttempt = {
      submittedWord,
      canonicalWord: word,
      status: aliased ? "aliased" : "ranked",
      rank,
    };

    const guess: ContextoGuess = { word, rank, sequence: state.totalGuesses };

    if (aliased) guess.submittedWord = submittedWord;

    progress.guesses.unshift(guess);
    progress.bestRank = progress.bestRank === null ? rank : Math.min(progress.bestRank, rank);
    progress.exhausted = progress.guesses.length >= GUESS_LIMIT;
    state.turnState.turnNumber = state.totalGuesses;

    const effects: GameEffect[] = [
      {
        type: "event",
        event: "guess_word",
        data: { playerId, rank, guessNumber: progress.guesses.length },
      },
    ];

    if (rank === 1) return { ok: true, effects: [...effects, ...finish(state, playerId, "secret_found")] };

    if (Object.values(state.progress).every((entry) => entry.exhausted))
      return { ok: true, effects: [...effects, ...finish(state, bestPlayer(state), "guess_limit")] };

    return { ok: true, effects };
  },

  /**
   * The shared clock expiring ends the match on the best rank so far.
   *
   * There is no per-turn decision to make here: the room keeps one clock, so a
   * turn timeout only restarts it.
   */
  onTurnTimeout(state) {
    state.turnState.turnTimeRemaining = state.gameTimeRemaining;
    state.turnState.startedAt = Date.now();

    return [];
  },

  onMatchTimeout(state) {
    state.winner = bestPlayer(state);
  },

  /** Others' words are masked down to ranks; the secret only appears at the end. */
  projectState(state, playerId) {
    return projectContexto(state, playerId);
  },

  /** The rewatch is the full public projection: every word, every rank. */
  rewatchView(state) {
    return projectContexto(state, "");
  },

  agentFields(projection) {
    return {
      guessLimit: projection.guessLimit,
      vocabularySize: projection.vocabularySize,
      totalGuesses: projection.totalGuesses,
      progress: projection.progress,
      secret: projection.secret,
    };
  },
};

/** Close the match: the platform stops the clocks, archives and broadcasts. */
function finish(state: ContextoGameState, winner: string, reason: string): GameEffect[] {
  state.winner = winner;
  state.status = "ended";
  state.turnState.phase = "ended";
  state.turnState.currentPlayerId = null;

  return [
    { type: "stop_timers" },
    { type: "event", event: "game_ended", data: { reason, winner } },
    { type: "match_ended", reason },
  ];
}

export type { ContextoPlayerProgress };
