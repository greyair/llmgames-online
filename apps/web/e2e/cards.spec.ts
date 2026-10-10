import type {} from "./browser-state";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const game of ["poker"])
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ])
    test(`${game} card layout ${viewport.width}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await page.goto(`/design-preview/${game}`);
      await expect(page.locator(".card-seat").first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: info.outputPath("table.png") });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        viewport.height,
      );

      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();

      expect(
        audit.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
    });

test("Poker wagers and private cards", async ({ page }) => {
  await page.goto("/design-preview/poker");
  await expect(page.getByRole("img", { name: "Hidden card", exact: true })).toHaveCount(10);
  await expect(page.locator(".poker-orbit-seat[data-self=true] .playing-card")).toHaveCount(2);
  await expect(
    page.locator(".poker-orbit-seat[data-self=true] .playing-card").first(),
  ).toBeVisible();
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Raise to 40", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Raise to 40", exact: true }).click();
  await expect(page.getByLabel("Demo action")).toContainText('raise {"raiseTo":40}');
  await page.getByRole("button", { name: "Increase wager", exact: true }).click();
  await expect(page.getByRole("button", { name: "Raise to 50", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Decrease wager", exact: true }).click();
  await expect(page.getByRole("button", { name: "Raise to 40", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "½ pot 110", exact: true }).click();
  await page.getByRole("button", { name: "Raise to 110", exact: true }).click();
  await expect(page.getByLabel("Demo action")).toContainText('raise {"raiseTo":110}');
  await page.getByRole("button", { name: "All in 990", exact: true }).click();
  await page.locator(".poker-wager-submit").click();
  await expect(page.getByLabel("Demo action")).toContainText('raise {"raiseTo":990}');
  await page.goto("/design-preview/poker?state=check-bet");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByLabel("Demo action")).toContainText("check");

  for (const state of ["spectator"]) {
    await page.goto(`/design-preview/poker?state=${state}`);
    await expect(page.locator(".card-controls button")).toHaveCount(0);
  }
});

test("Poker shows the winner and revealed cards for five seconds between hands", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/design-preview/poker?state=showdown");
  const result = page.locator(".poker-hand-result");
  await expect(page.locator(".desk-title")).toContainText("Hand 1 finished");
  await expect(page.locator(".match-desk[data-turn]")).toHaveCount(0);
  await expect(result).toContainText("Alex wins the pot");
  await expect(result).toContainText("Two pair");
  await expect(result.locator(".playing-card")).toHaveCount(2);
  await expect(page.locator(".poker-orbit-seat[data-self=true] .playing-card")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Next hand in/ })).toBeDisabled();
  await page.clock.fastForward(5000);
  await expect(page.getByRole("button", { name: "Next hand", exact: true })).toBeEnabled();
});

for (const width of [390, 844, 1440])
  test("Poker seat counts fit " + width, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });

    for (const [count, state] of [
      [2, "heads-up"],
      [3, "3-players"],
      [4, "4-players"],
      [5, "5-players"],
      [6, "playing"],
    ] as const) {
      await page.goto("/design-preview/poker?state=" + state);
      await expect(page.locator(".poker-orbit-seat")).toHaveCount(count, { timeout: 30000 });

      const overlaps = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll(".poker-orbit-seat,.cards-center")].map((el) =>
          el.getBoundingClientRect(),
        );

        return boxes.flatMap((a, i) =>
          boxes
            .slice(i + 1)
            .filter(
              (b) =>
                Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2,
            ),
        );
      });

      expect(overlaps).toEqual([]);
    }
  });

test("Poker demo player selector updates table seats", async ({ page }) => {
  await page.goto("/design-preview/poker");
  await page.getByText("Demo controls", { exact: true }).click();

  for (const count of [2, 3, 4, 5, 6]) {
    await page.getByLabel("Number of players").selectOption(String(count));
    await expect(page.locator(".poker-orbit-seat")).toHaveCount(count);
    await expect(page.getByRole("img", { name: "Hidden card", exact: true })).toHaveCount(
      (count - 1) * 2,
    );
  }
});

test("Poker spectator view has no game options or action panel", async ({ page }) => {
  await page.goto("/design-preview/poker?state=spectator");
  await expect(page.locator(".poker-orbit-seat")).toHaveCount(6);
  await expect(
    page.locator(".card-controls,.desk-host-controls,.desk-replay-controls"),
  ).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Hidden card", exact: true })).toHaveCount(12);
});

test("Spectator output opens one live game without directory controls", async ({ page }) => {
  await page.goto("/design-preview/spectator?state=watch-poker");
  await expect(page.locator(".match-desk[data-stream=true]")).toBeVisible();
  await expect(
    page.locator(".watch-card,.watch-open,.site-bar,.desk-options,.desk-bar button"),
  ).toHaveCount(0);
});

test("Poker card sounds follow the visible board and respect mute", async ({ page }) => {
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createBufferSource;
    Object.defineProperty(window, "pokerCardSounds", { value: 0, writable: true });
    AudioContext.prototype.createBufferSource = function () {
      window.pokerCardSounds = (window.pokerCardSounds ?? 0) + 1;

      return original.call(this);
    };
  });
  await page.goto("/design-preview/poker");
  await expect(page.locator(".poker-seat-status").filter({ hasText: "Your turn" })).toBeVisible();
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByLabel("Demo state", { exact: true }).selectOption("river");
  await expect.poll(() => page.evaluate(() => window.pokerCardSounds)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Mute sound effects" }).click();

  const before = await page.evaluate(() => window.pokerCardSounds);

  await page.getByLabel("Demo state", { exact: true }).selectOption("showdown");
  await expect(page.locator(".poker-hand-result")).toContainText("wins the pot");
  expect(await page.evaluate(() => window.pokerCardSounds)).toBe(before);
});

test("Poker turn clock counts down, survives UI changes, and stops between hands", async ({
  page,
}) => {
  const start = Date.now();
  await page.clock.install({ time: start });
  // Hold fake time still while the page loads so slow startup does not consume turn seconds.
  await page.clock.pauseAt(start + 1000);
  await page.goto("/design-preview/poker");
  const timer = page.getByLabel("Turn time remaining", { exact: true });
  await expect(timer).toHaveText("0:45");
  await page.clock.fastForward(5000);
  await expect(timer).toHaveText("0:40");
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByLabel("Number of players").selectOption("3");
  await expect(timer).toHaveText("0:40");
  await page.clock.fastForward(35000);
  await expect(timer).toHaveText("0:05");
  await expect(timer).toHaveAttribute("data-urgent", "true");
  await page.clock.fastForward(6000);
  await expect(timer).toHaveText("0:00");
  await page.getByLabel("Demo state", { exact: true }).selectOption("showdown");
  await expect(timer).toHaveCount(0);
  await page.getByLabel("Demo state", { exact: true }).selectOption("preflop");
  await expect(timer).toHaveText("0:45");
});
