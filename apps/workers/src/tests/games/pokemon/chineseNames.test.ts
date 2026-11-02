import { Dex } from "@pkmn/sim";
import { describe, expect, it } from "vitest";

import {
  MOVES,
  SPECIES,
} from "../../../../../web/src/game-ui/pokemon/pokemonZhData";

/**
 * 名词表必须覆盖模拟器实际会发出来的每一条名字。
 *
 * 前端的翻译只在英文名查得到时生效，漏一条的后果不是报错，而是中文对局里
 * 突然蹦出一个「Pikachu」。所以这里不信人工清点，直接拿 `@pkmn/sim` 的
 * 第一世代图鉴对表：模拟器加一条，这张表就得跟着加一条。
 */

const gen = Dex.forGen(1);

const species = gen.species.all().filter((entry) => !entry.isNonstandard);

const moves = gen.moves.all().filter((entry) => !entry.isNonstandard);

const CJK = /[\u4e00-\u9fff]/;

const speciesIds = new Set(SPECIES.map(([id]) => id));

const moveRows = new Map(MOVES.map((row) => [row[0], row]));

describe("宝可梦中文化词条覆盖第一世代图鉴", () => {
  it("151 只宝可梦全部有条目", () => {
    const missing = species.filter((entry) => !speciesIds.has(entry.id)).map((entry) => entry.id);

    expect(missing).toEqual([]);
    expect(SPECIES).toHaveLength(species.length);
  });

  it("165 个招式全部有条目与中文说明", () => {
    const missing = moves.filter((entry) => !moveRows.has(entry.id)).map((entry) => entry.id);

    expect(missing).toEqual([]);
    expect(MOVES).toHaveLength(moves.length);

    for (const [id, english, chinese, description] of MOVES) {
      expect(chinese, `${id} name`).toMatch(CJK);
      expect(description.trim(), `${id} description`).not.toBe("");
      expect(description, `${id} description`).toMatch(CJK);
      expect(english.trim(), `${id} english`).not.toBe("");
    }
  });

  it("没有重复的译名占位或空条目", () => {
    const families = new Set(SPECIES.map(([, english, chinese]) => `${english}=${chinese}`));

    expect(families.size).toBe(SPECIES.length);
    expect(new Set(SPECIES.map(([, , chinese]) => chinese)).size).toBe(SPECIES.length);
  });
});
