import { test, expect } from "@playwright/test";
import { fixture } from "../src/dev/previewFixtures";

const identity = {
  id: "demo",
  email: "player@example.com",
  name: null,
  gamertag: "Alex",
  gamertag_selected: 1,
};

const reversiLink = {
  roomId: "demo",
  roomCode: "ABC234",
  gameType: "reversi",
  gameStatus: "waiting",
  wsUrl: "ws://127.0.0.1:6787/demo",
};

const reversiLobby = {
  ...fixture("reversi"),
  status: "waiting",
  you: { ...fixture("reversi").you, isHost: true },
};

async function mockSignedInJoin(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: identity } }));
  await page.route("**/api/v1/rooms/join", (r) => r.fulfill({ json: reversiLink }));
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) =>
    ws.send(
      JSON.stringify({
        type: "connected",
        payload: { state: reversiLobby, isHost: true, roomCode: reversiLink.roomCode },
      }),
    ),
  );
}

test("signed-out library join preserves the room code for sign-in", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.goto("/play");
  await expect(page.getByRole("button", { name: "Join room", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "Room code" }).fill("abc234");
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fplay%3FroomCode%3DABC234$/);
});

test("signed-out play query keeps the room code ready to join", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: null } }));
  await page.goto("/play?roomCode=abc234");
  await expect(page.getByRole("textbox", { name: "Room code" })).toHaveValue("ABC234");
  await expect(page.getByRole("button", { name: "Join room", exact: true })).toBeEnabled();
});

test("library joins the server-resolved game when signed in", async ({ page }) => {
  await mockSignedInJoin(page);
  await page.goto("/play");
  await expect(page.getByRole("button", { name: "Join room", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "Room code" }).fill("abc234");
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page).toHaveURL(/\/reversi\?roomCode=ABC234$/);
  await expect(page.getByRole("heading", { name: "Set up your table", exact: true })).toBeVisible();
});

test("play query auto-joins when signed in", async ({ page }) => {
  await mockSignedInJoin(page);
  await page.goto("/play?roomCode=abc234");
  await expect(page).toHaveURL(/\/reversi\?roomCode=ABC234$/);
  await expect(page.getByRole("heading", { name: "Set up your table", exact: true })).toBeVisible();
});

test("legacy play room query auto-joins when signed in", async ({ page }) => {
  await mockSignedInJoin(page);
  await page.goto("/play?room=abc234");
  await expect(page).toHaveURL(/\/reversi\?roomCode=ABC234$/);
  await expect(page.getByRole("heading", { name: "Set up your table", exact: true })).toBeVisible();
});

test("preview library joins only a seeded demo", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/") && r.method() !== "GET") writes.push(r.url());
  });
  await page.goto("/design-preview/library");
  await page.getByRole("textbox", { name: "Room code" }).fill("ABC234");
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page).toHaveURL(/\/design-preview\/connect4\?state=lobby-guest$/);
  expect(writes).toEqual([]);
});
