import { expect, test, type Page } from "@playwright/test";

const HOME_HEADING = {
  en: /^Can your AI beat you at/,
  "zh-CN": /^你的 AI 能在/,
} as const;

/**
 * Assert the heading the visitor actually reads.
 *
 * The landing hero ships both languages in the markup and lets CSS pick one, so
 * `toHaveText` (which reads `textContent`) would see both. `innerText` reflects
 * what is rendered, which is what this suite is about.
 */
async function expectHeading(page: Page, text: RegExp) {
  await expect
    .poll(() => page.locator("h1").first().innerText(), { timeout: 10_000 })
    .toMatch(text);
}

/** Choose a language the way the switch does, then wait for the copy to settle. */
async function pickLanguage(page: Page, locale: "en" | "zh-CN") {
  await page.getByTestId("locale-switch").click();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

test.describe("language switch", () => {
  test("starts in English because the suite pins it", async ({ page }) => {
    await page.goto("/");

    await expectHeading(page, HOME_HEADING.en);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("locale-switch")).toHaveText("EN");
  });

  test("switches the nav, page copy and document language", async ({ page }) => {
    await page.goto("/");
    await pickLanguage(page, "zh-CN");

    await expectHeading(page, HOME_HEADING["zh-CN"]);
    // Navigation is a separate React island: this proves the switch crossed it.
    await expect(page.getByRole("navigation", { name: "主导航" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "游戏如何运作" })).toBeVisible();
    await expect(page.getByRole("button", { name: "下一步" })).toBeVisible();
    await expect(page.getByTestId("locale-switch")).toHaveText("中");
  });

  test("keeps the choice on reload", async ({ page }) => {
    await page.goto("/");
    await pickLanguage(page, "zh-CN");
    await page.reload();

    await expectHeading(page, HOME_HEADING["zh-CN"]);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  });

  test("survives an in-site navigation", async ({ page }) => {
    await page.goto("/");
    await pickLanguage(page, "zh-CN");
    await page.getByRole("navigation", { name: "主导航" }).first().getByRole("link").last().click();

    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByTestId("locale-switch")).toHaveText("中");
  });

  test("translates the game library and room entry rules", async ({ page }) => {
    await page.goto("/play");
    await pickLanguage(page, "zh-CN");
    await expect(page.getByRole("heading", { name: "今天玩什么？" })).toBeVisible();
    await expect(page.getByRole("group", { name: "筛选游戏" })).toBeVisible();
    await expect(page.getByRole("link", { name: "开始黑白棋" })).toBeVisible();
    await page.getByRole("link", { name: "开始Connect 4" }).first().click();
    await expect(page.getByRole("heading", { name: "游戏规则" })).toBeVisible();
    await expect(page.getByText("双方入座。两名玩家共用一个七列六行的棋盘。")).toBeVisible();
  });

  test("translates sign-in without bypassing verification", async ({ page }) => {
    await page.route("**/api/v1/auth/users/me", (route) =>
      route.fulfill({ json: { user: null } }),
    );
    await page.goto("/login");
    await pickLanguage(page, "zh-CN");
    await expect(page.getByRole("heading", { name: "登录" })).toBeVisible();
    await expect(page.getByRole("button", { name: "使用 GitHub 继续" })).toBeVisible();
    await expect(page.getByLabel("邮箱地址")).toBeVisible();
  });

  test("translates account session controls", async ({ page }) => {
    await page.route("**/api/v1/auth/users/me", (route) =>
      route.fulfill({ json: { user: { id: "test-user", email: "test@example.test", name: null, gamertag: "Alex", gamertag_selected: 1 } } }),
    );
    await page.goto("/profile");
    await pickLanguage(page, "zh-CN");
    await expect(page.getByRole("heading", { name: "会话" })).toBeVisible();
    await page.getByRole("button", { name: "退出所有浏览器" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "退出所有浏览器？" })).toBeVisible();
  });

  test("translates MCP setup while preserving the copied command", async ({ page }) => {
    await page.goto("/connect-ai");
    await pickLanguage(page, "zh-CN");
    await expect(page.getByRole("heading", { name: "通过远程 MCP 连接 AI 智能体" })).toBeVisible();
    await expect(page.getByRole("button", { name: "复制提示词" })).toBeVisible();
    await expect(page.getByRole("region", { name: "设置命令" })).toContainText("codex mcp add llmgames --url");
  });

  test("translates AI specification guidance without altering MCP examples", async ({ page }) => {
    await page.goto("/ai-spec");
    await pickLanguage(page, "zh-CN");
    await expect(page.getByRole("heading", { name: "AI 如何游戏" })).toBeVisible();
    await page.getByRole("tab", { name: "MCP" }).click();
    await expect(page.getByLabel("席位视图示例")).toBeVisible();
    await expect(page.getByText("通过 MCP 发送")).toBeVisible();
    await page.getByText("连接与 MCP 定义").click();
    await expect(page.getByText(/每个任务调用一次 agent_claim/)).toBeVisible();
    await expect(page.getByLabel("wait_for_turn 结果", { exact: true })).toContainText("your_turn");
  });
});

