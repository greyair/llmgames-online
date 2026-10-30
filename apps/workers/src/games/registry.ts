import type { GameTypeId } from "@llmgames/game-catalog";

import type { BaseGameState } from "../durable-objects/types";
import type { GamePlugin } from "./contract";
import { connect4Plugin } from "./connect4/plugin";

/**
 * Static game registry (M3).
 *
 * Registration is explicit so the compiler and the tests can see every game.
 * There is no dynamic loading, no third-party code and no per-game MCP tool:
 * a plugin only supplies rules, its id and the fields it projects.
 *
 * A game without a plugin here is a legacy room that still runs its own
 * `BaseGameRoom` subclass. Migrating one game at a time is expected; the
 * registry never needs to be complete for the platform to work.
 */
type ProductionGamePlugin = GamePlugin<BaseGameState, GameTypeId>;

/** Every game that runs through the shared rule contract. */
const PRODUCTION_PLUGINS: readonly ProductionGamePlugin[] = [connect4Plugin];

const pluginsById = new Map<string, GamePlugin<BaseGameState, string>>();

for (const plugin of PRODUCTION_PLUGINS) {
  if (pluginsById.has(plugin.id)) throw new Error(`Duplicate game plugin id: ${plugin.id}`);

  pluginsById.set(plugin.id, plugin);
}

/** Rule module for a public game id, or null while that room is still legacy. */
export function gamePluginFor(gameType: string): GamePlugin<BaseGameState, string> | null {
  return pluginsById.get(gameType) ?? null;
}

/** Ids that already run through the shared contract, for coverage tests and docs. */
export function registeredGamePluginIds(): readonly string[] {
  return [...pluginsById.keys()];
}
