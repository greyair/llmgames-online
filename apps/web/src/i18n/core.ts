import { useCallback, useSyncExternalStore } from "react";
import { en, type MessageKey, type Messages } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

/** Locales the app ships. Adding one means a new table and a switch entry. */
export const LOCALES = ["en", "zh-CN"] as const;

export type Locale = (typeof LOCALES)[number];

const translations: Record<Locale, Messages> = { en, "zh-CN": zhCN };

/** Must match the key read by `public/locale-init.js`. */
const STORAGE_KEY = "llmgames-locale";

/** Cross-island channel: the site bar and page bodies are separate React roots. */
const LOCALE_EVENT = "llmgames:locale";

const SUPPORTED = new Set<string>(LOCALES);

/** True for the shipped locale tags only; anything else must fall back to English. */
export function isLocale(value: string | null | undefined): value is Locale {
  return value != null && SUPPORTED.has(value);
}

/**
 * BCP-47 tags to a supported locale. English is the fallback, so a visitor whose
 * language we do not ship sees exactly what they see today.
 */
export function localeFromLanguages(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const lower = tag.toLowerCase();

    if (lower === "zh" || lower.startsWith("zh-")) return "zh-CN";

    if (lower.startsWith("en")) return "en";
  }

  return "en";
}

function storedLocale(): Locale | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    return isLocale(saved) ? saved : null;
  } catch {
    // Private mode and blocked storage must not break the page.
    return null;
  }
}

/** Order: explicit choice, then browser languages, then English. */
export function detectLocale(): Locale {
  const saved = storedLocale();

  if (saved) return saved;

  if (typeof navigator === "undefined") return "en";

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];

  return localeFromLanguages(languages.filter(Boolean));
}

// Resolved once per module instance. On the server that is English, which is what
// the pre-rendered HTML contains; on the client it is the visitor's real choice.
let current: Locale = typeof window === "undefined" ? "en" : detectLocale();

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function syncDocument(locale: Locale) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;

  root.lang = locale;
  root.dataset.locale = locale;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function snapshot(): Locale {
  return current;
}

/** The pre-rendered HTML is English, so hydration must start from English. */
function serverSnapshot(): Locale {
  return "en";
}

// Every island has its own module instance in theory, so the switch is published
// on `window` and applied by whichever instances are listening.
if (typeof window !== "undefined") {
  window.addEventListener(LOCALE_EVENT, (event) => {
    // SAFETY: setLocale() is the only dispatcher of this event and always sends a
    // Locale, which the type on CustomEvent records.
    const next = (event as CustomEvent<Locale>).detail;

    if (next === current) return;

    current = next;
    syncDocument(next);
    notify();
  });

  // Start from the same value `locale-init.js` already applied to <html>.
  syncDocument(current);
}

/** Persist and broadcast a language choice. */
export function setLocale(next: Locale): void {
  if (next === current) return;

  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The switch still applies for this page even when storage is unavailable.
  }

  current = next;
  syncDocument(next);
  notify();

  window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: next }));
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** Substitute `{name}` placeholders; unknown ones are left visible on purpose. */
export function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;

  return Object.entries(vars).reduce(
    (out, [key, value]) => out.replaceAll(`{${key}}`, String(value)),
    text,
  );
}

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  // English is the safety net if a table is ever edited at runtime.
  const text = translations[locale]?.[key] ?? en[key];

  return interpolate(text, vars);
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Fields every game exposes through the `game.<id>.*` namespace. */
export type GameField = "title" | "category" | "detail" | "hook" | "hint";

/**
 * Key for per-game copy. Kept next to the tables so M3's GamePlugin can reuse the
 * same namespace instead of inventing a parallel one.
 */
export function gameMessage(id: string, field: GameField): MessageKey {
  // SAFETY: every shipped game id has a full `game.<id>.*` set in both tables.
  // Callers still fall back to catalog text when a new game ships without copy,
  // because translate() returns the key itself for an unknown entry.
  return `game.${id}.${field}` as MessageKey;
}

/** Translator bound to the live locale, so components re-render on a switch. */
export function useT(): Translate {
  const locale = useLocale();

  return useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
}

export type { MessageKey };
