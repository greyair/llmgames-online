import {
  isNumber,
  isString,
  isWireObject,
  type WireObject,
  type WireValue,
} from "@llmgames/game-catalog";

import type {
  CodenamesCard,
  CodenamesGameState,
  CodenamesTeam,
} from "../../durable-objects/types";
import type { GameActionResult, GameEffect, GameIntent } from "../contract";
import {
  appendActivity,
  otherCodenamesTeam,
  spymasterFor,
} from "./rules";

/**
 * Codenames clues, guesses and turn transitions (M3.6).
 *
 * Everything here mutates the state it is given and returns effects; timers,
 * persistence and broadcasts stay platform work. Lobby role assignment is not in
 * this file on purpose — promoting a spectator is a seat change, which the design
 * keeps in the platform layer.
 */

/** Start a fresh turn timer for the team that is now on the clock. */
function resetTurnTimer(state: CodenamesGameState, now: number): void {
  state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
  state.turnState.startedAt = now;
}

/** What the client can call in the current phase, without lobby actions. */
export function playActions(state: CodenamesGameState, playerId: string): string[] {
  if (state.status !== "playing") return [];

  const assignment = state.assignments[playerId];

  if (!assignment || assignment.team !== state.activeTeam) return [];

  if (state.turnState.phase === "clue")
    return assignment.role === "spymaster" ? ["give_clue"] : [];

  if (state.turnState.phase !== "guess" || assignment.role !== "operative") return [];

  return state.guessesMade > 0 ? ["guess_word", "end_turn"] : ["guess_word"];
}

function advanceTeam(
  state: CodenamesGameState,
  reason: "stopped" | "timeout" | "wrong_guess" | "guess_limit",
  playerId: string | null,
  now: number,
): GameEffect[] {
  appendActivity(state, { type: "turn_end", team: state.activeTeam, playerId, reason }, now);

  state.activeTeam = otherCodenamesTeam(state.activeTeam);
  state.clue = null;
  state.guessesRemaining = 0;
  state.guessesMade = 0;
  state.turnState.phase = "clue";
  state.turnState.turnNumber++;
  state.turnState.currentPlayerId = spymasterFor(state, state.activeTeam)?.id ?? null;
  resetTurnTimer(state, now);

  return [
    {
      type: "event",
      event: "turn_changed",
      data: {
        currentPlayerId: state.turnState.currentPlayerId,
        turnNumber: state.turnState.turnNumber,
        phase: "clue",
        activeTeam: state.activeTeam,
      },
    },
  ];
}

/**
 * End the match.
 *
 * The activity reason is fixed text so the archive reads the same no matter which
 * card produced the win; the audit event keeps the precise cause.
 */
function finishGame(
  state: CodenamesGameState,
  winner: CodenamesTeam,
  reason: "assassin" | "all_agents_contacted",
  now: number,
): GameEffect[] {
  state.winner = winner;
  state.winnerTeam = winner;
  state.status = "ended";
  state.turnState.phase = "ended";
  state.turnState.currentPlayerId = null;
  appendActivity(
    state,
    { type: "game_end", team: winner, playerId: null, reason, winner },
    now,
  );

  return [
    { type: "stop_timers" },
    { type: "event", event: "game_ended", data: { reason, winner, remaining: state.remaining } },
    { type: "match_ended", reason },
  ];
}

