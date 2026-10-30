import {
  GAME_MANIFESTS,
  gameRouteSlug,
  isGameEnabled,
  normalizeGameType,
} from "@llmgames/game-catalog";

/**
 * Library display order.
 *
 * Metadata lives in the shared manifest table (`GAME_MANIFESTS`), so a game is
 * described once. Only the presentation order is a web concern: it is sorted
 * by hand so the library reads well instead of following registration order.
 */
const LIBRARY_ORDER = [
  "connect4",
  "checkers",
  "reversi",
  "pokemon",
  "codenames",
  "poker",
  "battleship",
  "contexto",
] as const;

export const gameCatalog = LIBRARY_ORDER.map((id) => GAME_MANIFESTS[id]);

export const visibleGames = gameCatalog.filter((game) => isGameEnabled(game.id));

export const getGame = (id?: string) =>
  gameCatalog.find((game) => game.id === normalizeGameType(id ?? ""));

export const gameRoute = (id: string) => `/${gameRouteSlug(id)}`;
