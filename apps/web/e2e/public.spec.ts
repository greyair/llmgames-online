import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  for (const path of ["watch", "setup", "games/connect4", "privacy", "terms"])
    test(`${path} ${viewport.width}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      const response = await page.goto("/" + path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );

      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();

      expect(
        audit.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
      ).toEqual([]);

      if (!["privacy", "terms"].includes(path))
        await page.screenshot({ path: info.outputPath("page.png"), fullPage: true });
    });

test("public content is present before hydration", async ({ request }) => {
  for (const path of ["/watch", "/setup", "/privacy", "/terms", "/games/reversi"]) {
    const html = await (await request.get(path)).text();

    // The heading text may sit inside language spans, so strip tags before
    // checking that the server actually shipped readable copy.
    const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";

    expect(heading.replace(/<[^>]+>/g, "").trim().length, path).toBeGreaterThan(0);
    expect(html, path).toContain('rel="canonical"');
  }

  const connect = await (await request.get("/connect-ai")).text();
  expect(connect).toMatch(/href="\/connect-ai"[^>]*aria-current="page"/);
});

test("sitemap contains only indexable public pages", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();

  for (const path of ["/", "/play", "/setup", "/privacy", "/terms", "/games/reversi"])
    expect(sitemap).toContain(`<loc>http://localhost:3000${path}</loc>`);

  for (const path of [
    "/watch",
    "/login",
    "/onboarding",
    "/profile",
    "/agent-log",
    "/history",
    "/reversi",
    "/connect-ai",
  ])
    expect(sitemap).not.toContain(`<loc>http://localhost:3000${path}</loc>`);
});

test("account and game-room entry pages stay out of search", async ({ request }) => {
  for (const path of ["/login", "/onboarding", "/profile", "/agent-log", "/history", "/reversi"]) {
    const html = await (await request.get(path)).text();
    expect(html).toContain('name="robots" content="noindex, follow"');
  }
});

test("retired watch page has no Twitch player or stream links", async ({ page }) => {
  await page.goto("/watch");
  await expect(page.getByRole("heading", { name: "Broadcasts have ended" })).toBeVisible();
  await expect(page.locator("iframe, a[href*='twitch.tv']")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Browse games" })).toBeVisible();
});

test("MCP prompt and all remote setup commands copy correctly", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/setup");
  await page.getByRole("button", { name: "Copy prompt", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(
      "Add the llmgames remote MCP server to this agent using http://localhost:6787/api/v1/mcp and name it llmgames. Use the native MCP setup flow. If it opens OAuth in my default browser, tell me to complete it there and do not open the authorization URL in another browser. Wait for the CLI callback, then verify authentication.",
    );

  for (const [name, expected, note] of [
    ["Codex", "codex mcp add", "codex mcp login llmgames"],
    ["Claude", "claude mcp add", "Do not reopen the authorization URL elsewhere"],
    ["Gemini", "gemini mcp add", "Do not reopen the authorization URL elsewhere"],
    ["Cursor", "mcpServers", "callback verification"],
    ["Grok", "http://localhost:6787/api/v1/mcp", "callback verification"],
  ]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText(expected!);
    await expect(page.getByRole("tabpanel")).toContainText(note!);
    await page.getByRole("button", { name: "Copy command", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(expected!);
  }

  await page.getByRole("tab", { name: "Codex", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Claude", exact: true })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("claude mcp add");
  await expect(page.locator(".connection-prompt")).toHaveCSS("font-family", /Geist Mono/);
});

test("social metadata points to a real 1200 by 630 image", async ({ request }) => {
  const html = await (await request.get("/")).text();
  expect(html).toContain(
    'property="og:image" content="http://localhost:3000/og/llmgames-dither-v1.png"',
  );
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).not.toContain("/fonts/manrope");
  expect(html).not.toContain("fonts-ready.js");
  expect(html).not.toContain('href="/fonts.css"');
  expect(html).toContain("astro-view-transitions-enabled");
  const response = await request.get("/og/llmgames-dither-v1.png");
  expect(response.status()).toBe(200);
  const png = await response.body();
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
});
