import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { rankRowColors } from "./rank-colors";

for (const width of [390, 1440])
  for (const route of [
    "connect-ai",
    "public/landing",
    "library",
    "profile",
    "history?state=featured",
    "agent-log",
    "connect4",
    "reversi",
    "poker",
    "codenames",
    "battleship",
    "pokemon",
    "contexto",
    "public/games/contexto",
    "spectator",
    "public/watch",
    "public/privacy",
    "library?state=auth-code",
  ])
    test(`dark ${route} ${width}`, async ({ page }, info) => {
      await page.addInitScript(() => localStorage.setItem("llmgames-theme", "dark"));
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/design-preview/" + route);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );

      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();

      expect(
        audit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        })),
      ).toEqual([]);
      await page.screenshot({ path: info.outputPath("dark.png"), fullPage: true });
    });

test("theme persists between pages and reloads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design-preview/connect-ai");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("system preference is used before a theme is saved", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/design-preview/connect-ai");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("library tiles pair pixel artwork with an accessible player count", async ({ page }) => {
  await page.goto("/design-preview/library");
  const tile = page.locator(".game-tile").first();
  await expect(tile.locator(".game-glyph svg")).toBeVisible();
  await expect(tile.locator(".library-caption span")).toHaveText(/^2 players · /);
  await expect(tile).toHaveAccessibleName("Play Connect 4");
});

test("Contexto keeps its dark rank rows readable", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("llmgames-theme", "dark"));
  await page.goto("/design-preview/contexto");
  await expect(page.getByRole("heading", { name: "Contexto" })).toBeVisible();
  const rows = page.locator(".contexto-stage .contexto-rank-row");
  await expect(rows.first()).toBeVisible();

  for (const colors of await Promise.all((await rows.all()).map(rankRowColors))) {
    if (colors.heat !== "found") expect(colors.text).toEqual(colors.expectedText);
    expect(colors.barContrast).toBeGreaterThanOrEqual(4.5);
    expect(colors.surfaceContrast).toBeGreaterThanOrEqual(4.5);
  }

  const distant = rows.filter({ hasText: "4,820" });
  await expect(distant).toBeVisible();
  const colors = await rankRowColors(distant);
  expect(colors.heat).toBe("cold");
  expect(colors.surface).toEqual(colors.expectedSurface);
});
