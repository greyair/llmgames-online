import { test, expect } from "@playwright/test";

test("the library and public routes exclude retired Blackjack games", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (route) => route.fulfill({ json: { user: null } }));
  await page.goto("/");
  await expect(page.locator(".landing-challenge[data-game=connect4]")).toBeVisible();
  await expect(page.locator(".landing-challenge[data-game=poker]")).toBeVisible();
  await expect(page.locator('a[href*="blackjack"]')).toHaveCount(0);

  for (const path of [
    "/blackjack",
    "/blackjack-duel",
    "/games/blackjack",
    "/games/blackjack-duel",
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});
