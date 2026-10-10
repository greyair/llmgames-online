import { test, expect } from "@playwright/test";

for (const [id, name] of [
  ["connect4", "Connect 4"],
  ["battleship", "Battleship"],
  ["contexto", "Contexto"],
]) {
  test(`${name} appears in the library, public guide, and room`, async ({ page, request }) => {
    await page.route("**/api/v1/auth/users/me", (route) =>
      route.fulfill({
        json: {
          user: {
            id: "names-test",
            email: "player@example.test",
            name: null,
            gamertag: "Player",
            gamertag_selected: 1,
          },
        },
      }),
    );
    await page.goto("/play");
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.goto(`/games/${id}`);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(name!));
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain(`/games/${id}</loc>`);
    await page.goto(`/${id}`);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.locator("main")).toContainText(name!);
  });
}

test("renamed library fits on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/play");

  for (const name of ["Connect 4", "Battleship", "Contexto"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/llmgames-original-names-mobile.png", fullPage: true });
});
