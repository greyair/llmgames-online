import { sessionSeedSchema } from "./session-seed";
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { SeriesView } from "@llmgames/game-catalog";

const identity = {
  id: "fixture-host",
  email: "fixture@example.test",
  name: null,
  gamertag: "Fixture",
  gamertag_selected: 1,
};

const config = {
  name: "Fixture series",
  rounds: [{ gameType: "connect4" as const, repeats: 2, gameTotalTime: 60000, turnTime: 30000 }],
  gapMs: 0,
  progression: "automatic" as const,
  firstSeat: "alternate" as const,
};

const view: SeriesView = {
  code: "ABC234",
  config,
  participants: [
    { id: "p1", kind: "human", name: "Fixture", modelLabel: "", promptLabel: "" },
    {
      id: "p2",
      kind: "agent",
      name: "SwiftAnchor",
      modelLabel: "model-v1",
      promptLabel: "baseline",
    },
  ],
  status: "waiting",
  results: [],
  ready: [],
  currentMatch: null,
  nextAt: null,
  totalMatches: 2,
  createdAt: Date.now(),
  expiresAt: Date.now() + 86400000,
  isHost: true,
  you: "p1",
};

async function addGame(page: Page, title: string) {
  const tile = page.getByRole("button", { name: `Add ${title}`, exact: true });
  await tile.click();
}

