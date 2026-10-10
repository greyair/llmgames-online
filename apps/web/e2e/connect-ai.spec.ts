import { test, expect } from "@playwright/test";

for (const width of [320, 390, 640, 960, 1024, 1440])
  for (const theme of ["light", "dark"])
    test(`Connect AI remains readable at ${width} in ${theme}`, async ({ page, context }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.addInitScript((value) => localStorage.setItem("llmgames-theme", value), theme);
      await page.route("**/api/v1/auth/users/me", (route) =>
        route.fulfill({ json: { user: null } }),
      );
      await page.goto("/connect-ai");
      await expect(page.getByRole("button", { name: "Copy prompt" })).toBeEnabled();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const nav = page.locator(width <= 760 ? ".site-dock" : ".site-bar .site-nav");
      await expect(nav.getByRole("link", { name: "Connect AI" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      // A static panel made its absolute border layer cover the mobile viewport.
      expect(
        await page.locator(".connect-aside").evaluate((element) => {
          const panel = element.getBoundingClientRect();
          const border = getComputedStyle(element, "::before");

          return {
            position: getComputedStyle(element).position,
            width: parseFloat(border.width),
            panelWidth: panel.width,
          };
        }),
      ).toMatchObject({ position: width <= 960 ? "relative" : "sticky" });

      const border = await page.locator(".connect-aside").evaluate((element) => ({
        width: parseFloat(getComputedStyle(element, "::before").width),
        panelWidth: element.getBoundingClientRect().width,
      }));

      expect(border.width).toBeLessThanOrEqual(border.panelWidth + 1);
      await page.getByRole("button", { name: "Copy prompt" }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
        process.env.PUBLIC_MCP_URL || "http://localhost:6787/api/v1/mcp",
      );

      for (const host of ["Codex", "Claude", "Gemini", "Cursor", "Grok"]) {
        const tab = page.getByRole("tab", { name: host, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        const command = page.getByRole("region", { name: "Setup command" });
        expect(
          await command.evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
        await page.getByRole("button", { name: "Copy command" }).click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
          await command.locator("code").innerText(),
        );
        await expect(page.getByRole("button", { name: "Copy command" })).toBeVisible();
      }

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByRole("tab", { name: "Codex", exact: true }).click();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath(`connect-ai-${width}-${theme}.png`),
        fullPage: true,
      });
    });
