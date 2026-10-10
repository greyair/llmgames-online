import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  test(`Reversi shows disc counts at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/design-preview/reversi");
    await expect(page.getByLabel("2 black discs", { exact: true })).toBeVisible();
    await expect(page.getByLabel("2 white discs", { exact: true })).toBeVisible();
    await expect(page.locator(".desk-piece-count")).toHaveText(["2", "2"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath("disc-counts.png") });
  });
