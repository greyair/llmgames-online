import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Dex } from "@pkmn/sim";
import { describe, expect, it } from "vitest";

/**
 * 宝可梦形象文件的覆盖检查。
 *
 * 形象是三方素材，按仓库约定不进版本库，用 `pnpm assets:pokemon` 拉到
 * `apps/web/public/pokemon/`。所以没有下载过素材的机器上这组用例会跳过；
 * 一旦本地有素材，它就要保证 151 只 × 5 套图一张不缺——破图不会报错，
 * 只会在对局里留一个空白框。
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../../../web/public/pokemon");

const downloaded = existsSync(join(root, "gen1"));

const sets = [
  ["gen1", "png"],
  ["full-back", "png"],
  ["gen1-back", "png"],
  ["gen5ani", "gif"],
  ["gen5ani-back", "gif"],
] as const;

const species = Dex.forGen(1)
  .species.all()
  .filter((entry) => !entry.isNonstandard);

describe.skipIf(!downloaded)("宝可梦形象文件", () => {
  it("每只宝可梦在每一套图里都有文件", () => {
    const missing: string[] = [];

    for (const [directory, extension] of sets)
      for (const entry of species) {
        const file = join(root, directory, `${entry.id}.${extension}`);

        if (!existsSync(file) || statSync(file).size === 0) missing.push(`${directory}/${entry.id}`);
      }

    expect(missing).toEqual([]);
  });

  it("文件名与界面使用的精灵 id 规则一致", () => {
    // 前端把 `mon.sprite` 归一成「小写字母数字」，所以 id 里若出现连字符，
    // 界面会去找一个不存在的文件。第一世代目前全部是纯字母数字。
    for (const entry of species) expect(entry.id).toMatch(/^[a-z0-9]+$/);
  });
});
