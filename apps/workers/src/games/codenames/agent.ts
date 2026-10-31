import {
  agentFields,
  projectionPart,
  type ProjectionPart,
  type WireObject,
} from "@llmgames/game-catalog";
import { z } from "zod";

/**
 * A card past the vocabulary cap is dropped rather than truncated, so the model
 * sees one fewer word instead of a mangled one.
 */
const board = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const card = projectionPart(entry);

      if (!card) return [];

      return [[card.index, card.word, card.revealed, card.affiliation ?? null]];
    }),
  ).parse;

/**
 * Codenames ships the board as `[index, word, revealed, affiliation]` tuples:
 * four values per card instead of an object with four keys, which is most of
 * the token cost on the largest board in the catalog.
 */
export function codenamesAgentDecision(view: ProjectionPart): WireObject {
  const state = view;
  const you = projectionPart(state.you);
  const clue = projectionPart(state.clue);

  return agentFields({
    yourTeam: you?.team,
    yourRole: you?.role,
    activeTeam: state.activeTeam,
    cardFormat: ["index", "word", "revealed", "affiliation_or_null"],
    cards: board(state.board),
    clue: clue ? agentFields({ word: clue.word, count: clue.count }) : null,
    guessesRemaining: state.guessesRemaining,
    guessesMade: state.guessesMade,
    remaining: state.remaining,
    lastReveal: state.lastReveal,
    winnerTeam: state.winnerTeam ?? state.winner,
  });
}
