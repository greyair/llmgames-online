import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`Codenames fits ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/design-preview/codenames");
    await expect(page.locator(".word-card")).toHaveCount(25);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath("codenames.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      viewport.height,
    );

    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    expect(
      audit.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  });

test("Codenames projection and intents", async ({ page }) => {
  await page.goto("/design-preview/codenames");
  await page.getByText("Demo controls", { exact: true }).click();
  await expect(page.locator(".word-card[data-team=hidden]")).toHaveCount(24);
  await page.getByRole("button", { name: "MOON", exact: true }).click();
  await expect(page.getByLabel("Demo action")).toContainText('guess_word {"index":0}');
  await expect(page.getByRole("button", { name: "End turn", exact: true })).toHaveCount(0);
  await page.getByLabel("Demo state").selectOption("guess-used");
  await page.getByRole("button", { name: "End turn", exact: true }).click();
  await expect(page.getByLabel("Demo action")).toContainText("end_turn");
  await page.getByLabel("Demo state").selectOption("clue");
  await expect(page.locator(".word-card[data-team=hidden]")).toHaveCount(0);
  await page.getByLabel("Clue word").fill("Ocean");
  await page.getByLabel("Clue count").selectOption("unlimited");
  await page.getByRole("button", { name: "Give clue" }).click();
  await expect(page.getByLabel("Demo action")).toContainText(
    'give_clue {"word":"Ocean","count":"unlimited"}',
  );

  for (const state of ["waiting", "spectator"]) {
    await page.getByLabel("Demo state").selectOption(state);
    await expect(page.locator(".word-card:enabled")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Give clue" })).toHaveCount(0);
  }

  await expect(page.locator(".word-card[data-team=hidden]")).toHaveCount(24);
});
