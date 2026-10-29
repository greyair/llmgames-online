import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ reducedMotion: "no-preference" });

test("public landing hydrates without markup errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("hydration-mismatch"))
      errors.push(message.text());
  });
  await page.goto("/design-preview/public/landing");
  await expect(page.locator(".landing-rotator")).toHaveAttribute("data-running", "true");
  await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [390, 1440])
  for (const theme of ["light", "dark"])
    test(`landing hero ${theme} ${width}`, async ({ page }, info) => {
      await page.addInitScript((value) => localStorage.setItem("llmgames-theme", value), theme);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/design-preview/public/landing");
      const hero = page.locator(".landing-hero");
      await expect(hero).toBeVisible();
      await expect(
        hero.getByRole("heading", { level: 1, name: "Can your AI beat you at Connect 4?" }),
      ).toBeVisible();
      await expect(hero.locator("h1")).not.toHaveCSS("text-align", "center");
      await expect(hero.getByRole("link", { name: "Challenge an AI" })).toBeVisible();
      await expect(hero.getByRole("link", { name: "Bring your agent" })).toBeVisible();
      await expect(hero.locator(".eyebrow,.landing-kicker")).toHaveCount(0);
      const challenges = page.locator(".landing-challenge");
      expect(await challenges.count()).toBeGreaterThan(1);
      await expect(challenges.first()).toHaveAttribute("href", /connect4/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(page.locator(".landing-rotator")).toHaveAttribute("data-running", "true");
      await page.waitForFunction(() =>
        document
          .getAnimations()
          .every(
            (animation) =>
              animation.playState !== "running" ||
              animation.effect?.getComputedTiming().iterations === Infinity,
          ),
      );

      const audit = await new AxeBuilder({ page })
        .include(".landing-hero")
        .include(".landing-challenges")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();

      expect(audit.violations).toEqual([]);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: info.outputPath("hero.png"), fullPage: true });
    });

test("hero rotates the challenged game and honors reduced motion", async ({ page }) => {
  await page.clock.install();
  await page.goto("/design-preview/public/landing");

  const rotator = page.locator(".landing-rotator"),
    active = rotator.locator("[data-active=true]");

  await page.clock.runFor(1000);
  await expect(rotator).toHaveAttribute("data-running", "true");
  // The question mark is translated punctuation and sits outside the rotator, so
  // the words swap without the sentence ending changing between languages.
  await expect(active).toHaveText("Connect 4");
  await page.clock.fastForward(2700);
  await expect(active).toHaveText("Poker");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(rotator).not.toHaveAttribute("data-running", "true");
  await page.clock.fastForward(6000);
  await expect(active).toHaveText("Poker");
});

test("reduced motion shows a single challenged game", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await page.goto("/design-preview/public/landing");
  await page.clock.fastForward(8000);
  await expect(page.locator(".landing-rotator [data-active=true]")).toHaveText("Connect 4");
  await expect(page.locator(".landing-rotator [data-active=true]")).toHaveCount(1);
});
