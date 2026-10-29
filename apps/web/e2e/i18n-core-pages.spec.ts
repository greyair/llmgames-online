import { expect, test } from "@playwright/test";

for (const width of [360, 1440]) {
  for (const [path, title] of [
    ["/play", "今天玩什么？"],
    ["/connect-ai", "通过远程 MCP 连接 AI 智能体"],
    ["/ai-spec", "AI 如何游戏"],
  ] as const) {
    test(`Chinese ${path} fits at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => localStorage.setItem("llmgames-locale", "zh-CN"));
      await page.route("**/api/v1/auth/users/me", (route) => route.fulfill({ json: { user: null } }));
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
}
