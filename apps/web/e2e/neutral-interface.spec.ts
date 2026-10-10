import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
]) {
  for (const screen of ["library", "connect4", "reversi"]) {
    test(`${screen} ${viewport.width}x${viewport.height}: layout`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`/design-preview/${screen}`);
      await expect(page.locator("h1")).toBeVisible();

      if (screen !== "library") await expect(page.locator(".discs-board")).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${screen}.png`) });

      const dimensions = await page.evaluate(() => ({
        w: innerWidth,
        h: innerHeight,
        sw: document.documentElement.scrollWidth,
        sh: document.documentElement.scrollHeight,
      }));

      expect(dimensions.sw).toBeLessThanOrEqual(dimensions.w + 1);

      if (screen !== "library") expect(dimensions.sh).toBeLessThanOrEqual(dimensions.h + 1);
      expect(errors).toEqual([]);
    });
  }
}

for (const screen of ["library", "connect4", "reversi"]) {
  test(`${screen}: accessibility`, async ({ page }) => {
    await page.goto(`/design-preview/${screen}`);
    await expect(page.locator("h1")).toBeVisible();

    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    expect(
      result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  });
}

for (const game of ["connect4", "reversi"]) {
  test(`${game}: server intents and read-only states`, async ({ page }) => {
    await page.goto(`/design-preview/${game}`);
    await page.getByText("Demo controls", { exact: true }).click();
    await (
      game === "connect4"
        ? page.getByRole("button", { name: "Drop in column 4" })
        : page.getByRole("button", { name: /^Row 3, column 4, empty/ })
    ).click();
    await expect(page.getByLabel("Demo action")).toContainText(
      game === "connect4" ? 'drop_disc {"col":3}' : 'place_disc {"row":2,"col":3}',
    );

    for (const state of ["waiting", "spectator", "spectator-ended"]) {
      await page.getByLabel("Demo state").selectOption(state);
      await expect(page.locator(".discs-stage button:enabled")).toHaveCount(0);
    }
  });
}

test("sound choice persists", async ({ page }) => {
  await page.goto("/design-preview/library");
  await page.getByRole("button", { name: "Mute sound effects" }).click();
  await expect(page.getByRole("button", { name: "Enable sound effects" })).not.toHaveAttribute(
    "aria-pressed",
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Enable sound effects" })).toBeVisible();
});

test("spectator uses shared controls and read-only boards", async ({ page }, info) => {
  await page.goto("/design-preview/spectator?state=watch-connect4");
  await expect(page.locator(".match-desk[data-stream=true]")).toBeVisible();
  await expect(page.locator(".watch-card,.watch-open,.spectator-game-sections")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Filter matches" })).toHaveCount(0);
  await expect(page.getByText("Starting soon", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("spectator.png") });
  await expect(page.locator(".discs-board")).toBeVisible();
  await expect(page.locator(".discs-board button:enabled")).toHaveCount(0);

  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();

  expect(
    result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
});
