import { expect, test } from "@playwright/test";
import { contextoHeat } from "../src/game-ui/contextoRankStyle";
import { rankRowColors } from "./rank-colors";

test("Contexto shows the latest guess with flat inked rank bars in dark mode", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("llmgames-theme", "dark"));
  await page.goto("/design-preview/contexto");
  await expect(page.getByText("The hidden word was", { exact: true })).toHaveCount(0);
  await expect(page.getByText("ocean", { exact: true })).toHaveCount(0);
  const latest = page.getByLabel("Last guess water, rank 18");
  await expect(latest).toBeVisible();
  await expect(latest).toContainText("water");
  await expect(latest).not.toContainText("#");
  await expect(page.locator(".contexto-best")).toHaveCount(0);
  await expect(page.locator(".contexto-meter")).not.toContainText("used");
  const row = page.locator(".contexto-rank-row").first();
  await expect(row).toBeVisible();
  expect(await row.evaluate((element) => getComputedStyle(element).backgroundImage)).toBe("none");
  expect(await row.evaluate((element) => getComputedStyle(element, "::before").maskImage)).toBe(
    "none",
  );
  const colors = await rankRowColors(row);
  expect(colors.heat).toBe(contextoHeat(colors.rank));
  expect(colors.fill).toEqual(colors.expectedFill);
  expect(colors.bar[3]).toBe(255);
  expect(colors.bar).not.toEqual(colors.surface);
  expect(colors.barContrast).toBeGreaterThanOrEqual(4.5);
  expect(colors.surfaceContrast).toBeGreaterThanOrEqual(4.5);
});

test("Contexto uses its heat scale in light mode on paper tracks", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("llmgames-theme", "light"));
  await page.goto("/design-preview/contexto");
  const rows = page.locator(".contexto-stage .contexto-rank-row");
  await expect(rows.first()).toBeVisible();
  const all = await Promise.all((await rows.all()).map(rankRowColors));
  expect(new Set(all.map((colors) => colors.heat)).size).toBeGreaterThan(1);

  for (const colors of all) {
    expect(colors.heat).toBe(contextoHeat(colors.rank));
    expect(colors.fill).toEqual(colors.expectedFill);
    expect(colors.surface).toEqual(colors.expectedSurface);
    expect(colors.bar[3]).toBe(255);

    if (colors.heat !== "found") expect(colors.text).toEqual(colors.expectedText);
    expect(colors.barContrast).toBeGreaterThanOrEqual(4.5);
    expect(colors.surfaceContrast).toBeGreaterThanOrEqual(4.5);
  }
});

test("Contexto replay uses the full board and reveals both players words", async ({ page }) => {
  await page.goto("/design-preview/contexto?state=replay");
  const replay = page.getByLabel("All players' replay guesses");
  await expect(replay).toBeVisible();
  await expect(replay.getByText("The hidden word was", { exact: true })).toHaveCount(0);
  await expect(replay.getByText("ocean", { exact: true })).toHaveCount(0);
  await expect(replay.getByText("water", { exact: true })).toBeVisible();
  await expect(replay.getByText("sea", { exact: true })).toBeVisible();
  await expect(replay.getByText("Guess 8", { exact: true })).toBeVisible();
  await expect(replay.getByText("Guess 7", { exact: true })).toBeVisible();
  await expect(page.getByText("Words stay hidden", { exact: true })).toHaveCount(0);

  const widths = await page.locator(".contexto-replay-grid").evaluate((element) => ({
    grid: element.getBoundingClientRect().width,
    viewport: document.documentElement.clientWidth,
  }));

  expect(widths.grid).toBeGreaterThan(widths.viewport * 0.8);
});

