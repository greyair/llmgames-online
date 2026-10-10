import { test, expect } from "@playwright/test";

const user = {
  id: "security-test",
  email: "security@example.test",
  name: null,
  gamertag: "SecurityTest",
  gamertag_selected: 1,
};

test("credential changes offer reauthentication without submitting the secret to login", async ({
  page,
}) => {
  let signedIn = true;
  let logoutCount = 0;
  await page.route("**/api/v1/auth/users/me", (route) =>
    route.fulfill({ json: { user: signedIn ? user : null } }),
  );
  await page.route("**/api/v1/auth/users/me/agent-webhooks", (route) =>
    route.fulfill({ json: { available: true, webhooks: [] } }),
  );
  await page.route("**/api/v1/auth/users/me/typesafe", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            available: true,
            connected: false,
            trialAvailable: true,
            verifiedAt: null,
            dailyLimit: 10000,
            callsToday: 0,
          },
        })
      : route.fulfill({
          status: 403,
          json: {
            code: "REAUTHENTICATION_REQUIRED",
            error: "Sign out and sign in again before changing saved credentials.",
          },
        }),
  );
  await page.route("**/api/v1/auth/sessions/logout", (route) => {
    expect(route.request().postData()).toBeNull();
    signedIn = false;
    logoutCount++;

    return route.fulfill({ json: { success: true } });
  });
  await page.goto("/profile");
  const settings = page.getByRole("region", { name: "Play with Jev" });
  await settings.getByLabel("TypeSafe API key", { exact: true }).fill("synthetic-browser-test-key");
  await settings.getByRole("checkbox").check();
  await settings.getByRole("button", { name: "Connect TypeSafe", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("Sign out and sign in again");
  await expect(settings.getByRole("button", { name: "Sign in again", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/llmgames-credential-reauthentication.png", fullPage: true });
  await settings.getByRole("button", { name: "Sign in again", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?return_to=%2Fprofile/);
  expect(logoutCount).toBe(1);
  expect(page.url()).not.toContain("synthetic");
});

test("all-browser signout requires confirmation and uses the revocation endpoint", async ({
  page,
}) => {
  let signedIn = true;
  let logoutCount = 0;
  await page.route("**/api/v1/auth/users/me", (route) =>
    route.fulfill({ json: { user: signedIn ? user : null } }),
  );
  await page.route("**/api/v1/auth/users/me/agent-webhooks", (route) =>
    route.fulfill({ json: { available: true, webhooks: [] } }),
  );
  await page.route("**/api/v1/auth/users/me/typesafe", (route) =>
    route.fulfill({
      json: {
        available: true,
        connected: false,
        trialAvailable: true,
        verifiedAt: null,
        dailyLimit: 10000,
        callsToday: 0,
      },
    }),
  );
  await page.route("**/api/v1/auth/sessions/logout-all", (route) => {
    signedIn = false;
    logoutCount++;

    return route.fulfill({ json: { success: true } });
  });
  await page.goto("/profile");
  await page.getByRole("button", { name: "Sign out of all browsers", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Your connected MCP agents stay signed in.");
  expect(logoutCount).toBe(0);
  await dialog.getByRole("button", { name: "Sign out of all browsers", exact: true }).click();
  await expect(page).toHaveURL("/");
  expect(logoutCount).toBe(1);
});
