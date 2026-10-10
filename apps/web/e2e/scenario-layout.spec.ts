import { isFlowState } from "../src/dev/designPreview";
import { test, expect } from "@playwright/test";
import { gameRouteSlug } from "@llmgames/game-catalog";

const games = [
  "contexto",
  "connect4",
  "checkers",
  "reversi",
  "codenames",
  "poker",
  "pokemon",
  "battleship",
];

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 844, height: 390 },
]) {
  for (const game of games) {
    test(`${game}: all seeded layouts at ${viewport.width}x${viewport.height}`, async ({
      page,
    }, info) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`/design-preview/${gameRouteSlug(game)}`);
      await page.getByText("Demo controls", { exact: true }).click();

      const modes = await page
        .getByLabel("Demo state")
        .locator("option")
        .evaluateAll((options) =>
          options.map((option) => {
            if (!(option instanceof HTMLOptionElement)) throw new Error("Expected scenario option");

            return option.value;
          }),
        );

      for (const mode of modes.filter((mode) => !isFlowState(mode))) {
        await page.getByLabel("Demo state").selectOption(mode);
        await page.getByText("Demo controls", { exact: true }).click();

        if (["win", "loss", "draw", "spectator-ended"].includes(mode))
          await expect(page.locator(".match-result")).toBeVisible();
        await expect(page.locator("h1")).toBeVisible();

        const size = await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          contentWidth: document.documentElement.scrollWidth,
          contentHeight: document.documentElement.scrollHeight,
        }));

        expect(size.contentWidth, mode).toBeLessThanOrEqual(size.width + 1);

        if (await page.locator(".match-result").isVisible()) {
          const exit = page
            .locator(".result-actions")
            .getByRole("button", { name: "Find another game", exact: true });

          await exit.scrollIntoViewIfNeeded();
          await expect(exit).toBeInViewport();
        } else if (!mode.includes("ended"))
          expect(size.contentHeight, mode).toBeLessThanOrEqual(size.height + 1);

        if (["playing", "waiting", "win", "full-teams", "full-table"].includes(mode)) {
          await page.screenshot({ path: info.outputPath(`${mode}.png`) });
        }

        await page.getByText("Demo controls", { exact: true }).click();
      }

      expect(errors).toEqual([]);
    });
  }
}
