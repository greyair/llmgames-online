import { test, expect } from "@playwright/test";

test("remote-style directory groups states and opens full pages", async ({ page, context }) => {
  await page.goto("/design-preview");
  await expect(page.getByRole("heading", { name: "Design previews", exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Preview sets" })
    .getByRole("link", { name: "Poker", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Gameplay", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "River", exact: true })).toHaveAttribute(
    "href",
    "/design-preview/poker?state=river",
  );
  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name: "Showdown", exact: true }).click();
  const preview = await opened;
  await expect(preview.locator(".cards-stage")).toBeVisible();
  await preview.close();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Poker", exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Preview sets" })
    .getByRole("link", { name: "Spectator", exact: true })
    .click();
  await expect(page.getByRole("link", { name: "No games", exact: true })).toHaveAttribute(
    "href",
    "/design-preview/spectator?state=empty",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test("spectator state links show their seeded state", async ({ page }) => {
  await page.goto("/design-preview/spectator?state=empty");
  await expect(page.getByRole("heading", { name: "No games are live right now" })).toBeVisible();
  await page.goto("/design-preview/spectator?state=watch-poker-showdown");
  await expect(page.locator(".cards-stage")).toBeVisible();
  await expect(page.locator(".card-controls button")).toHaveCount(0);
  await page.goto("/design-preview/spectator?state=creating");
  await expect(page.getByRole("heading", { name: "Players are getting ready" })).toBeVisible();
});

test("games stay separate while account previews stay together", async ({ page }) => {
  await page.goto("/design-preview#poker");
  await expect(page.getByRole("heading", { name: "Poker", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Preview sets" });

  for (const name of [
    "Connect 4",
    "Reversi",
    "Codenames",
    "Poker",
    "Battleship",
    "Fleet placement",
    "Pokémon",
  ])
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await nav.getByRole("link", { name: "Account & sign-in", exact: true }).click();
  await expect(page.getByRole("link", { name: "Email code", exact: true })).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "TypeSafe disconnected", exact: true }),
  ).toHaveAttribute("href", "/design-preview/profile?state=jev-disconnected");
  await expect(page.getByRole("link", { name: "TypeSafe connected", exact: true })).toHaveAttribute(
    "href",
    "/design-preview/profile?state=jev-connected",
  );
  await nav.getByRole("link", { name: "Codenames", exact: true }).click();
  await expect(page.getByRole("link", { name: "Lobby Unassigned", exact: true })).toBeVisible();
});

test("Jev design previews expose the trial and account states", async ({ page }) => {
  await page.goto("/design-preview/connect4?state=lobby-jev");
  await expect(page.getByRole("button", { name: "Try Jev for a game", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Connect your account/ })).toBeVisible();
  await page.goto("/design-preview/profile?state=jev-disconnected");
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
  await page.goto("/design-preview/profile?state=jev-connected");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText("38 / 10,000", { exact: true })).toBeVisible();
});
