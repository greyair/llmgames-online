import type { GameOptionSpec } from "@llmgames/game-catalog";

import { type MessageKey, type Translate } from "@/i18n";

/**
 * Option copy (C2).
 *
 * `GAME_OPTIONS` lives in the shared catalog, which cannot depend on the web
 * i18n table, so it carries translation keys as plain strings. `tests/game-ui/
 * gameOptions.test.ts` asserts every one of those keys exists in the English
 * table, which is what makes the assertion below safe.
 */

function label(t: Translate, key: string, fallback: string): string {
  // SAFETY: every GAME_OPTIONS labelKey is asserted against the shipped locale
  // tables by apps/web/tests/game-ui/gameOptions.test.ts.
  const text = t(key as MessageKey);

  return text === key ? fallback : text;
}

/** The option's own heading, e.g. "Board size". */
export function optionTitle(t: Translate, spec: GameOptionSpec): string {
  return label(t, spec.labelKey, spec.key);
}

/** One choice's label, e.g. "13 × 13"; falls back to the raw wire value. */
export function optionChoiceLabel(t: Translate, spec: GameOptionSpec, value: string): string {
  const choice = spec.choices.find((entry) => entry.value === value);

  return choice ? label(t, choice.labelKey, value) : value;
}
