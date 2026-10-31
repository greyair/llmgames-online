import { agentFields, type ProjectionPart, type WireObject } from "@llmgames/game-catalog";

/**
 * A Pokémon seat never needs its rival's team, exact HP or pending choice, and
 * the projection already masked them. What it does need is the decision it owes
 * and enough battle log to read the last exchange.
 */
export function pokemonAgentDecision(view: ProjectionPart): WireObject {
  const state = view;

  return agentFields({
    format: state.format,
    yourSeat: state.yourSeat,
    sides: state.sides,
    decision: state.decision,
    battleLog: state.battleLog,
    winner: state.winnerSeat,
  });
}
