import { describe, expect, it } from "vitest";

import { translate } from "../../src/i18n";
import { logLine } from "../../src/game-ui/pokemon/BattleLog";
import {
  categoryName,
  cueTextFor,
  moveName,
  moveText,
  pokemonName,
  typeName,
} from "../../src/game-ui/pokemon/pokemonZh";

/**
 * 宝可梦的界面中文化。
 *
 * 协议层保持英文（MCP 的 Agent 读的就是这些字符串），浏览器按语言取值；
 * 这里钉住三件事：官方译名、英文名与 id 两条查询路径、未知词条的退回。
 */

const zh = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate("zh-CN", key, vars);

describe("宝可梦与招式的官方中文名", () => {
  it("用官方简体译名，而不是音译或旧译", () => {
    expect(pokemonName("Pikachu", "zh-CN")).toBe("皮卡丘");
    expect(pokemonName("Butterfree", "zh-CN")).toBe("巴大蝶");
    expect(pokemonName("Pidgeot", "zh-CN")).toBe("大比鸟");
    expect(pokemonName("Mr. Mime", "zh-CN")).toBe("魔墙人偶");
    expect(pokemonName("Porygon", "zh-CN")).toBe("多边兽");
    expect(pokemonName("Rhydon", "zh-CN")).toBe("钻角犀兽");
    expect(pokemonName("Farfetch’d", "zh-CN")).toBe("大葱鸭");
    expect(pokemonName("Nidoran-F", "zh-CN")).toBe("尼多兰");
    expect(pokemonName("Nidoran-M", "zh-CN")).toBe("尼多朗");
  });

  it("英文名与 id 查同一张表", () => {
    expect(pokemonName("pikachu", "zh-CN")).toBe("皮卡丘");
    expect(pokemonName("mrmime", "zh-CN")).toBe("魔墙人偶");
    expect(moveName("thunderbolt", "zh-CN")).toBe("十万伏特");
    expect(moveName("Thunderbolt", "zh-CN")).toBe("十万伏特");
  });

  it("招式用官方译名", () => {
    expect(moveName("Counter", "zh-CN")).toBe("双倍奉还");
    expect(moveName("Submission", "zh-CN")).toBe("地狱滚动");
    expect(moveName("Seismic Toss", "zh-CN")).toBe("地球上投");
    expect(moveName("Self-Destruct", "zh-CN")).toBe("自爆");
    expect(moveName("High Jump Kick", "zh-CN")).toBe("飞身踢");
    expect(moveName("Jump Kick", "zh-CN")).toBe("飞踢");
  });

  it("英文界面原样返回，不做任何替换", () => {
    expect(pokemonName("Pikachu", "en")).toBe("Pikachu");
    expect(moveName("Thunderbolt", "en")).toBe("Thunderbolt");
    expect(typeName("Electric", "en")).toBe("Electric");
  });

  it("未收录的名字退回原文，不显示空白", () => {
    expect(pokemonName("Missingno", "zh-CN")).toBe("Missingno");
    expect(moveName("Sketch", "zh-CN")).toBe("Sketch");
    expect(typeName("Stellar", "zh-CN")).toBe("Stellar");
    expect(pokemonName(undefined, "zh-CN")).toBe("");
  });
});

describe("招式说明与属性", () => {
  it("中文界面给出中文说明", () => {
    const text = moveText("Thunderbolt", "zh-CN");

    expect(text).toContain("麻痹");
    expect(text).not.toMatch(/chance|paralyze|target/);
  });

  it("英文界面保留服务端说明", () => {
    expect(moveText("Thunderbolt", "en", "10% chance to paralyze the target.")).toBe(
      "10% chance to paralyze the target.",
    );
  });

  it("说明跟着真实机制，写明第一世代的例外", () => {
    // Gen 1 的聚气实际会降低会心率，官方文本只写"提高"，这里必须点出来。
    expect(moveText("Focus Energy", "zh-CN")).toContain("第一世代");
  });

  it("属性与分类翻译成中文", () => {
    expect(typeName("Electric", "zh-CN")).toBe("电");
    expect(typeName("Psychic", "zh-CN")).toBe("超能力");
    expect(typeName("???", "zh-CN")).toBe("无属性");
    expect(categoryName("Physical", "zh-CN")).toBe("物理");
    expect(categoryName("Status", "zh-CN")).toBe("变化");
  });
});

describe("战斗日志与播报", () => {
  it("日志里的宝可梦名与招式名都变成中文", () => {
    const line = logLine("|move|p1a: Pikachu|Thunderbolt|p2a: Geodude", zh, "zh-CN");

    expect(line).toContain("皮卡丘");
    expect(line).toContain("十万伏特");
    expect(line).not.toContain("Pikachu");
    expect(line).not.toContain("Thunderbolt");
  });

  it("英文界面的日志保持英文", () => {
    const en = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
      translate("en", key, vars);

    const line = logLine("|move|p1a: Pikachu|Thunderbolt|p2a: Geodude", en, "en");

    expect(line).toContain("Pikachu");
    expect(line).toContain("Thunderbolt");
  });

  it("回放播报用中文句式", () => {
    const cue = cueTextFor(zh, "zh-CN");

    expect(cue.used("Pikachu", "Thunderbolt")).toContain("皮卡丘");
    expect(cue.used("Pikachu", "Thunderbolt")).toContain("十万伏特");
    expect(cue.fainted("Geodude")).toContain("小拳石");
    expect(cue.boost("def", "up", "2")).toContain("防御");
  });
});