test.describe("first visit", () => {
  test("keeps the pre-rendered page visible when hydration is unavailable", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, locale: "zh-CN", storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    try {
      await page.route("**/_astro/*.js", (route) => route.abort());
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.locator("main")).toBeVisible();
      expect(await page.locator("main").evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    } finally {
      await context.close();
    }
  });

  /**
   * Visible copy that is still correct when the interface is Chinese: the games
   * keep their shipped names. Anything else in Latin letters is a first-paint
   * gap, and this test fails with the offending strings instead of waiting for a
   * reader to notice a half-translated screen.
   */
  const LATIN_ALLOWED = new Set([
    "Connect 4",
    "Poker",
    "Checkers",
    "Battleship",
    "Contexto",
    "Reversi",
    "Pokémon",
    "Codenames",
  ]);

  /**
   * Latin-only copy a visitor can read inside `scope` on the first screen.
   *
   * Clipped screen-reader text, the off-screen skip link, the brand lockup, the
   * language the stylesheet hides and anything below the fold are left out. Game
   * names keep their shipped spelling in Chinese, so `allowGameNames` drops
   * those; anything else is a first-paint gap and fails with its own text.
   */
  async function untranslated(page: Page, scope: string, allowGameNames: boolean) {
    const copy = await page.evaluate((selector) => {
      const out: string[] = [];

      for (const root of document.querySelectorAll(selector)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();

          const host = node.parentElement;

          if (!text || !host) continue;

          const style = getComputedStyle(host);

          const box = host.getBoundingClientRect();

          const hidden =
            host.closest(".sr-only, .site-skip, .site-logo") !== null ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            box.bottom < 0 ||
            box.top > innerHeight ||
            (box.width === 0 && box.height === 0);

          if (hidden) continue;

          out.push(text);
        }
      }

      return out;
    }, scope);

    return copy.filter(
      (text) =>
        /[A-Za-z]{3,}/.test(text) &&
        !/[\u4e00-\u9fff]/.test(text) &&
        !(allowGameNames && LATIN_ALLOWED.has(text)),
    );
  }

  test("paints the first screen in Chinese before hydration", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      locale: "zh-CN",
      viewport: { width: 1440, height: 900 },
      storageState: { cookies: [], origins: [] },
    });

    try {
      // Keep the two inline init scripts so `data-locale` is written, drop every
      // other script so nothing hydrates. Works against a build and against dev,
      // because both serve stylesheets separately from the island bundles.
      await context.route("**/*", (route) => {
        const path = new URL(route.request().url()).pathname;
        const initScript = path === "/locale-init.js" || path === "/theme-init.js";

        return route.request().resourceType() === "script" && !initScript
          ? route.abort()
          : route.continue();
      });

      const page = await context.newPage();

      await page.goto("/", { waitUntil: "load" });
      await expect(page.locator("html")).toHaveAttribute("data-locale", "zh-CN");
      await expect(page.locator("h1").first()).toContainText("你的 AI 能在");
      await expect(page.locator(".site-bar .site-nav")).toContainText("首页");
      await expect(page.getByRole("link", { name: "挑战 AI" })).toBeVisible();

      const homeLatin = await untranslated(page, ".site-bar, .landing-hero", true);

      expect(homeLatin, `untranslated first-screen copy on / : ${homeLatin.join(" | ")}`).toEqual([]);

      await page.goto("/play", { waitUntil: "load" });
      await expect(page.locator("h1").first()).toContainText("今天玩什么");
      await expect(page.locator(".library-join-label")).toContainText("有房间码");
      await expect(page.locator(".library-join-submit")).toContainText("加入房间");
      await expect(page.locator(".library-series")).toContainText("创建系列赛");
      await expect(page.getByRole("button", { name: /全部游戏/ })).toBeVisible();

      const playLatin = await untranslated(page, ".site-bar, .library-head, .library-toolbar", false);

      expect(playLatin, `untranslated first-screen copy on /play : ${playLatin.join(" | ")}`).toEqual([]);
    } finally {
      await context.close();
    }
  });
  test("follows a Chinese browser", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      locale: "zh-CN",
      storageState: { cookies: [], origins: [] },
    });

    const page = await context.newPage();

    try {
      await page.goto("/");

      // locale-init.js runs synchronously in <head>, so the document language is
      // already right before React hydrates.
      expect(await page.evaluate(() => document.documentElement.dataset.locale)).toBe("zh-CN");
      await expectHeading(page, HOME_HEADING["zh-CN"]);
    } finally {
      await context.close();
    }
  });

  test("falls back to English for any other browser", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      locale: "de-DE",
      storageState: { cookies: [], origins: [] },
    });

    const page = await context.newPage();

    try {
      await page.goto("/");

      expect(await page.evaluate(() => document.documentElement.dataset.locale)).toBe("en");
      await expectHeading(page, HOME_HEADING.en);
    } finally {
      await context.close();
    }
  });

  test("shows the Chinese content after hydration", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      locale: "zh-CN",
      storageState: { cookies: [], origins: [] },
    });

    const page = await context.newPage();

    try {
      await page.goto("/");

      await expectHeading(page, HOME_HEADING["zh-CN"]);
    } finally {
      await context.close();
    }
  });

  test("shows English to an English visitor", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      locale: "en-US",
      storageState: { cookies: [], origins: [] },
    });

    const page = await context.newPage();

    try {
      await page.goto("/");

      await expectHeading(page, HOME_HEADING.en);
    } finally {
      await context.close();
    }
  });
});

