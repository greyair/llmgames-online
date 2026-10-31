import {
  compactAgentDecisionState,
  stringValue,
  type AgentDecisionFields,
  type ProjectionPart,
} from "@llmgames/game-catalog";

import { gamePluginFor } from "./registry";

/** A game that declares no decision fields still gets the platform frame. */
const noGameFields: AgentDecisionFields = () => ({});

/**
 * Compact an agent view for the model.
 *
 * The game is read from the view's own `type`, so every caller — the room, the
 * MCP layer and the documentation export — compacts the same way without
 * threading a plugin through. A view from a game without a plugin still gets
 * the platform frame rather than an error.
 */
export function compactState(view: ProjectionPart | null) {
  const type = stringValue(view?.type);
  const fields = (type ? gamePluginFor(type)?.agentDecision : undefined) ?? noGameFields;

  return compactAgentDecisionState(view, fields);
}
