export {
  LOCALES,
  detectLocale,
  gameMessage,
  interpolate,
  isLocale,
  localeFromLanguages,
  setLocale,
  shipMessage,
  translate,
  useLocale,
  useT,
} from "./core";

export type { GameField, Locale, MessageKey, Translate } from "./core";

export { BilingualText } from "./BilingualText";

export { en } from "./locales/en";

export { zhCN } from "./locales/zh-CN";
