import { test, expect } from "@playwright/test";

test("library uses one whole-card link and an arrow per game", async ({ page }) => {
  await page.goto("/design-preview/library");
  const card = page.locator(".game-tile").first();
  await expect(card).toHaveAttribute("href", /connect4/);
  await expect(card.locator("button,a")).toHaveCount(0);
  await expect(card.locator(".library-caption h2")).toHaveText("Connect 4");
  await card.click();
  await expect(page).toHaveURL(/design-preview\/connect4/);
});

test("landing challenges link to every game on play", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.goto("/");
  const landing = page.locator(".landing-challenge");
  await expect(landing.first()).toBeVisible();
  const count = await landing.count();
  expect(count).toBeGreaterThan(1);
  await expect(landing.first()).toHaveAttribute("href", /connect4/);
  await expect(landing.first()).toContainText("Connect 4");

  const hrefs = await landing.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")).sort(),
  );

  await page.goto("/play");
  await expect(page.locator(".library-grid .game-tile")).toHaveCount(count);
  expect(
    await page
      .locator(".library-grid .game-tile")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")).sort()),
  ).toEqual(hrefs);
});

test("game options expose appearance and dismiss with Escape", async ({ page }) => {
  await page.goto("/design-preview/poker");
  const options = page.getByLabel("Game options", { exact: true });
  await options.click();
  await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await expect(page.locator(".desk-options")).not.toHaveAttribute("open", "");
  await expect(options).toBeFocused();
});

test("poker shortcuts set legal wager totals without sending an action", async ({ page }) => {
  await page.goto("/design-preview/poker");
  await page.getByRole("button", { name: "Min 40", exact: true }).click();
  await expect(page.getByRole("button", { name: "Raise to 40", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Raise to 40", exact: true }).click();
  await expect(page.getByLabel("Demo action")).toContainText('raise {"raiseTo":40}');
});
