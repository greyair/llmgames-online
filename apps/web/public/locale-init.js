/**
 * Applies the visitor's language before first paint.
 *
 * Static markup is English and remains visible until React hydrates. This script
 * selects the preferred language without hiding content if hydration is slow.
 *
 * Must stay in sync with src/i18n/core.ts — same storage key, same fallback order.
 */
(() => {
  const STORAGE_KEY = "llmgames-locale";
  const EVENT = "llmgames:locale";
  const SUPPORTED = ["en", "zh-CN"];

  const normalize = (tag) => {
    const lower = String(tag || "").toLowerCase();

    if (lower === "zh" || lower.startsWith("zh-")) return "zh-CN";

    if (lower.startsWith("en")) return "en";

    return null;
  };

  const resolve = () => {
    let saved = null;

    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {}

    if (SUPPORTED.includes(saved)) return saved;

    const tags = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];

    for (const tag of tags) {
      const hit = normalize(tag);

      if (hit) return hit;
    }

    return "en";
  };

  const locale = resolve();

  const apply = (next) => {
    const root = document.documentElement;
    root.lang = next;
    root.dataset.locale = next;
  };

  apply(locale);

  document.addEventListener("astro:after-swap", () => apply(resolve()));

  window.addEventListener(EVENT, (event) => {
    const next = event.detail;

    if (SUPPORTED.includes(next)) apply(next);
  });

  // Exposed for the app and for diagnostics; not part of the page contract.
  window.__llmgamesLocale = { locale };
})();
