import { GAME_MANIFESTS, KNOWN_GAME_TYPES, gameManifest } from "@llmgames/game-catalog";

import { describe, expect, it } from "vitest";

import { en } from "../../src/i18n/locales/en";
import { zhCN } from "../../src/i18n/locales/zh-CN";
import { gameMessage, type GameField } from "../../src/i18n/core";
import { gameCatalog, getGame, visibleGames } from "../../src/interface/catalog";

const FIELDS: readonly GameField[] = ["title", "category", "detail", "hook", "hint"];

/**
 * Every game is described once, in `GAME_MANIFESTS`. These assertions make that
 * promise safe: the tables cannot drift from the catalog, and a game shipped
 * without its `game.<id>.*` copy fails here instead of rendering a raw key.
 */
describe("game manifests", () => {
  it("declares exactly the public game ids, once each", () => {
    expect(Object.keys(GAME_MANIFESTS).sort()).toEqual([...KNOWN_GAME_TYPES].sort());

    for (const id of KNOWN_GAME_TYPES) {
      expect(GAME_MANIFESTS[id].id).toBe(id);
      expect(GAME_MANIFESTS[id].i18n.game).toBe(`game.${id}`);
      expect(gameManifest(id)).toEqual(GAME_MANIFESTS[id]);
    }

    expect(gameManifest("not-a-game")).toBeNull();
  });

  it("keeps the library order, the derived catalog and the route lookup in sync", () => {
    expect(gameCatalog.map((game) => game.id)).toEqual([
      "connect4",
      "checkers",
      "reversi",
      "pokemon",
      "codenames",
      "poker",
      "battleship",
      "contexto",
    ]);
    expect(visibleGames.every((game) => GAME_MANIFESTS[game.id] === game)).toBe(true);
    expect(getGame("connect-4")?.id).toBe("connect4");
    expect(getGame("unknown")).toBeUndefined();
  });

  it.each(KNOWN_GAME_TYPES)("ships English and Chinese copy for %s", (id) => {
    for (const field of FIELDS) {
      const key = gameMessage(id, field);

      expect(en[key]).toBeTruthy();
      expect(zhCN[key]).toBeTruthy();
    }
  });
});
