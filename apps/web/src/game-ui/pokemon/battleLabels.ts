import { knownValue } from "@/domain/view-contracts";
import type { MessageKey, Translate } from "@/i18n";

const statKeys = {
  atk: "board.pokemon.statAttack",
  def: "board.pokemon.statDefense",
  spa: "board.pokemon.statSpecial",
  spd: "board.pokemon.statSpecial",
  spc: "board.pokemon.statSpecial",
  spe: "board.pokemon.statSpeed",
  accuracy: "board.pokemon.statAccuracy",
  evasion: "board.pokemon.statEvasion",
} satisfies Record<string, MessageKey>;

export const statLabel = (stat: string, t: Translate) => {
  const key = knownValue(statKeys, stat);

  return key ? t(key) : stat;
};

const statusKeys = {
  par: "board.pokemon.statusParalyzed",
  brn: "board.pokemon.statusBurned",
  psn: "board.pokemon.statusPoisoned",
  tox: "board.pokemon.statusBadlyPoisoned",
  slp: "board.pokemon.statusAsleep",
  frz: "board.pokemon.statusFrozen",
  fnt: "board.pokemon.statusFainted",
} satisfies Record<string, MessageKey>;

export const statusLabel = (status: string, t: Translate) => {
  const key = knownValue(statusKeys, status);

  return key ? t(key) : status;
};

const effectKeys = {
  substitute: "board.pokemon.effectSubstitute",
  confusion: "board.pokemon.effectConfusion",
  reflect: "board.pokemon.effectReflect",
  lightscreen: "board.pokemon.effectLightScreen",
  leechseed: "board.pokemon.effectLeechSeed",
  focusenergy: "board.pokemon.effectFocusEnergy",
  mist: "board.pokemon.effectMist",
  bide: "board.pokemon.effectBide",
  rage: "board.pokemon.effectRage",
  disable: "board.pokemon.effectDisable",
} satisfies Record<string, MessageKey>;

const normalizeEffect = (effect: string) =>
  effect.replace(/^move: /, "").toLowerCase().replaceAll(" ", "");

export const effectLabel = (effect: string, t: Translate) => {
  const key = knownValue(effectKeys, normalizeEffect(effect));

  return key ? t(key) : effect.replace(/^move: /, "");
};

const effectNoteKeys = {
  substitute: "board.pokemon.effectSubstituteNote",
  confusion: "board.pokemon.effectConfusionNote",
  reflect: "board.pokemon.effectReflectNote",
  lightscreen: "board.pokemon.effectLightScreenNote",
  leechseed: "board.pokemon.effectLeechSeedNote",
  focusenergy: "board.pokemon.effectFocusEnergyNote",
  mist: "board.pokemon.effectMistNote",
  bide: "board.pokemon.effectBideNote",
  rage: "board.pokemon.effectRageNote",
  disable: "board.pokemon.effectDisableNote",
} satisfies Record<string, MessageKey>;

export const effectNote = (effect: string, t: Translate): string | null => {
  const key = knownValue(effectNoteKeys, normalizeEffect(effect));

  return key ? t(key) : null;
};
