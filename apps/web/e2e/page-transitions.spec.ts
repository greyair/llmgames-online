import { test, expect } from "@playwright/test";

test("signed-out chrome stays put when opening sign in", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.locator(".site-bar").evaluate((bar) => bar.setAttribute("data-persist-check", "1"));
  await page.evaluate(() => {
    const html = document.documentElement;
    html.dataset.swapCount = "0";
    document.addEventListener("astro:after-swap", () => {
      html.dataset.swapCount = String(Number(html.dataset.swapCount || "0") + 1);
    });
  });
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator(".site-bar")).toHaveAttribute("data-persist-check", "1");
  await expect(page.locator(".site-bar")).toHaveCount(1);
  expect(
    await page.evaluate(async () => {
      await document.fonts.ready;

      return [...document.fonts].some(
        (face) => face.family.includes("Geist") && face.status === "loaded",
      );
    }),
  ).toBe(true);
  expect(
    await page.evaluate(() => Number(document.documentElement.dataset.swapCount)),
  ).toBeGreaterThan(0);
});

test("signed-in chrome stays put between library and connect", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) =>
    r.fulfill({
      json: {
        user: {
          id: "demo-user",
          email: "player@example.com",
          name: null,
          gamertag: "BrightRook",
          gamertag_selected: 1,
          broadcast_allowed: 0,
        },
      },
    }),
  );
  await page.goto("/play");
  await expect(page.getByRole("link", { name: "Profile", exact: true })).toBeVisible();
  await page.locator(".site-bar").evaluate((bar) => bar.setAttribute("data-persist-check", "1"));
  await page.getByRole("link", { name: "Connect AI" }).click();
  await expect(page).toHaveURL(/\/connect-ai$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".site-bar")).toHaveAttribute("data-persist-check", "1");
  await expect(page.getByRole("link", { name: "Profile", exact: true })).toBeVisible();
  await expect(page.locator(".site-bar")).toHaveCount(1);
});

test("cached session shows signed-in chrome before /me returns", async ({ page }) => {
  const user = {
    id: "demo-user",
    email: "player@example.com",
    name: null,
    gamertag: "BrightRook",
    gamertag_selected: 1,
    broadcast_allowed: 0,
  };

  let release: () => void;

  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/v1/auth/users/me", async (r) => {
    await hold;
    await r.fulfill({ json: { user } });
  });
  await page.addInitScript((session) => {
    localStorage.setItem("llmgames-session", JSON.stringify({ user: session }));
  }, user);
  await page.goto("/play");
  await expect(page.getByRole("link", { name: "Profile", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Agent log" })).toBeVisible();
  release!();
  await expect(page.getByRole("link", { name: "Profile", exact: true })).toBeVisible();
});

test("cached session yields when /me says signed out", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "llmgames-session",
      JSON.stringify({
        user: {
          id: "demo-user",
          email: "player@example.com",
          name: null,
          gamertag: "BrightRook",
          gamertag_selected: 1,
        },
      }),
    );
  });
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.goto("/play");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Profile", exact: true })).toHaveCount(0);
});
