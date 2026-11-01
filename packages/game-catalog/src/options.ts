import type { GameTypeId } from "./index.js";

/**
 * Per-game rule options (C2).
 *
 * A game may declare a small, fixed set of choices that change its rules —
 * board size, take-off dice, round limit. The browser lobby and the MCP
 * `room_create` tool both read this one table, so the two creation paths can
 * never drift into different meanings for the same key.
 *
 * Deliberately narrow: enumerations only. No JSON Schema, no conditional
 * options, no plugin-provided UI. A game that needs something richer needs a
 * design discussion first, not a schema dialect.
 */

export interface GameOptionChoice {
  /** Wire value; always a string so one shape covers numbers and labels. */
  value: string;
  /** Translation key for the choice label; the value is the fallback. */
  labelKey: string;
}

export interface GameOptionSpec {
  key: string;
  /** Used when the caller omits the key. Must be one of `choices`. */
  default: string;
  choices: readonly GameOptionChoice[];
  /** Translation key for the option's own label. */
  labelKey: string;
}

/**
 * Every game's declared options.
 *
 * A game not listed here accepts no options at all; passing one is an error
 * rather than a silent no-op, because a silently ignored rule change is the
 * worst possible outcome for a player who selected it.
 */
export const GAME_OPTIONS: Partial<Record<GameTypeId, readonly GameOptionSpec[]>> = {
  go: [
    {
      key: "size",
      default: "9",
      labelKey: "option.go.size",
      choices: [
        { value: "9", labelKey: "option.go.size.9" },
        { value: "13", labelKey: "option.go.size.13" },
        { value: "19", labelKey: "option.go.size.19" },
      ],
    },
  ],
  aeroplane: [
    {
      key: "takeoff",
      default: "6",
      labelKey: "option.aeroplane.takeoff",
      choices: [
        { value: "6", labelKey: "option.aeroplane.takeoff.6" },
        { value: "56", labelKey: "option.aeroplane.takeoff.56" },
      ],
    },
  ],
  monopoly: [
    {
      key: "rounds",
      default: "0",
      labelKey: "option.monopoly.rounds",
      choices: [
        { value: "20", labelKey: "option.monopoly.rounds.20" },
        { value: "40", labelKey: "option.monopoly.rounds.40" },
        { value: "0", labelKey: "option.monopoly.rounds.0" },
      ],
    },
  ],
};

/** Declared options for a game; empty for every game that has none. */
export function gameOptionsFor(gameType: string): readonly GameOptionSpec[] {
  // SAFETY: `hasOwn` proves the key is one of the declared GameTypeId entries,
  // and the table is typed with exactly that union.
  const specs = Object.hasOwn(GAME_OPTIONS, gameType)
    ? GAME_OPTIONS[gameType as GameTypeId]
    : undefined;

  return specs ?? [];
}

export type GameOptionsResult =
  | { ok: true; options: Record<string, string> }
  | { ok: false; error: string };

/**
 * Validate a creation request's options against one game's declaration.
 *
 * Every declared key is filled from the default, so a plugin can read a value
 * without repeating the fallback at each call site. Unknown keys and unknown
 * values are refused with a message a player can act on.
 */
export function resolveGameOptions(
  gameType: string,
  raw: Readonly<Record<string, string>> | undefined,
): GameOptionsResult {
  const specs = gameOptionsFor(gameType);
  const provided = raw ?? {};
  const declared = new Set(specs.map((spec) => spec.key));

  if (specs.length === 0) {
    const unexpected = Object.keys(provided).filter((key) => provided[key] !== undefined);

    if (unexpected.length > 0)
      return { ok: false, error: `${gameType} does not accept rule options` };

    return { ok: true, options: {} };
  }

  for (const key of Object.keys(provided)) {
    if (provided[key] === undefined) continue;

    if (!declared.has(key)) return { ok: false, error: `${gameType} has no option "${key}"` };
  }

  const options: Record<string, string> = {};

  for (const spec of specs) {
    const value = provided[spec.key] ?? spec.default;

    if (!spec.choices.some((choice) => choice.value === value))
      return {
        ok: false,
        error: `${spec.key} must be one of ${spec.choices.map((c) => c.value).join(", ")}`,
      };

    options[spec.key] = value;
  }

  return { ok: true, options };
}

/** Read one declared option from a resolved map, falling back to the default. */
export function gameOptionValue(
  gameType: string,
  options: Readonly<Record<string, string>> | undefined,
  key: string,
): string | null {
  const spec = gameOptionsFor(gameType).find((entry) => entry.key === key);

  if (!spec) return null;

  return options?.[key] ?? spec.default;
}

/** Integer form of a numeric option; `0` when the game does not declare it. */
export function gameOptionNumber(
  gameType: string,
  options: Readonly<Record<string, string>> | undefined,
  key: string,
): number {
  const value = gameOptionValue(gameType, options, key);

  if (value === null) return 0;

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}
