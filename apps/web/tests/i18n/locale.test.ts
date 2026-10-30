import { describe, expect, it } from "vitest";
import { ROOM_ERROR_CODES } from "@llmgames/game-catalog";
import { en, zhCN } from "@/i18n";
import { interpolate, localeFromLanguages, translate } from "@/i18n/core";
import { ERROR_MESSAGE_KEYS, isRoomErrorCode } from "@/i18n/errorMessages";
import { rules } from "@/interface/gameRules";
import { rulesZhCN } from "@/interface/gameRules.zh-CN";

const PLACEHOLDER = /\{(\w+)\}/g;

const placeholders = (text: string) =>
  [...text.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();

describe("locale resolution", () => {
  it("maps any Chinese tag to the shipped Chinese locale", () => {
    expect(localeFromLanguages(["zh"])).toBe("zh-CN");
    expect(localeFromLanguages(["zh-CN"])).toBe("zh-CN");
    expect(localeFromLanguages(["zh-Hans-CN"])).toBe("zh-CN");
    // Traditional Chinese is not shipped, so it reads Simplified rather than English.
    expect(localeFromLanguages(["zh-TW"])).toBe("zh-CN");
  });

  it("keeps English for English browsers", () => {
    expect(localeFromLanguages(["en"])).toBe("en");
    expect(localeFromLanguages(["en-GB", "zh-CN"])).toBe("en");
  });

  it("falls back to English for anything else", () => {
    expect(localeFromLanguages(["de-DE"])).toBe("en");
    expect(localeFromLanguages([])).toBe("en");
    expect(localeFromLanguages(["", "fr"])).toBe("en");
  });
});

describe("translation table", () => {
  it("provides a Chinese rule for each English rule in every game", () => {
    // SAFETY: Object.keys returns the keys of the rules object supplied here.
    for (const game of Object.keys(rules) as (keyof typeof rules)[]) {
      expect(rulesZhCN[game], game).toHaveLength(rules[game].length);
      expect(rulesZhCN[game].every((rule) => rule.trim().length > 0), game).toBe(true);
    }
  });
  it("covers every key in both languages", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no empty strings", () => {
    for (const [key, value] of Object.entries({ ...en, ...zhCN }))
      expect(value.trim(), key).not.toBe("");
  });

  it("uses the same placeholders in both languages", () => {
    // A key that interpolates `{game}` in English must do the same in Chinese, or
    // the value silently disappears from the copy.
    // SAFETY: Object.keys returns exactly the keys of the table it was given.
    const keys = Object.keys(en) as (keyof typeof en)[];

    for (const key of keys)
      expect(placeholders(zhCN[key]), key).toEqual(placeholders(en[key]));
  });
});

describe("socket error codes", () => {
  it("has distinct localized copy for every code the server can send", () => {
    for (const code of ROOM_ERROR_CODES) {
      const key = ERROR_MESSAGE_KEYS[code];
      const english = translate("en", key).trim();
      const chinese = translate("zh-CN", key).trim();

      expect(english, code).not.toBe("");
      expect(chinese, code).not.toBe("");
      // Equal values would mean the Chinese table silently kept the English string.
      expect(chinese, code).not.toBe(english);
    }
  });

  it("recognizes only codes from the shared vocabulary", () => {
    expect(isRoomErrorCode("NOT_YOUR_TURN")).toBe(true);
    expect(isRoomErrorCode("not_your_turn")).toBe(false);
    expect(isRoomErrorCode("")).toBe(false);
  });
});

describe("interpolation", () => {
  it("replaces every occurrence of a placeholder", () => {
    expect(interpolate("{n} of {n}", { n: 3 })).toBe("3 of 3");
  });

  it("leaves unknown placeholders visible", () => {
    expect(interpolate("{count} players", {})).toBe("{count} players");
  });

  it("keeps the English fallback when a locale table lacks the value", () => {
    expect(translate("en", "room.create")).toBe("Create room");
    expect(translate("zh-CN", "room.create")).toBe("创建房间");
  });

  it("fills game copy through the shared namespace", () => {
    expect(translate("zh-CN", "common.playGame", { game: "Connect 4" })).toBe("开始Connect 4");
  });
});
