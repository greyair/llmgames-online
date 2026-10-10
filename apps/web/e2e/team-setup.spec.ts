import { test, expect, type WebSocketRoute } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture } from "../src/dev/previewFixtures";

const waiting = {
  ...fixture("codenames"),
  status: "waiting",
  maxPlayers: 8,
  spectators: [{ id: "guest", name: "Taylor" }],
  you: { ...fixture("codenames").you, isHost: true },
};

async function setup(page: import("@playwright/test").Page, host = true) {
  const actions: unknown[] = [];
  let stream: WebSocketRoute;
  await page.route("**/api/v1/auth/users/me", (r) =>
    r.fulfill({
      json: {
        user: {
          id: "preview-0",
          email: "a@example.com",
          name: null,
          gamertag: "Alex",
          gamertag_selected: 1,
        },
      },
    }),
  );
  await page.route("**/api/v1/rooms/join", (r) =>
    r.fulfill({
      json: {
        roomId: "team-room",
        roomCode: "TEAM12",
        gameType: "codenames",
        gameStatus: "waiting",
        wsUrl: "ws://localhost",
      },
    }),
  );
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
    stream = ws;
    ws.onMessage((msg) => actions.push(JSON.parse(String(msg))));
    ws.send(
      JSON.stringify({
        type: "connected",
        payload: { isHost: host, state: { ...waiting, you: { ...waiting.you, isHost: host } } },
      }),
    );
  });
  await page.goto("/codenames?roomCode=TEAM12");
  await expect(page.getByRole("heading", { name: "Set up your table" })).toBeVisible();

  return {
    actions,
    get stream() {
      return stream!;
    },
  };
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  test(`team setup ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await setup(page);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath("teams.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

test("host moves members between role zones and resets without predicting state", async ({
  page,
}) => {
  const { actions } = await setup(page);
  await page.getByRole("button", { name: "Move BrightRook" }).click();
  await page
    .getByRole("region", { name: "Blue spymaster" })
    .getByRole("button", { name: "Move here" })
    .click();
  expect(actions).toContainEqual({
    type: "action",
    payload: {
      actionType: "assign_codenames_role",
      data: { playerId: "preview-1", team: "blue", role: "spymaster" },
    },
  });
  await page.getByRole("button", { name: "Reset teams" }).click();
  expect(actions).toContainEqual({
    type: "action",
    payload: { actionType: "reset_codenames_roles", data: {} },
  });
});

test("guest can move only their own Codenames card", async ({ page }) => {
  await setup(page, false);
  await expect(page.getByRole("button", { name: "Move Alex" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Move BrightRook" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reset teams" })).toHaveCount(0);
});