for (const width of [390, 1440]) {
  for (const locale of ["en", "zh-CN"] as const) {
    test(`home layout at ${width}px in ${locale}`, async ({ browser, baseURL }, info) => {
      const context = await browser.newContext({
        baseURL,
        viewport: { width, height: 900 },
        locale,
        storageState: { cookies: [], origins: [] },
        reducedMotion: "reduce",
      });

      const page = await context.newPage();

      try {
        await page.goto("/");
        await expectHeading(page, HOME_HEADING[locale]);
        await expect(page.getByTestId("locale-switch")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: info.outputPath(`home-${locale}-${width}.png`) });
      } finally {
        await context.close();
      }
    });
  }
}

test.describe("in-match copy", () => {
  test("translates the match desk and the game-over headline", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      locale: "zh-CN",
      storageState: { cookies: [], origins: [] },
    });

    const page = await context.newPage();

    try {
      await page.goto("/design-preview/battleship");
      await expect(page.getByRole("region", { name: "棋盘" })).toBeVisible();
      await expect(page.getByRole("banner", { name: /对局控制/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "离开游戏" })).toBeVisible();
      await expect(page.getByRole("region", { name: "玩家" })).toBeVisible();

      await page.goto("/design-preview/battleship?state=win");
      await expect(
        page.getByRole("heading", { level: 1, name: /你赢了|获胜|对局结束|平局/ }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
