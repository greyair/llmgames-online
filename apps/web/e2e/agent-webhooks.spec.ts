import { test, expect } from "@playwright/test";
import { fixture } from "../src/dev/previewFixtures";
import { applyPreviewScenario } from "../src/dev/previewScenarios";

for (const width of [390, 1280]) {
  test(`multiple webhook settings at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/design-preview/profile?state=jev-disconnected");
    const section = page.getByRole("region", { name: "Agent webhooks", exact: true });

    for (const name of ["Cursor agent", "My second agent"]) {
      await section.getByRole("button", { name: "Add webhook", exact: true }).click();
      await section.getByLabel("Agent name", { exact: true }).fill(name);
      await section
        .getByLabel("Webhook URL", { exact: true })
        .fill("https://hooks.example.com/dummy");
      await section.getByLabel("Header value", { exact: true }).fill("Bearer dummy-test-token");
      await section.getByRole("button", { name: "Save webhook", exact: true }).click();
      await expect(section.getByText(name, { exact: true })).toBeVisible();
    }

    await expect(section.getByText("2 / 10 saved", { exact: true })).toBeVisible();
    await section.getByRole("button", { name: "Edit Cursor agent", exact: true }).click();
    await expect(section.getByLabel("Webhook URL", { exact: true })).toHaveValue("");
    await expect(section.getByLabel("Header value", { exact: true })).toHaveValue("");
    await section.getByLabel("Agent name", { exact: true }).fill("Renamed agent");
    await section.getByRole("button", { name: "Save webhook", exact: true }).click();
    await expect(section.getByText("Renamed agent", { exact: true })).toBeVisible();
    await section.getByRole("button", { name: "Add webhook", exact: true }).click();
    await section.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await section.screenshot({ path: `/tmp/llmgames-webhooks-settings-${width}.png` });
    await section.getByRole("button", { name: "Cancel", exact: true }).click();
    await section.getByRole("button", { name: "Remove My second agent", exact: true }).click();
    await expect(section.getByText("1 / 10 saved", { exact: true })).toBeVisible();
  });
  test(`webhook lobby invites at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = applyPreviewScenario(fixture("poker"), "poker", "lobby-waiting");
    state.roomCode = "ABC234";
    let delivered = 0;
    await page.route("**/api/v1/auth/users/me", (route) =>
      route.fulfill({
        json: {
          user: {
            id: "preview-0",
            email: "player@example.test",
            name: null,
            gamertag: "Alex",
            gamertag_selected: 1,
          },
        },
      }),
    );
    await page.route("**/api/v1/auth/users/me/typesafe", (route) =>
      route.fulfill({
        json: {
          available: true,
          connected: true,
          trialAvailable: false,
          verifiedAt: 1788970000000,
          dailyLimit: 10000,
          callsToday: 0,
        },
      }),
    );
    await page.route("**/api/v1/auth/users/me/agent-webhooks", (route) =>
      route.fulfill({
        json: {
          available: true,
          webhooks: [
            {
              id: "one",
              name: "Cursor agent",
              hostname: "hooks.example.com",
              headerName: "Authorization",
              createdAt: 1788970000000,
              lastAttemptAt: null,
              lastDelivery: null,
            },
            {
              id: "two",
              name: "Other agent",
              hostname: "hooks.example.com",
              headerName: "Authorization",
              createdAt: 1788970000000,
              lastAttemptAt: null,
              lastDelivery: null,
            },
          ],
        },
      }),
    );
    await page.route("**/agent-webhooks/*/invite", (route) => {
      expect(route.request().postDataJSON()).toEqual({ roomCode: "ABC234" });

      if (route.request().url().includes("/two/"))
        return route.fulfill({ status: 502, json: { error: "The webhook rejected the invite." } });
      delivered++;

      return route.fulfill({ json: { delivered: true, eventId: "test" } });
    });
    await page.route("**/api/v1/rooms/join", (route) =>
      route.fulfill({
        json: {
          roomId: "webhook-test",
          roomCode: "ABC234",
          gameType: "poker",
          gameStatus: "waiting",
          wsUrl: "/api/v1/ws/games/webhook-test",
        },
      }),
    );
    let update: (view: typeof state) => void = () => {};

    await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
      ws.send(
        JSON.stringify({ type: "connected", payload: { state, isHost: true, roomCode: "ABC234" } }),
      );
      update = (view) => ws.send(JSON.stringify({ type: "state", payload: view }));
    });
    await page.goto("/poker?roomCode=ABC234");
    const section = page.getByRole("region", { name: "Invite your agents", exact: true });
    await section.getByRole("button", { name: "Invite Cursor agent", exact: true }).click();
    await expect(section.getByRole("status")).toContainText("Waiting for the agent to join");
    await expect(
      section.getByRole("button", { name: "Invited Cursor agent", exact: true }),
    ).toBeDisabled();
    expect(delivered).toBe(1);
    await section.getByRole("button", { name: "Invite Other agent", exact: true }).click();
    await expect(section.getByRole("alert")).toContainText("rejected");
    await section.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `/tmp/llmgames-webhooks-lobby-${width}.png`, fullPage: true });
    update({ ...state, maxPlayers: state.players!.length });
    await expect(
      section.getByRole("button", { name: "Invite Other agent", exact: true }),
    ).toBeDisabled();
    update({ ...state, you: { ...state.you!, isHost: false } });
    await expect(section).toHaveCount(0);
  });
}
