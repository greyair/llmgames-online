import { describe, expect, it } from "vitest";
import { GAME_OPTIONS, gameOptionsFor } from "@llmgames/game-catalog";

import { en } from "../../src/i18n/locales/en";
import { zhCN } from "../../src/i18n/locales/zh-CN";

/**
 * C2 option copy.
 *
 * `GAME_OPTIONS` carries translation keys as plain strings because the shared
 * catalog cannot depend on the web i18n table. This test is what makes the
 * lookup in `game-ui/gameOptions.ts` safe: every key it may read exists in both
 * shipped locales.
 */

const specs = Object.values(GAME_OPTIONS).flatMap((entries) => entries ?? []);

/** Both tables as plain lookups, so a key check needs no assertion. */
const english: Record<string, string> = en;

const chinese: Record<string, string> = zhCN;

describe("game option copy", () => {
  it("declares at least one option", () => {
    expect(specs.length).toBeGreaterThan(0);
  });

  it("has an English label for every option and choice", () => {
    for (const spec of specs) {
      expect(english[spec.labelKey]).toBeTruthy();

      for (const choice of spec.choices) expect(english[choice.labelKey]).toBeTruthy();
    }
  });

  it("has a Chinese label for every option and choice", () => {
    for (const spec of specs) {
      expect(chinese[spec.labelKey]).toBeTruthy();

      for (const choice of spec.choices) expect(chinese[choice.labelKey]).toBeTruthy();
    }
  });

  it("labels every choice differently from its raw value", () => {
    // A label that equals the value would silently render as "9" or "56", which
    // reads like an internal code rather than a rule.
    for (const spec of specs)
      for (const choice of spec.choices) expect(english[choice.labelKey]).not.toBe(choice.value);
  });

  it("offers options only for games that exist in the catalog", () => {
    for (const gameType of Object.keys(GAME_OPTIONS))
      expect(gameOptionsFor(gameType).length).toBeGreaterThan(0);
  });
});