test("Contexto public stream shows every player word and uses the board width", async ({
  page,
}) => {
  await page.goto("/design-preview/spectator?state=watch-contexto");
  const stream = page.getByLabel("Public stream guesses");
  await expect(stream).toBeVisible();
  await expect(stream.getByText("The hidden word was", { exact: true })).toHaveCount(0);
  await expect(stream.getByText("ocean", { exact: true })).toHaveCount(0);
  await expect(stream.getByText("water", { exact: true }).first()).toBeVisible();
  await expect(stream.getByText("sea", { exact: true }).first()).toBeVisible();
  await expect(stream.getByText(/^Best /)).toHaveCount(0);
  await expect(stream.getByText("Live guess board", { exact: true })).toHaveCount(0);
  await expect(stream.getByText("Every word and rank", { exact: true })).toHaveCount(0);
  await expect(stream.getByText("Latest", { exact: true })).toHaveCount(0);
  await expect(stream.getByText(/^\d+\/50$/)).toHaveCount(6);
  await expect(stream.getByText("9/50", { exact: true })).toBeVisible();
  await expect(stream.getByText(/^Guess \d+$/)).toHaveCount(0);
  await expect(stream.getByText(/^#/)).toHaveCount(0);
  await expect(stream.locator(".player-avatar")).toHaveCount(6);
  const alex = stream.locator(".contexto-replay-player").filter({ hasText: "Alex" });
  await expect(alex.locator(".contexto-latest-guess")).toContainText("boat");
  await expect(alex.locator(".contexto-latest-guess")).toContainText("10,341");
  await expect(
    alex.locator(".contexto-ranked-guesses").getByText("boat", { exact: true }),
  ).toBeVisible();
  await expect(
    alex.locator(".contexto-ranked-guesses").locator(".contexto-rank-row").first(),
  ).toContainText("18");
  await expect(page.getByText("Words stay hidden", { exact: true })).toHaveCount(0);

  const widths = await stream.evaluate((element) => ({
    board: element.getBoundingClientRect().width,
    viewport: document.documentElement.clientWidth,
  }));

  expect(widths.board).toBeGreaterThan(widths.viewport * 0.8);
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByLabel("Number of stream players").selectOption("2");
  await expect(stream.locator(".contexto-replay-player")).toHaveCount(2);
  await page.getByLabel("Number of stream players").selectOption("6");
  await expect(stream.locator(".contexto-replay-player")).toHaveCount(6);
});

test("Contexto room spectator gets the full board without player controls or words", async ({
  page,
}) => {
  await page.goto("/design-preview/contexto?state=spectator");
  const spectator = page.getByLabel("Spectator guess ranks");
  await expect(spectator).toBeVisible();
  await expect(spectator.locator(".contexto-replay-player")).toHaveCount(6);
  await expect(page.getByLabel("Guess a word")).toHaveCount(0);
  await expect(page.getByText("Your trail", { exact: true })).toHaveCount(0);
  await expect(spectator.getByText("water", { exact: true })).toHaveCount(0);
  await expect(spectator.getByText("sea", { exact: true })).toHaveCount(0);
  await expect(spectator.locator(".contexto-rank-row span").first()).toHaveText("••••••");

  const widths = await spectator.evaluate((element) => ({
    board: element.getBoundingClientRect().width,
    viewport: document.documentElement.clientWidth,
  }));

  expect(widths.board).toBeGreaterThan(widths.viewport * 0.8);
});

test("Contexto spectator grid fills each row for one through six players", async ({ page }) => {
  await page.goto("/design-preview/spectator?state=watch-contexto");
  await page.getByText("Demo controls", { exact: true }).click();
  const select = page.getByLabel("Number of stream players");
  const grid = page.locator(".contexto-replay-grid");

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);

    for (let count = 1; count <= 6; count++) {
      await select.selectOption(String(count));
      await expect(grid).toHaveAttribute("data-player-count", String(count));
      await expect(grid.locator(".contexto-replay-player")).toHaveCount(count);

      const layout = await grid.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const cards = [...element.children].map((child) => child.getBoundingClientRect());
        const rows = new Map<number, DOMRect[]>();

        for (const card of cards) {
          const key = Math.round(card.top);
          rows.set(key, [...(rows.get(key) ?? []), card]);
        }

        return {
          width: bounds.width,
          rows: [...rows.values()].map((row) => ({
            left: Math.min(...row.map((card) => card.left)) - bounds.left,
            right: bounds.right - Math.max(...row.map((card) => card.right)),
          })),
        };
      });

      expect(layout.width).toBeGreaterThan(viewport.width * 0.8);
      expect(
        layout.rows.every((row) => Math.abs(row.left) < 2 && Math.abs(row.right) < 2),
        JSON.stringify({ viewport, count, layout }),
      ).toBe(true);
    }
  }
});

test("Contexto reveals the hidden word after the game and in its replay", async ({ page }) => {
  await page.goto("/design-preview/spectator?state=watch-contexto-win");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const resultSecret = page.locator(".match-result .result-word-target");
  await expect(resultSecret.getByText("Final word")).toBeVisible();
  await expect(resultSecret.getByText("ocean", { exact: true })).toBeVisible();
  await page.goto("/design-preview/contexto?state=replay-ended");
  const replay = page.getByLabel("All players' replay guesses");
  const replaySecret = replay.locator(".contexto-secret");
  await expect(replaySecret.getByText("The hidden word was", { exact: true })).toBeVisible();
  await expect(replay.getByText("ocean", { exact: true })).toBeVisible();
  expect(await replaySecret.evaluate((element) => getComputedStyle(element).color)).toBe(
    "rgb(11, 11, 11)",
  );
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
])
  test(`Word player layouts remain accessible ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/design-preview/contexto");
    await page.getByText("Demo controls", { exact: true }).click();
    let rankHeight: number | undefined;

    for (let count = 1; count <= 6; count++) {
      await page.getByLabel("Number of players", { exact: true }).selectOption(String(count));
      await expect(page.locator(".contexto-stage")).toHaveAttribute(
        "data-player-count",
        String(count),
      );
      await expect(page.locator(".contexto-rival")).toHaveCount(count - 1);
      await expect(page.getByLabel("Guess a word", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );

      const clipped = await page
        .locator(
          ".contexto-rank-row>span,.contexto-rank-row>strong,.contexto-rival .player-name-label>strong",
        )
        .evaluateAll((elements) =>
          elements.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
        );

      expect(clipped).toEqual([]);

      const nextHeight = await page
        .locator(".contexto-rank-row")
        .first()
        .evaluate((element) => element.getBoundingClientRect().height);

      rankHeight ??= nextHeight;
      expect(nextHeight).toBe(rankHeight);
    }
  });
