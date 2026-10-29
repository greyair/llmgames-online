import type {} from "./browser-state";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/**", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.turnstile={render:(el,opts)=>{queueMicrotask(()=>opts.callback('test-token'));return 'test-widget';},remove:()=>{},reset:()=>{}};",
    }),
  );
});

const user = {
  id: "demo-user",
  email: "player@example.com",
  name: null,
  gamertag: "BrightRook",
  gamertag_selected: 1,
  broadcast_allowed: 0,
};

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  test(`account layout ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath("login.png"), fullPage: true });
  });

test("background verification keeps the widget hidden and unlocks sign-in", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.goto("/login");
  const verification = page.locator(".signin-verification");
  await expect(verification).toHaveCount(1);
  await expect(verification).toHaveAttribute("data-visible", "false");
  await expect(verification).toBeHidden();
  await expect(page.getByRole("button", { name: "Send sign-in code" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
});

test("hidden verification shows verifying until a token arrives", async ({ page }) => {
  await page.unroute("https://challenges.cloudflare.com/**");
  await page.route("https://challenges.cloudflare.com/**", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.turnstile={render:(el,opts)=>{window.__completeTurnstile=()=>opts.callback('test-token');return 'test-widget';},remove:()=>{},reset:()=>{}};",
    }),
  );
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.goto("/login");
  const verification = page.locator(".signin-verification");
  await expect(verification).toHaveCount(1);
  await expect(verification).toHaveAttribute("data-visible", "false");
  await expect(verification).toBeHidden();
  await expect(page.getByRole("button", { name: "Verifying…" })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Verifying…" }).first()).toBeDisabled();
  await expect(page.locator(".signin-verifying-mark")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeDisabled();
  await page.evaluate(() => window.__completeTurnstile?.());
  await expect(verification).toBeHidden();
  await expect(page.getByRole("button", { name: "Send sign-in code" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
});

test("an interactive challenge stretches to the form and unlocks after success", async ({
  page,
}) => {
  await page.unroute("https://challenges.cloudflare.com/**");
  await page.route("https://challenges.cloudflare.com/**", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.turnstile={render:(el,opts)=>{queueMicrotask(()=>opts['before-interactive-callback']?.());el.setAttribute('data-challenge','open');window.__completeTurnstile=()=>{opts.callback('test-token');opts['after-interactive-callback']?.();};return 'test-widget';},remove:()=>{},reset:()=>{}};",
    }),
  );
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.goto("/login");
  const verification = page.locator(".signin-verification");
  await expect(verification).toHaveCount(1);
  await expect(verification).toHaveAttribute("data-visible", "true");
  await expect(verification).toBeVisible();
  await expect(page.getByRole("button", { name: "Send sign-in code" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
  const widget = await page.locator(".signin-verification-widget").boundingBox();
  const email = await page.getByLabel("Email address").boundingBox();
  expect(widget?.width ?? 0).toBeGreaterThan((email?.width ?? 0) * 0.9);
  await page.evaluate(() => window.__completeTurnstile?.());
  await expect(verification).toHaveAttribute("data-visible", "false");
  await expect(verification).toBeHidden();
  await expect(page.getByRole("button", { name: "Send sign-in code" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
});

test("email sign in retries invalid codes and preserves safe destination", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.route("**/api/v1/auth/email/request", async (r) => {
    expect(r.request().postDataJSON()).toMatchObject({
      email: "player@example.com",
      turnstileToken: "test-token",
      returnTo: "/poker?roomCode=DEMO12",
    });
    await r.fulfill({ json: { challengeId: "challenge-1" } });
  });
  await page.route("**/api/v1/auth/email/verify", async (r) => {
    expect(r.request().postDataJSON()).toEqual({ challengeId: "challenge-1", code: "123456" });
    await r.fulfill({ status: 400, json: { error: "That code has expired. Request a new one." } });
  });
  await page.goto("/login?returnTo=" + encodeURIComponent("/poker?roomCode=DEMO12"));
  await page.getByLabel("Email address").fill("player@example.com");
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  await page.getByLabel("Sign-in code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("expired");
  await page.getByRole("button", { name: "Use another email" }).click();
  await expect(page.getByLabel("Email address")).toHaveValue("player@example.com");
});

test("onboarding saves a name without streaming controls", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) =>
    r.fulfill({ json: { user: { ...user, gamertag_selected: 0 } } }),
  );
  await page.route("**/api/v1/auth/users/me/onboarding", async (r) => {
    expect(r.request().postDataJSON()).toEqual({ username: "BrightRook" });
    await r.fulfill({ json: { user } });
  });
  await page.goto("/onboarding?returnTo=https://example.com");
  await page.getByLabel("Player name").fill("BrightRook");
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByText("Stream games I host")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Twitch channel" })).toHaveCount(0);
  await page.getByRole("button", { name: "Let’s play" }).click();
  await expect(page).toHaveURL(/\/play$/);
});

test("profile has session settings without streaming controls and reports logout failure", async ({
  page,
}, info) => {
  let logoutCalls = 0;
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user } }));
  await page.route("**/api/v1/auth/sessions/logout", (r) => {
    logoutCalls++;

    return r.fulfill({ status: 500 });
  });
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "BrightRook" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("profile.png") });
  await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Stream games I host" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Streaming", exact: true })).toHaveCount(0);
  await page.locator(".profile-signout").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Sign out?" })).toBeVisible();
  expect(logoutCalls).toBe(0);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(logoutCalls).toBe(0);
  await page.locator(".profile-signout").click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".profile-settings-panel .account-error")).toContainText(
    "Could not sign out",
  );
  await expect(page).toHaveURL(/\/profile$/);
  expect(logoutCalls).toBe(1);
});

test("session cookie skips sign in and opens the library", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user } }));
  await page.goto("/login");
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByRole("region", { name: "Game library" })).toBeVisible();
});

test("signed-in home opens the library", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user } }));
  await page.goto("/");
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByRole("region", { name: "Game library" })).toBeVisible();
});

test("incomplete session continues onboarding instead of the sign-in form", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) =>
    r.fulfill({ json: { user: { ...user, gamertag_selected: 0 } } }),
  );
  await page.goto("/login?returnTo=/poker");
  await expect(page).toHaveURL(/\/onboarding\?returnTo=/);
  await expect(page.getByLabel("Player name", { exact: true })).toBeVisible();
});

test("session error offers retry and recovers", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/v1/auth/users/me", (r) =>
    ++calls === 1 ? r.fulfill({ status: 503 }) : r.fulfill({ json: { user: null } }),
  );
  await page.goto("/login");
  await expect(page.getByRole("alert")).toContainText("Could not verify");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
