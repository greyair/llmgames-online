import type {} from "./browser-state";
import { test, expect } from "@playwright/test";
import { waitForApp } from "./wait-for-app";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  for (const spectator of [false, true])
    test(`sunken fleet ${spectator ? "spectator" : "player"} ${viewport.width}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(
        spectator
          ? "/design-preview/spectator?state=watch-battleship-sunk-ship"
          : "/design-preview/battleship?state=sunk-ship",
      );
      await expect(page.locator("[data-sunken-ship]")).toHaveCount(2);

      if (viewport.width <= 650 && spectator) {
        await expect(page.getByRole("img", { name: "Destroyer sunk", exact: true })).toHaveCount(1);
        await page.getByRole("button", { name: "BrightRook", exact: true }).click();
        await expect(page.getByRole("img", { name: "Cruiser sunk", exact: true })).toHaveCount(1);
      } else {
        await expect(page.getByRole("img", { name: "Cruiser sunk", exact: true })).toHaveCount(1);

        if (viewport.width <= 650)
          await page.getByRole("button", { name: "Your fleet", exact: true }).click();
        await expect(page.getByRole("img", { name: "Destroyer sunk", exact: true })).toHaveCount(1);
      }

      await expect(page.locator(".sea-fleet-status")).toHaveCount(2);
      await expect(page.locator(".sea-fleet-status .fleet-ship-art")).toHaveCount(10);
      await expect(page.locator(".ship-sunk-announcement")).toHaveCount(0);

      if (spectator) {
        await expect(page.locator(".sea-grid .doodle-ship")).toHaveCount(2);
        await expect(page.locator(".sea > header")).toHaveCount(0);
        await expect(page.locator(".sea-fleet-summary[data-column=true]")).toHaveCount(2);
      } else
        await expect(page.locator(".sea[data-board=target] .sea-grid .doodle-ship")).toHaveCount(1);

      const bounds = await page
        .locator(spectator ? ".sea-fleet-summary[data-column=true], .sea-grid" : ".sea > header")
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const r = node.getBoundingClientRect();

            return {
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
              scroll: node.scrollWidth,
              width: node.clientWidth,
            };
          }),
        );

      for (const bound of bounds) {
        expect(bound.bottom).toBeLessThanOrEqual(viewport.height);
        expect(bound.left).toBeGreaterThanOrEqual(0);
        expect(bound.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(bound.scroll).toBeLessThanOrEqual(bound.width + 2);
      }

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        viewport.height,
      );
      await page.screenshot({
        path: `../../artifacts/sunken-ships/${spectator ? "spectator" : "player"}-${viewport.width}.png`,
      });
    });

for (const spectator of [false, true])
  test(`new sink animates once with sound, respects mute, and reconnect stays quiet ${spectator ? "spectator" : "player"}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(() => {
      localStorage.setItem("llmgames-interface-sound", "on");
      window.sinkNotes = 0;
      // The synthesized sink cue is the only sound whose oscillator glides from 147 Hz down to 60 Hz.
      const startValues = new WeakMap<AudioParam, number>();
      const set = AudioParam.prototype.setValueAtTime;
      AudioParam.prototype.setValueAtTime = function (value, time) {
        startValues.set(this, value);

        return set.call(this, value, time);
      };

      const ramp = AudioParam.prototype.exponentialRampToValueAtTime;
      AudioParam.prototype.exponentialRampToValueAtTime = function (value, time) {
        if (value === 60 && startValues.get(this) === 147)
          window.sinkNotes = (window.sinkNotes ?? 0) + 1;

        return ramp.call(this, value, time);
      };
    });
    await page.goto(
      spectator ? "/design-preview/spectator?state=watch-battleship" : "/design-preview/battleship",
    );
    await waitForApp(page);
    await page.getByText("Demo controls", { exact: true }).click();
    const firstBoard = spectator ? "own" : "target";

    // `data-sinking` only exists while the sink animation plays. Start waiting
    // before the click so a fast animation cannot finish unseen.
    const cruiserSinking = page
      .locator(`.sea[data-board=${firstBoard}] [data-sunken-ship=cruiser][data-sinking=true]`)
      .waitFor({ state: "visible", timeout: 10000 });

    await page.getByRole("button", { name: "Preview sinking", exact: true }).click();
    await cruiserSinking;
    await expect(page.locator(".ship-sunk-announcement")).toHaveText("Cruiser sunk");
    await expect.poll(() => page.evaluate(() => window.sinkNotes)).toBe(1);
    await page.screenshot({
      path: `../../artifacts/sunken-ships/${spectator ? "spectator" : "player"}-sinking.png`,
    });
    await expect(page.locator(".ship-sunk-announcement")).toHaveCount(0, { timeout: 4000 });
    expect(await page.evaluate(() => window.sinkNotes)).toBe(1);

    // The broadcast operator owns its own sound toggle; normal spectator rooms expose the shared one.
    if (!spectator) await page.getByRole("button", { name: "Mute sound effects" }).click();
    else await page.evaluate(() => localStorage.setItem("llmgames-interface-sound", "off"));

    const destroyerSinking = page
      .locator(
        `.sea[data-board=${spectator ? "target" : "own"}] [data-sunken-ship=destroyer][data-sinking=true]`,
      )
      .waitFor({ state: "visible", timeout: 10000 });

    await page.getByRole("button", { name: "Preview sinking", exact: true }).click();
    await destroyerSinking;
    await expect(page.locator(".ship-sunk-announcement")).toHaveCount(0, { timeout: 4000 });
    expect(await page.evaluate(() => window.sinkNotes)).toBe(1);
    await page.goto(
      spectator
        ? "/design-preview/spectator?state=watch-battleship-sunk-ship"
        : "/design-preview/battleship?state=sunk-ship",
    );
    await expect(page.locator("[data-sunken-ship]")).toHaveCount(2);
    await expect(page.locator("[data-sinking=true]")).toHaveCount(0);
    expect(await page.evaluate(() => window.sinkNotes)).toBe(0);
  });

test("room spectators keep sunk fleets visible with reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/design-preview/battleship?state=spectator-sunk-ship");
  await expect(page.locator(".sea-grid .doodle-ship")).toHaveCount(2);
  await expect(page.locator(".sea-fleet-status")).toHaveCount(2);
  await expect(page.locator(".sea-fleet-status .fleet-ship-art")).toHaveCount(10);
  await page.screenshot({ path: "../../artifacts/sunken-ships/room-spectator-1440.png" });
  await page.goto("/design-preview/battleship?state=spectator");
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByRole("button", { name: "Preview sinking", exact: true }).click();
  const hull = page.locator("[data-sinking=true] .wreck-hull");
  await expect(hull).toBeVisible();
  expect(await hull.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await page.screenshot({ path: "../../artifacts/sunken-ships/reduced-motion.png" });
});