function handleGiveClue(
  state: CodenamesGameState,
  playerId: string,
  data: WireValue,
  now: number,
): GameActionResult {
  if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

  const assignment = state.assignments[playerId];

  if (
    state.turnState.phase !== "clue" ||
    assignment?.team !== state.activeTeam ||
    assignment.role !== "spymaster"
  ) {
    return { ok: false, message: "Only the active team's spymaster can give a clue" };
  }

  if (!isWireObject(data)) return { ok: false, message: "Clue word and count are required" };

  const wordRaw = data.word;
  const countRaw = data.count;
  const word = isString(wordRaw) ? wordRaw.trim() : "";

  if (word.length < 1 || word.length > 40 || !/^[\p{L}\p{M}][\p{L}\p{M}'-]*$/u.test(word)) {
    return { ok: false, message: "Official clues must be a single word" };
  }

  const normalizedWord = word.toLocaleLowerCase();

  if (
    state.board.some(
      (card) => !card.revealed && card.word.toLocaleLowerCase() === normalizedWord,
    )
  ) {
    return { ok: false, message: "A visible codename cannot be used as the clue" };
  }

  const count =
    isString(countRaw) && countRaw.trim().toLocaleLowerCase() === "unlimited"
      ? "unlimited"
      : isNumber(countRaw) && Number.isInteger(countRaw) && countRaw >= 0 && countRaw <= 9
        ? countRaw
        : null;

  if (count === null) return { ok: false, message: "Clue count must be 0–9 or unlimited" };

  state.clue = { word, count, givenBy: playerId, at: now };
  state.guessesMade = 0;
  state.guessesRemaining = count === 0 || count === "unlimited" ? null : count + 1;
  state.turnState.phase = "guess";
  // Guessing belongs to the active operative group, not one representative
  // player. `mayActNow` and the legal actions wake every operative on the team.
  state.turnState.currentPlayerId = null;
  resetTurnTimer(state, now);
  appendActivity(state, { type: "clue", team: assignment.team, playerId, word, count }, now);

  return {
    ok: true,
    effects: [
      {
        type: "event",
        event: "clue_given",
        data: { playerId, team: assignment.team, word, count },
      },
    ],
  };
}

function pickCard(state: CodenamesGameState, data: WireObject): CodenamesCard | null {
  const indexRaw = data.index;
  const wordRaw = data.word;

  const card =
    isNumber(indexRaw) && Number.isInteger(indexRaw)
      ? state.board[indexRaw]
      : isString(wordRaw)
        ? state.board.find(
            (candidate) =>
              candidate.word.toLocaleLowerCase() === wordRaw.trim().toLocaleLowerCase(),
          )
        : undefined;

  return card ?? null;
}

function handleGuess(
  state: CodenamesGameState,
  playerId: string,
  data: WireValue,
  now: number,
): GameActionResult {
  if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

  const assignment = state.assignments[playerId];

  if (
    state.turnState.phase !== "guess" ||
    assignment?.team !== state.activeTeam ||
    assignment.role !== "operative"
  ) {
    return { ok: false, message: "Only an operative on the active team can guess" };
  }

  if (!isWireObject(data)) return { ok: false, message: "Guess index or word is required" };

  const card = pickCard(state, data);

  if (!card) return { ok: false, message: "Choose a board index 0–24 or an exact visible word" };

  if (card.revealed) return { ok: false, message: "That codename is already revealed" };

  card.revealed = true;
  card.revealedBy = playerId;
  state.guessesMade++;
  state.lastReveal = {
    index: card.index,
    word: card.word,
    affiliation: card.affiliation,
    playerId,
  };
  appendActivity(
    state,
    { type: "guess", team: assignment.team, playerId, word: card.word, affiliation: card.affiliation },
    now,
  );

  if (card.affiliation === "red" || card.affiliation === "blue") {
    state.remaining[card.affiliation] = Math.max(0, state.remaining[card.affiliation] - 1);
  }

  const effects: GameEffect[] = [
    {
      type: "event",
      event: "word_guessed",
      data: {
        playerId,
        team: assignment.team,
        index: card.index,
        word: card.word,
        affiliation: card.affiliation,
      },
    },
  ];

  if (card.affiliation === "assassin")
    return {
      ok: true,
      effects: [...effects, ...finishGame(state, otherCodenamesTeam(assignment.team), "assassin", now)],
    };

  if (
    (card.affiliation === "red" || card.affiliation === "blue") &&
    state.remaining[card.affiliation] === 0
  )
    return {
      ok: true,
      effects: [
        ...effects,
        ...finishGame(state, card.affiliation, "all_agents_contacted", now),
      ],
    };

  if (card.affiliation !== assignment.team)
    return { ok: true, effects: [...effects, ...advanceTeam(state, "wrong_guess", null, now)] };

  if (state.guessesRemaining !== null) {
    state.guessesRemaining--;

    if (state.guessesRemaining <= 0)
      return { ok: true, effects: [...effects, ...advanceTeam(state, "guess_limit", null, now)] };
  }

  // A correct guess does not restart the group decision clock. The configured
  // turn timer covers the entire operative phase, matching the catalog rule.
  return { ok: true, effects };
}

function handleEndTurn(
  state: CodenamesGameState,
  playerId: string,
  now: number,
): GameActionResult {
  if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

  const assignment = state.assignments[playerId];

  if (
    state.turnState.phase !== "guess" ||
    assignment?.team !== state.activeTeam ||
    assignment.role !== "operative"
  ) {
    return { ok: false, message: "Only an operative on the active team can end guessing" };
  }

  if (state.guessesMade < 1) {
    return { ok: false, message: "Official rules require at least one guess before stopping" };
  }

  return { ok: true, effects: advanceTeam(state, "stopped", playerId, now) };
}

/** Route one play intent to its handler; lobby actions are handled by the room. */
export function applyAction(
  state: CodenamesGameState,
  playerId: string,
  intent: GameIntent,
  now: number,
): GameActionResult {
  switch (intent.actionType) {
    case "give_clue":
      return handleGiveClue(state, playerId, intent.data, now);
    case "guess_word":
    case "guess":
      return handleGuess(state, playerId, intent.data, now);
    case "end_turn":
    case "stop_guessing":
      return handleEndTurn(state, playerId, now);
    default:
      return { ok: false, message: `Unknown action: ${intent.actionType}` };
  }
}

/** A turn ran out: the team loses the rest of its guesses and the turn passes. */
export function onTurnTimeout(
  state: CodenamesGameState,
  playerId: string | null,
  now: number,
): readonly GameEffect[] {
  if (state.status !== "playing") return [];

  return advanceTeam(state, "timeout", playerId, now);
}

/**
 * The overall clock ran out on an unfinished board.
 *
 * Official Codenames has no partial-board tiebreaker, so this is a draw. The
 * platform ends the room; this only records the result.
 */
export function onMatchTimeout(state: CodenamesGameState, now: number): void {
  state.winner = "draw";
  state.winnerTeam = null;
  appendActivity(
    state,
    { type: "game_end", team: null, playerId: null, reason: "game_timeout", winner: "draw" },
    now,
  );
  state.turnState.phase = "ended";
  state.turnState.currentPlayerId = null;
}
