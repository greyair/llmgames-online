import { test, expect } from "@playwright/test";

test("phone game options retain sound and the relevant clock", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/design-preview/contexto");
  await expect(page.getByRole("heading", { name: "Contexto", exact: true })).toBeVisible();
  await expect(page.getByLabel("Turn time remaining")).toHaveCount(0);
  await expect(page.getByLabel("Match time remaining", { exact: true })).toBeVisible();
  await page.getByLabel("Game options", { exact: true }).click();
  await page.getByRole("button", { name: "Mute sound effects", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Enable sound effects", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Game options", { exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(
    page.getByRole("button", { name: "Enable sound effects", exact: true }),
  ).toBeVisible();
});

test("phone Codenames keeps its clue above the board and can expand rosters", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/design-preview/codenames");
  await expect(page.locator(".word-card")).toHaveCount(25);

  const clue = await page.locator(".words-clue").boundingBox(),
    board = await page.locator(".words-board").boundingBox();

  expect(clue!.y + clue!.height).toBeLessThanOrEqual(board!.y);
  const team = page.getByRole("complementary", { name: "blue team", exact: true });
  await expect(team.locator(".word-team-card")).toBeHidden();
  await team.getByRole("button").click();
  await expect(team.locator(".word-team-card")).toBeVisible();
});

test("phone opponent ranks stay visible and masked", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/design-preview/contexto");
  const opponent = page.locator(".contexto-rival").first();
  await expect(opponent.locator("ol")).toBeVisible();
  await expect(opponent.getByText(/^Best/)).toHaveCount(0);
  await expect(opponent.locator(".contexto-rank-row span").first()).toHaveText("••••••");
  await expect(page.getByText("Lower is closer · Rank 1 wins", { exact: true })).toBeVisible();
});

test("phone Pokemon exposes readable move details and reachable switches", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/design-preview/pokemon");
  await expect(page.locator(".poke-move")).toHaveCount(4);

  const sizes = await page
    .locator(".poke-move>span small,.poke-move em")
    .evaluateAll((elements) => elements.map((el) => parseFloat(getComputedStyle(el).fontSize)));

  expect(sizes.length).toBeGreaterThan(0);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  const switchButton = page.getByRole("button", { name: "Snorlax", exact: true });
  await switchButton.scrollIntoViewIfNeeded();
  await expect(switchButton).toBeInViewport();
});
