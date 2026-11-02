import type { CueText } from "@/features/pokemon/playback";
import type { Locale, Translate } from "@/i18n";
import { CATEGORIES, MOVES, SPECIES, TYPES, type MoveRow } from "./pokemonZhData";
import { statLabel, statusLabel } from "./battleLabels";

/**
 * 宝可梦专用名词表（第一世代）。
 *
 * 服务端把 Showdown 的英文名当作稳定标识：`pokemon.name`、`move.name`、
 * 招式说明、属性名全是英文。这些字符串同时被 MCP 的 Agent 读，所以协议层
 * 不动，只在浏览器渲染时按语言翻译。
 *
 * 译名口径：任天堂／宝可梦官方的简体中文译名（如「巴大蝶」「大比鸟」
 * 「魔墙人偶」「多边兽」），招式用官方招式名（「十万伏特」「双倍奉还」
 * 「地狱滚动」），说明按第一世代的真实机制撰写。
 */

export type PokemonLocale = Locale;

/**
 * 协议里的名字带空格、点、弯引号甚至性别后缀（`Nidoran-F`），id 只保留小写
 * 字母数字。统一按 id 索引，让「英文名」和「id」两条查询路径共用一张表。
 */
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const speciesByKey = new Map<string, string>();

for (const [id, english, chinese] of SPECIES) {
  speciesByKey.set(key(id), chinese);
  speciesByKey.set(key(english), chinese);
}

const movesByKey = new Map<string, MoveRow>();

for (const row of MOVES) {
  movesByKey.set(key(row[0]), row);
  movesByKey.set(key(row[1]), row);
}

const isChinese = (locale: PokemonLocale) => locale === "zh-CN";

/** 宝可梦名字；未收录时退回协议里的英文名，绝不显示空白。 */
export function pokemonName(value: string | undefined | null, locale: PokemonLocale): string {
  const raw = (value ?? "").trim();

  if (!raw || !isChinese(locale)) return raw;

  return speciesByKey.get(key(raw)) ?? raw;
}

/** 招式名；`value` 可以传 id 或英文名。 */
export function moveName(value: string | undefined | null, locale: PokemonLocale): string {
  const raw = (value ?? "").trim();

  if (!raw || !isChinese(locale)) return raw;

  return movesByKey.get(key(raw))?.[2] ?? raw;
}

/**
 * 招式说明。服务端给的是 Showdown 的英文说明，中文界面用本地词条；
 * 未收录的招式退回英文，避免出现「招式名中文、说明空白」的半截状态。
 */
export function moveText(
  value: string | undefined | null,
  locale: PokemonLocale,
  fallback?: string | null,
): string {
  const raw = (value ?? "").trim();

  if (!isChinese(locale)) return fallback?.trim() || raw;

  return movesByKey.get(key(raw))?.[3] ?? fallback?.trim() ?? raw;
}

/** 属性名（一般／火／水……）。 */
export function typeName(type: string | undefined | null, locale: PokemonLocale): string {
  const raw = (type ?? "").trim();

  if (!raw || !isChinese(locale)) return raw;

  // SAFETY: `hasOwn` proves the key is one of the declared types, and the table
  // is inferred from exactly those entries.
  return Object.hasOwn(TYPES, raw) ? TYPES[raw as keyof typeof TYPES] : raw;
}

/** 招式分类（物理／特殊／变化）。 */
export function categoryName(category: string | undefined | null, locale: PokemonLocale): string {
  const raw = (category ?? "").trim();

  if (!raw || !isChinese(locale)) return raw;

  // SAFETY: same invariant as `typeName` — the key was checked with `hasOwn`.
  return Object.hasOwn(CATEGORIES, raw) ? CATEGORIES[raw as keyof typeof CATEGORIES] : raw;
}

/** 词条覆盖率，供测试断言 151 只与 165 个招式全部收录。 */
export const POKEMON_ZH_COVERAGE = {
  species: speciesByKey.size / 2,
  moves: movesByKey.size / 2,
};

/**
 * Banner sentences for the playback animation.
 *
 * Reuses the battle-log keys so a move reads the same in the banner and in the
 * log; only the two interpolated names need translating.
 */
export function cueTextFor(t: Translate, locale: PokemonLocale): CueText {
  return {
    preparing: (name, move) =>
      t("board.pokemon.cuePrepare", { name: pokemonName(name, locale), move: moveName(move, locale) }),
    used: (name, move) =>
      t("board.pokemon.logMove", { name: pokemonName(name, locale), move: moveName(move, locale) }),
    enter: (name) => t("board.pokemon.logEnter", { name: pokemonName(name, locale) }),
    healed: (name) => t("board.pokemon.logHeal", { name: pokemonName(name, locale) }),
    fainted: (name) => t("board.pokemon.logFaint", { name: pokemonName(name, locale) }),
    status: (name, status) =>
      t("board.pokemon.logStatus", {
        name: pokemonName(name, locale),
        status: statusLabel(status, t),
      }),
    cured: (name) => t("board.pokemon.logCureStatus", { name: pokemonName(name, locale) }),
    boost: (stat, direction, stages) =>
      t(direction === "up" ? "board.pokemon.cueBoost" : "board.pokemon.cueUnboost", {
        stat: statLabel(stat, t),
        count: stages,
      }),
    message: (kind) => {
      if (kind === "-crit") return t("board.pokemon.logCritical");

      if (kind === "-supereffective") return t("board.pokemon.logSuperEffective");

      if (kind === "-resisted") return t("board.pokemon.logResisted");

      if (kind === "-miss") return t("board.pokemon.cueMiss");

      if (kind === "-immune") return t("board.pokemon.cueImmune");

      return t("board.pokemon.logFail");
    },
  };
}

/**
 * 固定伤害说明。
 *
 * 服务端用英文描述这几种特殊伤害（「Half the target’s current HP」等），
 * 数字型固定伤害则是「40 HP」。两者都要说人话，所以在这里按句式翻译，
 * 未匹配的原文退回。
 */
export function damageLabel(damage: string | undefined, t: Translate): string | undefined {
  if (!damage) return undefined;

  if (damage === "Half the target’s current HP") return t("board.pokemon.damageHalf");

  if (damage === "Equal to the user’s level") return t("board.pokemon.damageLevel");

  const fixed = damage.match(/^(\d+) HP$/);

  return fixed ? t("board.pokemon.damageFixed", { hp: fixed[1] ?? "" }) : damage;
}
