import { expect, test, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function appearance(avatar: Locator) {
  return {
    "shape": await avatar.getAttribute("data-avatar-shape"),
    palette: await avatar.getAttribute("data-avatar-palette"),
    holes: await avatar.getAttribute("data-avatar-holes"),
  };
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  test(`profile uses a generated avatar at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/design-preview/profile?state=jev-disconnected");
    await expect(
      page.locator(".profile-identity").getByRole("img", { name: "Alex avatar", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".profile-identity .player-avatar .doodle-face")).toHaveCount(1);
    await expect(page.getByText("Pick a shape and color")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save avatar" })).toHaveCount(0);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath("profile-avatar.png") });
  });

test("a human keeps the same avatar in profile, game, and spectate", async ({ page }) => {
  await page.goto("/design-preview/profile?state=jev-disconnected");
  const profile = await appearance(page.locator(".profile-identity .player-avatar"));
  await page.goto("/design-preview/connect4");

  const game = await appearance(
    page.getByRole("img", { name: "Alex avatar", exact: true }).first(),
  );

  await page.goto("/design-preview/spectator?state=watch-connect4");

  const spectate = await appearance(
    page.getByRole("img", { name: "Alex avatar", exact: true }).first(),
  );

  expect(game).toEqual(profile);
  expect(spectate).toEqual(profile);
});

test("an agent keeps the same avatar by codename", async ({ page }) => {
  await page.goto("/design-preview/agent-log");

  const log = await appearance(
    page.getByRole("img", { name: "BrightRook avatar", exact: true }).first(),
  );

  await page.goto("/design-preview/connect4");

  const game = await appearance(
    page.getByRole("img", { name: "BrightRook avatar", exact: true }).first(),
  );

  expect(game).toEqual(log);
});

test("each doodle has its own hole mask when several avatars share a page", async ({ page }) => {
  await page.goto("/design-preview/contexto?state=broadcast");
  await expect(page.locator(".contexto-stage .player-avatar")).toHaveCount(6);

  const masks = await page
    .locator(".player-avatar mask")
    .evaluateAll((elements) => elements.map((element) => element.id));

  expect(masks.length).toBeGreaterThan(1);
  expect(new Set(masks).size).toBe(masks.length);

  for (const avatar of await page.locator(".player-avatar").all()) {
    const id = await avatar.locator("mask").getAttribute("id");
    await expect(avatar.locator(".doodle-face > path").first()).toHaveAttribute(
      "mask",
      `url(#${id})`,
    );
  }
});
