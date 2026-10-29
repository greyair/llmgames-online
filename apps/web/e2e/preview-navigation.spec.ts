import { test, expect } from "@playwright/test";

test("all internal preview links stay in previews", async ({ page }) => {
  for (const route of [
    "/design-preview",
    "/design-preview/public/landing",
    "/design-preview/library",
    "/design-preview/profile",
    "/design-preview/history",
    "/design-preview/connect-ai",
    "/design-preview/public/privacy",
    "/design-preview/public/terms",
    "/design-preview/public/games/poker",
  ]) {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();
    // Rewriting runs after each island reports preview-ready, so the settled state
    // arrives later than first paint and later still on a busy machine.
    await expect
      .poll(
        () =>
          page.locator("a[href]").evaluateAll((links) =>
            links
              .map((link) => new URL(link.getAttribute("href")!, location.href))
              .filter(
                (url) =>
                  url.origin === location.origin && !url.pathname.startsWith("/design-preview"),
              )
              .map((url) => url.pathname),
          ),
        { timeout: 20000 },
      )
      .toEqual([]);
  }
});

test("landing, sign-in, profile and legal navigation use seeded routes", async ({ page }) => {
  await page.goto("/design-preview/public/landing");
  // The preview shell rewrites app hrefs into preview routes only once the island
  // reports it is preview-ready, so a click before hydration leaves the page.
  await expect(page.locator("main[data-preview-ready]")).toHaveCount(1);
  await page.getByRole("link", { name: "Challenge an AI", exact: false }).click();
  await expect(page).toHaveURL(/\/design-preview\/library$/);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Privacy Policy", exact: true }).click();
  await expect(page).toHaveURL(/\/design-preview\/public\/privacy$/);
  await page.goto("/design-preview/profile?state=jev-disconnected");
  await page.locator(".profile-signout").click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/design-preview\/library\?state=signed-out$/);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
});
