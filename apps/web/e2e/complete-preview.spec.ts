import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gameRouteSlug } from "@llmgames/game-catalog";
import { previewScreens, previewStates } from "../src/dev/previewCatalog";
import { designScreens, designStates } from "../src/dev/designPreview";

for (const { id, name } of previewScreens)
  test(`${name}: every GitHub state opens`, async ({ page }, info) => {
    test.setTimeout(180000);
    expect(designScreens.some(([screen]) => screen === id)).toBe(true);
    expect(designStates(id)).toEqual(previewStates(id));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/") && request.method() !== "GET") writes.push(request.url());
    });

    for (const state of previewStates(id)) {
      const response = await page.goto(`/design-preview/${gameRouteSlug(id)}?state=${state}`);
      expect(response?.status(), state).toBe(200);

      if (state === "auth-loading" || state === "loading")
        await expect(page.locator(".ui-loading-panel [role=status]"), state).toBeVisible({
          timeout: 20000,
        });
      else await expect(page.locator("h1").first(), state).toBeVisible({ timeout: 20000 });

      if (state === "auth-code") await expect(page.getByLabel("Sign-in code")).toBeVisible();

      if (state === "auth-onboarding")
        await expect(page.getByLabel("Player name", { exact: true })).toBeVisible();

      if (state === "auth-error") await expect(page.getByRole("alert")).toBeVisible();

      if (state === "leave-confirmation") await expect(page.getByRole("dialog")).toBeVisible();

      if (state === "room-setup")
        await expect(page.getByRole("button", { name: "Create room", exact: true })).toBeVisible();

      if (state === "lobby-host")
        await expect(page.getByRole("button", { name: "Start game", exact: true })).toBeVisible();

      if (["profile", "history", "setup"].includes(id) && ["playing", "featured"].includes(state))
        await page.screenshot({ path: info.outputPath(`${id}-${state}.png`), fullPage: true });
    }

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
])
  test(`landing and public preview ${viewport.width}`, async ({ page }, info) => {
    await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Can your AI beat you");
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath("landing.png"), fullPage: true });

    for (const state of ["consent", "connected", "expired"]) {
      await page.goto("/design-preview/public/oauth?state=" + state);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });

test("seeded profile and room interactions never reach the server", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/") && r.method() !== "GET") writes.push(r.url());
  });
  await page.goto("/design-preview/profile?state=jev-disconnected");
  await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Stream games I host" })).toHaveCount(0);
  await page.goto("/design-preview/setup");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start game", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".discs-board")).toBeVisible();
  expect(writes).toEqual([]);
});
