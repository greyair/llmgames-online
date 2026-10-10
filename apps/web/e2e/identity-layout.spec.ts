import { test, expect } from "@playwright/test";

async function stacked(page: import("@playwright/test").Page) {
  return page.locator(".player-name-label").evaluateAll((labels) =>
    labels
      .filter((label) => {
        const small = label.querySelector("small");

        if (!small) return false;
        const style = getComputedStyle(label);

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          label.getClientRects().length > 0
        );
      })
      .every((label) => {
        const strong = label.querySelector("strong")?.getBoundingClientRect();
        const small = label.querySelector("small")?.getBoundingClientRect();

        return Boolean(strong && small && small.top >= strong.bottom - 2);
      }),
  );
}

function visibleDetail(page: import("@playwright/test").Page, text: string) {
  return page
    .locator(".player-name-label small")
    .filter({ hasText: text })
    .locator("visible=true")
    .first();
}

const screens = [
  { path: "/design-preview/connect4", clip: ".desk-players" },
  { path: "/design-preview/connect4?state=lobby-host", clip: ".lobby-setup" },
  { path: "/design-preview/codenames", clip: ".word-workspace" },
  { path: "/design-preview/poker", clip: ".poker-workspace" },
  { path: "/design-preview/pokemon", clip: ".poke-workspace" },
  { path: "/design-preview/pokemon?state=spectator", clip: ".poke-workspace" },
  { path: "/design-preview/spectator", clip: ".contexto-replay" },
  { path: "/design-preview/contexto", clip: ".contexto-rivals" },
  { path: "/design-preview/contexto?state=replay-ended", clip: ".contexto-replay" },
  { path: "/design-preview/spectator?state=watch-contexto", clip: ".contexto-replay" },
  { path: "/design-preview/spectator?state=watch-contexto-win", clip: ".result-summary" },
  { path: "/design-preview/components", clip: ".component-grid" },
];

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
])
  for (const screen of screens)
    test(`agent client sits under the name ${screen.path} ${viewport.width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize(viewport);
      await page.goto(screen.path);

      if (screen.path === "/design-preview/codenames" && viewport.width <= 900) {
        for (const team of ["blue", "red"])
          await page
            .getByRole("complementary", { name: `${team} team`, exact: true })
            .getByRole("button")
            .click();
      }

      await expect(visibleDetail(page, "Codex · Mika")).toBeVisible();
      await expect(
        page
          .locator(".player-name-label strong")
          .filter({ hasText: "BrightRook" })
          .locator("visible=true")
          .first(),
      ).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Human");
      expect(await stacked(page)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const target = page.locator(screen.clip).first();
      await ((await target.count()) ? target : page.locator("body")).screenshot({
        path: info.outputPath("identity.png"),
      });
    });

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`history stacks client under the agent name ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/design-preview/history");
    const row = page.locator(".history-summary").first();
    await expect(row).toContainText("SwiftAnchor");
    await expect(row).toContainText("Codex · Alex");
    expect(await stacked(page)).toBe(true);
    await row.screenshot({ path: info.outputPath("history.png") });
  });
  test(`agent log stacks client under the agent name ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/design-preview/agent-log");

    const row = page
      .locator(".agent-list .ui-card")
      .filter({ has: page.getByRole("heading", { name: "SwiftAnchor", exact: true }) });

    await expect(row).toContainText("Codex · Alex");
    await expect(row.getByRole("heading", { name: "SwiftAnchor", exact: true })).toBeVisible();
    await row.screenshot({ path: info.outputPath("agent-log.png") });
  });
}
