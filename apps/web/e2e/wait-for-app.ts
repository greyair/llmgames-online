import type { Page } from "@playwright/test";

/**
 * Wait until every Astro island has hydrated.
 *
 * Preview pages render their whole app inside islands. A click that lands before
 * hydration reaches inert markup, so the interaction silently does nothing and
 * the assertion fails a few seconds later on a busy machine. Astro removes the
 * `ssr` attribute once an island is live, which makes it the signal to wait on.
 */
export async function waitForApp(page: Page, timeout = 20000) {
  await page.waitForFunction(
    () => {
      const islands = [...document.querySelectorAll("astro-island")];

      return islands.length > 0 && islands.every((island) => !island.hasAttribute("ssr"));
    },
    undefined,
    { timeout },
  );
}
