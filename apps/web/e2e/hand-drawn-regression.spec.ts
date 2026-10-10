import type {} from "./browser-state";
import { test, expect, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Waits until the nav's single sun pill has settled under `link`. */
const expectPillOn = async (nav: Locator, link: Locator) => {
  const pill = nav.locator(".site-nav-indicator");
  await expect(pill).toBeVisible();
  await expect
    .poll(async () => {
      const p = (await pill.boundingBox())!,
        l = (await link.boundingBox())!;

      return Math.abs(p.x + p.width / 2 - (l.x + l.width / 2));
    })
    .toBeLessThan(1);
};

for (const width of [360, 390, 768, 920, 1440]) {
  test(`navbar controls fit without overlap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/v1/auth/users/me", (route) =>
      route.fulfill({
        json: {
          user: {
            id: "navbar-user",
            email: "navbar@example.com",
            name: null,
            gamertag: "Alex",
            gamertag_selected: 1,
          },
        },
      }),
    );
    await page.goto("/play");
    await expect(page.getByRole("link", { name: "Profile", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const shell = await page.locator(".site-bar").boundingBox();

    const controls = await page
      .locator(".site-bar nav a:visible,.site-controls > *,.site-logo")
      .all();

    const boxes = [];

    for (const control of controls) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(shell!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(shell!.x + shell!.width);
      expect(box!.y).toBeGreaterThanOrEqual(shell!.y);
      expect(box!.y + box!.height).toBeLessThanOrEqual(shell!.y + shell!.height);
      boxes.push(box!);
    }

    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!,
          b = boxes[j]!;

        expect(
          a.x + a.width <= b.x + 0.5 ||
            b.x + b.width <= a.x + 0.5 ||
            a.y + a.height <= b.y + 0.5 ||
            b.y + b.height <= a.y + 0.5,
        ).toBe(true);
      }

    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Agent log" })).toBeVisible();
    const tabs = [];

    for (const tab of await nav.getByRole("link").all()) {
      const box = (await tab.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      tabs.push(box);
    }

    for (let i = 1; i < tabs.length; i++)
      expect(tabs[i - 1]!.x + tabs[i - 1]!.width).toBeLessThanOrEqual(tabs[i]!.x + 0.5);
  });
}

test("phones move page tabs into a bottom dock", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route("**/api/v1/auth/users/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "dock-user",
          email: "dock@example.com",
          name: null,
          gamertag: "Alex",
          gamertag_selected: 1,
        },
      },
    }),
  );
  await page.goto("/play");
  await expect(page.locator(".site-bar .site-nav")).toBeHidden();
  const dock = page.locator(".site-dock");
  await expect(dock).toBeVisible();
  const box = (await dock.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(800);
  expect(box.y).toBeGreaterThan(600);
  await expect(dock.getByRole("link", { name: "Play" })).toHaveAttribute("aria-current", "page");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(dock).toBeHidden();
  await expect(page.locator(".site-bar .site-nav")).toBeVisible();
});

test("selected connection tab keeps a solid fill in dark mode", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("llmgames-theme", "dark"));
  await page.goto("/design-preview/connect-ai");
  const tabs = page.getByRole("tab");
  await expect(tabs.first()).toBeVisible();

  for (const tab of await tabs.all()) {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => tab.evaluate((e) => getComputedStyle(e).backgroundColor))
      .not.toBe("rgba(0, 0, 0, 0)");

    const fills = await tabs.evaluateAll((els) =>
      els.map((e) => ({
        selected: e.getAttribute("aria-selected") === "true",
        color: getComputedStyle(e).backgroundColor,
      })),
    );

    for (const other of fills.filter((f) => !f.selected))
      expect(other.color).not.toBe(fills.find((f) => f.selected)!.color);
  }

  expect(
    (await new AxeBuilder({ page }).include(".mcp-connect-flow").withTags(["wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
});

test("home nav stays stuck above overflowing game art", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Can your AI beat you at Connect 4?" }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 900));

  const state = await page.evaluate(() => {
    const slot = document.querySelector(".site-bar-slot");
    const bar = document.querySelector(".site-bar");

    if (!slot || !bar) return { error: "missing-nav" };
    const top = slot.getBoundingClientRect().top;

    const mid = document.elementFromPoint(
      innerWidth / 2,
      Math.max(16, bar.getBoundingClientRect().top + 8),
    );

    const gap = document.elementFromPoint(innerWidth / 2, 6);

    return { top, onNav: slot.contains(mid), gapOnNav: Boolean(gap?.closest(".site-bar-slot")) };
  });

  expect(state.top).toBeLessThanOrEqual(1);
  expect(state.onNav).toBe(true);
  expect(state.gapOnNav).toBe(true);
});

test("scrolled copy stays under the nav slot", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.goto("/connect-ai");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 480));

  const leak = await page.evaluate(() => {
    const slot = document.querySelector(".site-bar-slot");

    if (!slot) return "missing-slot";
    const top = slot.getBoundingClientRect().top;

    if (top > 1) return `slot-top-${Math.round(top)}`;
    const hit = document.elementFromPoint(innerWidth / 2, 6);

    return hit && !slot.contains(hit) && Boolean(hit.closest("main"))
      ? `leak:${hit.className}`
      : null;
  });

  expect(leak).toBeNull();
});

test("skip link is the first tab stop and moves focus to the page content", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.goto("/connect-ai");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect.poll(async () => (await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("nav pill moves on click and the bar persists through a client-side page swap", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });

  const home = nav.getByRole("link", { name: "Home" }),
    connect = nav.getByRole("link", { name: "Connect AI" });

  await expect(home).toHaveAttribute("aria-current", "page");
  await expect(page.locator("astro-island:has(.site-bar-slot)")).not.toHaveAttribute("ssr");
  await page.evaluate(() => Reflect.set(document.querySelector(".site-bar")!, "__kept", true));
  let release = () => {};

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/connect-ai", async (route) => {
    if (route.request().resourceType() !== "document" && route.request().resourceType() !== "fetch")
      return route.continue();
    await held;
    await route.continue();
  });
  await connect.click();
  await expect(connect).toHaveAttribute("data-highlighted", "true");
  await expectPillOn(nav, connect);
  await expect(home).toHaveAttribute("aria-current", "page");
  release();
  await expect(page).toHaveURL(/\/connect-ai$/);
  await expect(connect).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.querySelector<HTMLElement>(".site-bar")?.__kept)).toBe(
    true,
  );
});

test("nav marks the current page and shows a hover pill without dither", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await page.goto("/");
  const home = nav.getByRole("link", { name: "Home" });
  const connect = nav.getByRole("link", { name: "Connect AI" });
  await expect(home).toHaveAttribute("aria-current", "page");
  await expect(home).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expectPillOn(nav, home);

  const pill = (link: typeof connect) =>
    link.evaluate((el) => getComputedStyle(el, "::after").opacity);

  await connect.hover();
  await expect.poll(() => pill(connect)).toBe("1");
  await expect(page.locator(".site-bar-slot canvas.dither-touch")).toHaveCount(0);
  await expectPillOn(nav, home);
  await page.mouse.move(1, 200);
  await expect.poll(() => pill(connect)).toBe("0");
  await page.goto("/connect-ai");
  await expect(nav.getByRole("link", { name: "Connect AI" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expectPillOn(nav, nav.getByRole("link", { name: "Connect AI" }));
  await expect(nav.getByRole("link", { name: "Connect AI" })).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
});

test("nav pill slides from the current page, not from the first link", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/v1/auth/users/me", (r) =>
    r.fulfill({
      json: {
        user: {
          id: "pill-user",
          email: "pill@example.com",
          name: null,
          gamertag: "Alex",
          gamertag_selected: 1,
        },
      },
    }),
  );
  await page.goto("/play");
  const nav = page.getByRole("navigation", { name: "Main navigation" });

  const agents = nav.getByRole("link", { name: "Agent log" }),
    history = nav.getByRole("link", { name: "History" });

  await expect(page.locator("astro-island:has(.site-bar-slot)")).not.toHaveAttribute("ssr");
  await agents.click();
  await expect(page).toHaveURL(/\/agent-log$/);
  await expectPillOn(nav, agents);
  const from = (await agents.boundingBox())!.x;
  await page.evaluate(() => {
    const pill = document.querySelector(".site-nav .site-nav-indicator")!;
    const xs: number[] = [];
    window.__pillXs = xs;

    const sample = () => {
      xs.push(pill.getBoundingClientRect().left);

      if (xs.length < 40) requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  });
  await history.click();
  await expectPillOn(nav, history);
  const xs = await page.evaluate(() => window.__pillXs ?? []);
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(from - 1);
});

test("landing primary and secondary actions are visually distinct", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.goto("/");
  const buttons = page.locator(".landing-actions .ui-button");
  await expect(buttons).toHaveCount(2);

  const paint = await buttons.evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el);

      return `${s.backgroundColor}|${s.color}|${s.boxShadow}|${s.borderColor}`;
    }),
  );

  expect(paint[0]).not.toBe(paint[1]);
});

test("mobile email-code retry remains readable and inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto("/design-preview/library?state=auth-code");
  const retry = page.getByRole("button", { name: "Use another email or request a new code" });
  await expect(retry).toBeVisible();
  const rect = await retry.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await retry.click();
  await expect(page.getByLabel("Email address")).toBeVisible();
});

test("library cards are plain links and buttons keep their colours on hover", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) =>
    r.fulfill({
      json: {
        user: {
          id: "lib-user",
          email: "lib@example.com",
          name: null,
          gamertag: "Alex",
          gamertag_selected: 1,
        },
      },
    }),
  );
  await page.goto("/play");
  const grid = page.getByRole("region", { name: "Game library" });
  const tile = grid.getByRole("link", { name: "Play Connect 4" });
  await expect(tile).toHaveAttribute("href", /connect/);
  await expect(grid.locator(".game-tile-play")).toHaveCount(0);

  for (const control of [
    page.getByRole("button", { name: "Join room" }),
    page.getByRole("link", { name: /Create a game series/ }),
  ]) {
    const colours = () =>
      control.evaluate((el) => {
        const s = getComputedStyle(el),
          b = getComputedStyle(el, "::before");

        return [s.backgroundColor, s.color, b.content];
      });

    const before = await colours();
    await control.hover();
    expect(await colours()).toEqual(before);
  }
});
