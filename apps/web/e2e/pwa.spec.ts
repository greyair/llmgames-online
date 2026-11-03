import { expect, test } from "@playwright/test";

/**
 * PWA.0/PWA.1 delivery checks: what the browser needs to consider the site
 * installable, and that the shell degrades honestly when the network is gone.
 *
 * These run against the dev server, where the service worker is deliberately
 * not registered; registration itself is covered by the preview build check.
 */

test("manifest declares a standalone app with the required icons", async ({ request }) => {
  const response = await request.get("/site.webmanifest");

  expect(response.ok()).toBe(true);

  // SAFETY: the manifest is a file we ship; the fields below are the ones the
  // install criteria depend on, asserted immediately.
  const manifest = (await response.json()) as {
    display: string;
    start_url: string;
    icons: { sizes: string; purpose?: string }[];
  };

  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/play");

  const sizes = manifest.icons.map((icon) => icon.sizes);

  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
  expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
});

test("the service worker and the offline page are served", async ({ request }) => {
  const worker = await request.get("/sw.js");

  expect(worker.ok()).toBe(true);
  expect(await worker.text()).toContain("SKIP_WAITING");

  const offline = await request.get("/offline");

  expect(offline.ok()).toBe(true);
  expect(await offline.text()).toContain("You are offline");
});

test("the install entry explains the platform's own menu", async ({ page }) => {
  await page.goto("/play");

  const install = page.getByRole("button", { name: /install app/i });

  await expect(install).toBeVisible();
  await install.click();

  const dialog = page.getByRole("dialog");

  await expect(dialog).toBeVisible();
  // Chromium gets address-bar steps; iOS and macOS get theirs.
  await expect(dialog).toContainText(/Chrome or Edge|iPhone or iPad|Safari on macOS/);
  // Installing is about the window, and the copy says so instead of promising offline play.
  await expect(dialog).toContainText(/still need a connection/i);
});

test("going offline says so, and coming back clears it", async ({ page, context }) => {
  await page.goto("/play");

  await context.setOffline(true);
  await expect(page.getByText(/You are offline/i)).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText(/Back online/i)).toBeVisible();
});
