import {
  GAME_MANIFESTS,
  gameRouteSlug,
  isGameEnabled,
  normalizeGameType,
} from "@llmgames/game-catalog";

import { gameMessage, type Translate } from "@/i18n";

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
  "gomoku",
  "aeroplane",
  "paodekuai",
  "doudizhu",
  "monopoly",
  "chess",
  "xiangqi",
  "go",
] as const;

export const gameCatalog = LIBRARY_ORDER.map((id) => GAME_MANIFESTS[id]);

export const visibleGames = gameCatalog.filter((game) => isGameEnabled(game.id));

export const getGame = (id?: string) =>
  gameCatalog.find((game) => game.id === normalizeGameType(id ?? ""));

/**
 * Localised game title.
 *
 * Match chrome, result cards and archives used to read the manifest's English
 * `title` directly, so a Chinese session still said "Battleship". The manifest
 * stays the fallback for an id that has no copy yet.
 */
export function gameTitle(t: Translate, id?: string): string {
  const gameId = normalizeGameType(id ?? "");
  const key = gameMessage(gameId, "title");
  const text = t(key);

  return text === key ? (getGame(gameId)?.title ?? gameId) : text;
}

export const gameRoute = (id: string) => `/${gameRouteSlug(id)}`;
