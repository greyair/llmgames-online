import {
  agentFields,
  projectionPart,
  stringValue,
  type WireObject,
  type ProjectionPart,
} from "@llmgames/game-catalog";
import { z } from "zod";

const progressOf = z.record(z.string(), z.unknown()).catch({}).parse;

/**
 * Contexto hides the vocabulary size and the seat's own progress, and gives the
 * rivals only what the rules already reveal: their ranks, never their words
 * before the match ends. The answer itself appears only once nobody can use it.
 */
export function contextoAgentDecision(view: ProjectionPart): WireObject {
  const state = view;
  const playerId = stringValue(projectionPart(state.you)?.playerId);
  const progress = projectionPart(state.progress);

  return agentFields({
    guessLimit: state.guessLimit,
    vocabularySize: state.vocabularySize,
    totalGuesses: state.totalGuesses,
    yourProgress: progress && playerId ? projectionPart(progressOf(progress)[playerId]) : undefined,
    rivalProgress: progress
      ? Object.values(progress).filter((entry) => projectionPart(entry)?.playerId !== playerId)
      : [],
    secret: state.status === "ended" ? state.secret : undefined,
    winner: state.winner,
  });
}
