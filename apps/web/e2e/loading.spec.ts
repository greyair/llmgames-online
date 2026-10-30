import { test, expect } from "@playwright/test";
import { featuredHistoryFixture } from "../src/dev/featuredHistoryFixture";

const user = {
  id: "loading-user",
  email: "player@example.test",
  name: null,
  gamertag: "Player",
  gamertag_selected: 1,
  broadcast_allowed: 0,
};

test("loader steps its pixel cells next to a visible label", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/design-preview/library?state=auth-loading");
  const loader = page.locator(".ui-loading-panel .ui-loader");
  await expect(loader).toBeVisible();
  await expect(loader.locator(".ui-loader-label")).not.toBeEmpty();
  const cells = loader.locator(".ui-loader-mark i");
  await expect(cells).toHaveCount(9);
  expect(await cells.first().evaluate((el) => getComputedStyle(el).animationName)).toBe(
    "loader-cell",
  );

  const before = await cells.evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).opacity).join(),
  );

  await expect
    .poll(() => cells.evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity).join()))
    .not.toBe(before);
});

for (const width of [390, 1280])
  test(`loading panels fit at ${width}px and respect reduced motion`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });

    for (const screen of ["library?state=auth-loading", "spectator?state=loading"]) {
      await page.goto(`/design-preview/${screen}`);
      const panel = page.locator(".ui-loading-panel");
      await expect(panel).toBeVisible();
      await expect(panel.locator(".ui-loader-label")).not.toBeEmpty();
      expect(
        await panel.locator(".ui-loader-mark").evaluate((el) => getComputedStyle(el).animationName),
      ).toBe("none");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(screen.startsWith("library") ? "account.png" : "spectator.png"),
      });
    }

    await expect(page.getByRole("button", { name: "Back to games" })).toHaveCount(0);
  });

test("agents do not flash zero identities and retain results during refresh", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user } }));
  let release = () => {};

  await page.route("**/api/v1/auth/users/me/agents", async (r) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await r.fulfill({
      json: {
        agents: [
          {
            codename: "SwiftAnchor",
            environmentLabel: "Codex",
            createdAt: 1788970000,
            lastUsedAt: null,
            hasRoomHistory: true,
            isActive: false,
          },
        ],
      },
    });
  });
  await page.goto("/agent-log");
  await expect(page.getByText("Loading agents…")).toBeVisible();
  await expect(page.locator(".agent-summary")).toHaveCount(0);
  release();
  await expect(page.getByRole("heading", { name: "SwiftAnchor" })).toBeVisible();
  const before = await page.locator(".agent-summary").boundingBox();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refreshing…" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "SwiftAnchor" })).toBeVisible();
  expect((await page.locator(".agent-summary").boundingBox())?.y).toBe(before?.y);
  release();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
});

test("history keeps results in place while loading older games", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user } }));
  let release = () => {};

  await page.route("**/api/v1/auth/users/me/game-logs*", async (r) => {
    if (r.request().url().includes("before="))
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await r.fulfill({ json: { games: featuredHistoryFixture, nextCursor: "older" } });
  });
  await page.goto("/history");
  await expect(page.locator(".history-entry").first()).toBeVisible();

  const before = await page
    .locator(".history-list")
    .evaluate((el) => el.getBoundingClientRect().top + scrollY);

  await page.getByRole("button", { name: "Load older games" }).click();
  await expect(page.getByRole("button", { name: "Loading games…" })).toBeVisible();
  await expect(page.locator("main > .holey-loader")).toHaveCount(0);
  expect(
    await page.locator(".history-list").evaluate((el) => el.getBoundingClientRect().top + scrollY),
  ).toBe(before);
  release();
  await expect(page.getByRole("button", { name: "Load older games" })).toBeEnabled();
});

test("account and game routes have a visible fallback before JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();

  for (const path of ["/login", "/poker"]) {
    await page.goto(path);
    // Without JavaScript there is no `data-locale`, so the stylesheet keeps the
    // English copy and hides the Chinese one instead of hiding the wait itself.
    const label = page.locator("main .ui-loader-label");

    await expect(label.locator('[data-i18n-text="en"]')).toHaveText("Loading…");
    await expect(label.locator('[data-i18n-text="zh"]')).toBeHidden();
    await expect(label).toBeVisible();
  }

  await context.close();
});

test("room connection recovery fits in the mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user } }));
  await page.route("**/api/v1/rooms/join", (r) =>
    r.fulfill({
      json: {
        roomId: "loading-room",
        roomCode: "DEMO12",
        gameType: "connect4",
        gameStatus: "waiting",
        wsUrl: "ws://localhost/api/v1/ws/games/loading-room",
        expiresAt: Date.now() + 100000,
      },
    }),
  );
  await page.routeWebSocket("**/api/v1/ws/games/**", () => {});
  await page.goto("/connect4?roomCode=DEMO12");
  await expect(page.getByText("Connecting to game…")).toBeVisible();
  await expect(page.getByText("DEMO12", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in again" })).toHaveCount(0);
  await expect(page.getByText("Still trying to connect…")).toBeVisible({ timeout: 7000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Create room" })).toHaveCount(0);
});

test("room connection only asks for sign-in after the session expires", async ({ page }) => {
  let accountChecks = 0;
  await page.route("**/api/v1/auth/users/me", (r) =>
    r.fulfill({ json: { user: accountChecks++ === 0 ? user : null } }),
  );
  await page.route("**/api/v1/rooms/join", (r) =>
    r.fulfill({
      json: {
        roomId: "loading-room",
        roomCode: "DEMO12",
        gameType: "connect4",
        gameStatus: "waiting",
        wsUrl: "ws://localhost/api/v1/ws/games/loading-room",
        expiresAt: Date.now() + 100000,
      },
    }),
  );
  await page.routeWebSocket("**/api/v1/ws/games/**", () => {});
  await page.goto("/connect4?roomCode=DEMO12");
  await expect(page.getByText("Connecting to game…")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in again" })).toHaveCount(0);
  await expect(page.getByText("Your session expired")).toBeVisible({ timeout: 7000 });
  await expect(page.getByRole("link", { name: "Sign in again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});
