import { test, expect } from "@playwright/test";

for (const width of [390, 1280])
  test(`TypeSafe settings at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/design-preview/profile?state=jev-disconnected");
    const section = page.getByRole("region", { name: "Play with Jev" });
    await expect(section.getByText("Not connected", { exact: true })).toBeVisible();
    const keyHelp = section.getByRole("button", { name: "About TypeSafe API key" });
    await expect(section.getByRole("tooltip")).toHaveCount(0);
    await keyHelp.focus();
    await expect(section.getByRole("tooltip")).toContainText("encrypted");
    await keyHelp.press("Escape");
    await expect(section.getByRole("tooltip")).toHaveCount(0);
    await section.getByRole("button", { name: "About Daily request limit" }).click();
    await expect(section.getByRole("tooltip")).toContainText("One move can use several requests");
    await section.getByLabel("Daily request limit", { exact: true }).click();
    await expect(section.getByRole("tooltip")).toHaveCount(0);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/llmgames-typesafe-form-${width}.png`, fullPage: true });
    await section
      .getByLabel("TypeSafe API key", { exact: true })
      .fill("preview-key-not-a-real-secret");
    const dailyLimit = section.getByLabel("Daily request limit", { exact: true });
    await dailyLimit.fill("");
    await expect(dailyLimit).toHaveValue("");
    await section.getByRole("checkbox").check();
    await expect(
      section.getByRole("button", { name: "Connect TypeSafe", exact: true }),
    ).toBeDisabled();
    await dailyLimit.fill("500");
    await expect(
      section.getByRole("button", { name: "Connect TypeSafe", exact: true }),
    ).toBeEnabled();
    await section.getByRole("button", { name: "Connect TypeSafe", exact: true }).click();
    await expect(section.getByText("Connected", { exact: true })).toBeVisible();
    await expect(section.getByText("0 / 500", { exact: true })).toBeVisible();
    await expect(section.getByLabel("TypeSafe API key", { exact: true })).toHaveCount(0);
    await section.getByRole("button", { name: "Replace key or limit" }).click();
    await expect(section.getByLabel("TypeSafe API key", { exact: true })).toHaveValue("");
    await section.getByRole("button", { name: "Cancel", exact: true }).click();
    await section.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/llmgames-typesafe-${width}.png`, fullPage: true });
    await section.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(section.getByText("Not connected", { exact: true })).toBeVisible();
  });