test.describe("series setup and results", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/v1/auth/users/me", (route) =>
      route.fulfill({ json: { user: identity } }),
    );
    await page.route("**/api/v1/series", (route) => route.fulfill({ json: { series: [] } }));
  });

  test("Chinese series setup and details", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("llmgames-locale", "zh-CN"));
    await page.goto("/series");
    await expect(page.getByRole("heading", { name: "对局设置" })).toBeVisible();
    await page.getByRole("button", { name: "添加 黑白棋" }).click();
    await expect(page.getByRole("button", { name: "创建系列赛", exact: true })).toBeEnabled();
    await page.route("**/api/v1/series/ABC234", (route) => route.fulfill({ json: view }));
    await page.goto("/series?code=ABC234");
    await expect(page.getByRole("heading", { name: "参赛者" })).toBeVisible();
    await expect(page.getByRole("button", { name: "开始系列赛" })).toBeVisible();
  });

  for (const width of [1440, 390, 320])
    test(`accessible builder at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/series");
      await expect(page.getByRole("button", { name: "Create series", exact: true })).toBeDisabled();
      await expect(page.getByRole("heading", { name: "Game series", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Add game", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Game library", exact: true })).toHaveAttribute(
        "href",
        "/play",
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`series-picker-${width}.png`),
        fullPage: true,
      });
      await addGame(page, "Connect 4");
      await expect(
        page.getByText("Default timing: 15 minutes per game · 90 seconds per turn."),
      ).toBeVisible();
      await expect(page.getByRole("combobox", { name: /Match time|Time per turn/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Add Codenames", exact: true })).toHaveCount(0);
      await addGame(page, "Pokémon");
      await expect(
        page.getByText("Both players choose simultaneously. Starting seats alternate."),
      ).toBeVisible();
      await addGame(page, "Contexto");
      await expect(
        page.getByText("Both players guess concurrently. Only the match timer applies."),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator(".series-builder-games").evaluate((element) => element.scrollTo(0, 0));
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: info.outputPath(`series-builder-${width}.png`),
        fullPage: true,
      });
    });
  test("desktop game list scrolls independently with centered name and sticky settings", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/series");

    for (let index = 0; index < 8; index++) await addGame(page, "Connect 4");
    const name = await page.getByLabel("Series name", { exact: true }).boundingBox();
    expect(Math.abs(name!.x + name!.width / 2 - 720)).toBeLessThan(2);
    const settings = page.locator(".series-builder-settings");
    const before = await settings.boundingBox();
    const list = page.locator(".series-builder-games");
    const bounds = await list.boundingBox();
    const documentScroll = await page.evaluate(() => window.scrollY);
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 100);
    await page.mouse.wheel(0, 800);
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect((await settings.boundingBox())!.y).toBe(before!.y);
    expect(await page.evaluate(() => window.scrollY)).toBe(documentScroll);
    expect(await settings.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
    await expect(page.getByRole("button", { name: "Create series", exact: true })).toBeInViewport();
  });
  test("sticky header stays clear of navigation and adding games scrolls to the picker", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/series");

    for (let index = 0; index < 8; index++) await addGame(page, "Connect 4");
    const panel = page.locator(".series-builder-games");
    expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const panelBounds = await panel.boundingBox();

    const tileBounds = await page
      .getByRole("button", { name: "Add Contexto", exact: true })
      .boundingBox();

    expect(tileBounds!.y + tileBounds!.height).toBeLessThanOrEqual(
      panelBounds!.y + panelBounds!.height + 2,
    );
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const headerBounds = await page.locator(".series-builder-header").boundingBox();
    const navBounds = await page.locator(".site-bar").first().boundingBox();
    expect(headerBounds!.y).toBeGreaterThanOrEqual(navBounds!.y + navBounds!.height);
    expect(
      await page
        .locator(".series-builder-header")
        .evaluate((element) => getComputedStyle(element).position),
    ).toBe("sticky");
    await expect(page.getByLabel("Series name", { exact: true })).toBeInViewport();
  });
  test("submits ordered configuration and starts with two participants", async ({ page }) => {
    let submitted: unknown;
    await page.route("**/api/v1/series/create", (route) => {
      submitted = route.request().postDataJSON();

      return route.fulfill({ json: view });
    });
    await page.route("**/api/v1/series/ABC234", (route) => route.fulfill({ json: view }));
    await page.route("**/api/v1/series/ABC234/start", (route) =>
      route.fulfill({ json: { ...view, status: "preparing" } }),
    );
    await page.goto("/series");
    await page.getByLabel("Series name", { exact: true }).fill("Fixture series");
    await expect(page.getByLabel("Matches", { exact: true })).toHaveCount(0);
    await addGame(page, "Connect 4");
    await addGame(page, "Reversi");
    await page.getByRole("button", { name: "Create series", exact: true }).click();
    await expect(page).toHaveURL(/series\?code=ABC234/);
    expect(submitted).toMatchObject({
      playing: true,
      config: {
        name: "Fixture series",
        firstSeat: "alternate",
        gapMs: 15000,
        rounds: [
          { gameType: "connect4", repeats: 1, gameTotalTime: 900000, turnTime: 90000 },
          { gameType: "reversi", repeats: 1, gameTotalTime: 900000, turnTime: 90000 },
        ],
      },
    });
    await expect(page.getByRole("button", { name: "Start series", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Start series", exact: true }).click();
    await expect(page.getByText("Preparing the match…", { exact: true })).toBeVisible();
  });
  test("reorders by drag and keyboard and removes an entry", async ({ page }) => {
    await page.goto("/series");
    await addGame(page, "Connect 4");
    await addGame(page, "Reversi");
    const first = page.getByRole("group", { name: "Game 1", exact: true });
    const second = page.getByRole("group", { name: "Game 2", exact: true });
    await page.locator(".series-builder-games").evaluate((element) => element.scrollTo(0, 0));
    await first.scrollIntoViewIfNeeded();
    const handle = await second.getByRole("button", { name: "Reorder game 2" }).boundingBox();
    const destination = await first.boundingBox();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(destination!.x + 20, destination!.y + 25, { steps: 12 });
    await page.mouse.up();
    await expect(first.getByText("Reversi", { exact: true })).toBeVisible();
    await first.getByRole("button", { name: "Reorder game 1" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(second.getByText("Reversi", { exact: true })).toBeVisible();
    await expect(second.getByRole("button", { name: "Reorder game 2" })).toBeFocused();
    await first.getByRole("button", { name: "Remove game 1" }).click();
    await expect(page.getByRole("group", { name: /^Game \d/ })).toHaveCount(1);
    await expect(first.getByText("Reversi", { exact: true })).toBeVisible();
    await first.getByRole("button", { name: "Remove game 1" }).click();
    await expect(page.getByRole("group", { name: /^Game \d/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create series", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add Reversi", exact: true })).toBeVisible();
  });
  test("reorders games with a touch drag on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/series");
    await addGame(page, "Connect 4");
    await addGame(page, "Reversi");
    const first = page.getByRole("group", { name: "Game 1", exact: true });
    const second = page.getByRole("group", { name: "Game 2", exact: true });
    await first.evaluate((element) => element.scrollIntoView({ block: "start" }));
    const source = await second.getByRole("button", { name: "Reorder game 2" }).boundingBox();
    const target = await first.boundingBox();
    const cdp = await page.context().newCDPSession(page);

    const x = source!.x + source!.width / 2,
      y = source!.y + source!.height / 2;

    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });

    for (let step = 1; step <= 12; step++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + ((target!.y + 25 - y) * step) / 12 }],
      });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(first.getByText("Reversi", { exact: true })).toBeVisible();
    await cdp.detach();
  });
  test("visual picker supports rematches and setup choice buttons", async ({ page }) => {
    await page.goto("/series");
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /^Add (Connect 4|Checkers|Reversi|Pokémon|Battleship|Poker|Contexto)$/,
      }),
    ).toHaveCount(7);
    await addGame(page, "Connect 4");
    await addGame(page, "Connect 4");
    await expect(page.getByRole("group", { name: /^Game \d/ })).toHaveCount(2);
    await page
      .getByRole("group", { name: "Who starts?" })
      .getByRole("button", { name: "Player 2", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Player 2", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page
      .getByRole("group", { name: "Next match", exact: true })
      .getByRole("button", { name: "Both ready" })
      .click();
    await page
      .getByRole("group", { name: "Your seat" })
      .getByRole("button", { name: "Host & watch" })
      .click();
    let submitted: unknown;
    await page.route("**/api/v1/series/create", (route) => {
      submitted = route.request().postDataJSON();

      return route.fulfill({ json: view });
    });
    await page.route("**/api/v1/series/ABC234", (route) => route.fulfill({ json: view }));
    await page.getByRole("button", { name: "Create series", exact: true }).click();
    await expect(page).toHaveURL(/series\?code=ABC234/);
    expect(submitted).toMatchObject({
      playing: false,
      config: {
        firstSeat: "participant2",
        progression: "ready",
        rounds: [
          { gameType: "connect4", repeats: 1 },
          { gameType: "connect4", repeats: 1 },
        ],
      },
    });
  });
  test("exports retained results with configuration and separate standings", async ({
    page,
  }, info) => {
    await page.route("**/api/v1/series/ABC234", (route) =>
      route.fulfill({
        json: {
          ...view,
          status: "completed",
          results: [
            {
              index: 0,
              gameType: "connect4",
              gameId: "fixture-game",
              firstParticipantId: "p1",
              winnerId: "p1",
              outcome: "win",
              reason: "connect4",
              startedAt: 1,
              endedAt: 1001,
              metrics: {
                p1: { actions: 4, decisionMs: 4000, timeouts: 0 },
                p2: { actions: 3, decisionMs: 6000, timeouts: 1 },
              },
            },
          ],
        },
      }),
    );
    await page.goto("/series?code=ABC234");
    await expect(page.getByText("Series complete", { exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "1.0s", exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export results" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    const exported = JSON.parse(readFileSync(path!, "utf8"));
    expect(exported.config.firstSeat).toBe("alternate");
    expect(exported.standings[0].participants[0].wins).toBe(1);
    expect(JSON.stringify(exported)).not.toContain("agentId");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("series-results.png"), fullPage: true });
  });
});

test("real local two-human series carries seats across matches and retains results after room purge", async ({
  browser,
}, info) => {
  const sessionPath = process.env.LLMGAMES_SERIES_TEST_SESSIONS;
  test.skip(!sessionPath, "Run the local seed script and set LLMGAMES_SERIES_TEST_SESSIONS");

  const sessions = sessionSeedSchema.parse(JSON.parse(readFileSync(sessionPath!, "utf8")));

  const hostContext = await browser.newContext(),
    guestContext = await browser.newContext();

  await hostContext.addCookies([
    { name: "session", value: sessions[0]!.token, url: "http://127.0.0.1:3000" },
  ]);
  await guestContext.addCookies([
    { name: "session", value: sessions[1]!.token, url: "http://127.0.0.1:3000" },
  ]);

  const host = await hostContext.newPage(),
    guest = await guestContext.newPage();

  try {
    await host.goto("/series");
    await host.getByLabel("Series name", { exact: true }).fill("Local series flow");
    await host.getByLabel("Break seconds", { exact: true }).fill("0");
    await addGame(host, "Connect 4");
    await addGame(host, "Connect 4");
    await host.getByRole("button", { name: "Create series", exact: true }).click();
    await expect(host.getByText("Waiting for participants", { exact: true })).toBeVisible();
    await guest.goto(host.url());
    await guest.getByRole("button", { name: "Join series", exact: true }).click();
    await expect(host.getByRole("button", { name: "Start series", exact: true })).toBeEnabled();
    const seriesUrl = host.url();
    await host.getByRole("button", { name: "Start series", exact: true }).click();
    await expect(host.getByRole("button", { name: "Drop in column 1", exact: true })).toBeEnabled();
    await host.getByRole("button", { name: "Drop in column 1", exact: true }).click();
    await guest.getByRole("button", { name: "Drop in column 2", exact: true }).click();
    await host.getByRole("button", { name: "Drop in column 1", exact: true }).click();
    await guest.getByRole("button", { name: "Drop in column 2", exact: true }).click();
    await host.getByRole("button", { name: "Drop in column 1", exact: true }).click();
    await guest.getByRole("button", { name: "Drop in column 2", exact: true }).click();
    await host.getByRole("button", { name: "Drop in column 1", exact: true }).click();
    await expect(guest.getByRole("button", { name: "Drop in column 1", exact: true })).toBeEnabled({
      timeout: 45000,
    });
    await expect(
      guest.getByText("Local series flow · Match 2 of 2", { exact: true }),
    ).toBeVisible();
    await guest.getByRole("button", { name: "Drop in column 1", exact: true }).click();
    await host.getByRole("button", { name: "Drop in column 2", exact: true }).click();
    await guest.getByRole("button", { name: "Drop in column 1", exact: true }).click();
    await host.getByRole("button", { name: "Drop in column 2", exact: true }).click();
    await guest.getByRole("button", { name: "Drop in column 1", exact: true }).click();
    await host.getByRole("button", { name: "Drop in column 2", exact: true }).click();
    await guest.getByRole("button", { name: "Drop in column 1", exact: true }).click();
    await expect(host.getByText("Series complete", { exact: true })).toBeVisible({
      timeout: 45000,
    });
    await host.goto(seriesUrl);
    await expect(host.getByText("2 / 2 results")).toBeVisible();
    const rows = host.getByRole("table").getByRole("row");
    await expect(rows.nth(1).getByRole("cell").nth(0)).toHaveText("1");
    await expect(rows.nth(2).getByRole("cell").nth(0)).toHaveText("1");
    await host.screenshot({ path: info.outputPath("real-series-results.png"), fullPage: true });
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
