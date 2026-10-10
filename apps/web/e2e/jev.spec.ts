import { test, expect, type WebSocketRoute } from "@playwright/test";
import { fixture } from "../src/dev/previewFixtures";
import { applyPreviewScenario } from "../src/dev/previewScenarios";
import { gameRouteSlug } from "@llmgames/game-catalog";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/users/me/agent-webhooks", (route) =>
    route.fulfill({ json: { available: true, webhooks: [] } }),
  );
});

for (const game of ["connect4", "pokemon", "reversi", "battleship", "poker", "contexto"])
  for (const width of [390, 1440]) {
    test(`${game} Jev lobby controls ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      const state = applyPreviewScenario(fixture(game), game, "lobby-waiting");
      const sent: { type: string; payload?: { actionType?: string } }[] = [];
      let socket!: WebSocketRoute;
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
      await page.route("**/api/v1/rooms/join", (route) =>
        route.fulfill({
          json: {
            roomId: "jev-audit",
            roomCode: "JEV234",
            gameType: game,
            gameStatus: "waiting",
            wsUrl: "ws://localhost/api/v1/ws/games/jev-audit",
          },
        }),
      );
      await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
        socket = ws;
        ws.onMessage((data) => sent.push(JSON.parse(String(data))));
        ws.send(
          JSON.stringify({
            type: "connected",
            payload: { state, isHost: true, roomCode: "JEV234" },
          }),
        );
      });
      await page.goto(`/${gameRouteSlug(game)}?roomCode=JEV234`);
      const addJev = page.getByRole("button", { name: "Try Jev for a game", exact: true });
      await expect(page.getByText("Your seat", { exact: true })).toHaveCount(0);
      const ownCard = page.locator(".lobby-member[data-self=true]");
      await expect(ownCard).toBeVisible();
      // The card's fill is drawn on its hand-drawn ::before shape.
      expect(
        await ownCard.evaluate((element) => getComputedStyle(element, "::before").backgroundColor),
      ).not.toBe("rgba(0, 0, 0, 0)");

      const connectAccount = page.getByRole("link", {
        name: "Connect your account, opens Profile in a new tab",
        exact: true,
      });

      await expect(connectAccount).toHaveAttribute("href", "/profile#jev-settings");
      await expect(connectAccount).toHaveAttribute("target", "_blank");
      await addJev.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("jev-options.png"), fullPage: true });
      await expect(
        addJev.getByRole("img", { name: "Jev · TypeSafe logo", exact: true }),
      ).toBeVisible();
      expect(
        await addJev
          .getByRole("img", { name: "Jev · TypeSafe logo", exact: true })
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe("rgba(0, 0, 0, 0)");
      await addJev.click();
      await expect.poll(() => sent.some((m) => m.payload?.actionType === "add_jev")).toBe(true);
      state.players!.push({
        id: "jev",
        name: "Jev",
        codename: "Jev",
        isAgent: true,
        environmentLabel: "TypeSafe",
      });
      state.jev!.playerId = "jev";
      socket.send(JSON.stringify({ type: "state", payload: state }));
      await expect(page.getByRole("button", { name: "Remove Jev", exact: true })).toBeEnabled();
      await expect(page.getByRole("img", { name: "Jev · TypeSafe logo", exact: true })).toHaveCount(
        2,
      );

      const jevLogo = await page
        .getByRole("img", { name: "Jev · TypeSafe logo", exact: true })
        .first()
        .evaluate((el) => {
          if (!(el instanceof HTMLImageElement)) throw new Error("Expected Jev logo image");

          return { tag: el.tagName.toLowerCase(), src: el.src };
        });

      expect(jevLogo.tag).toBe("img");
      expect(jevLogo.src).toMatch(/(?:image\/svg\+xml|typesafe-logo[^/]*\.svg)/);
      await expect(page.getByRole("button", { name: "Start game", exact: true })).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Try Jev for a game", exact: true }),
      ).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath("jev-lobby.png"), fullPage: true });
      await page.getByRole("button", { name: "Remove Jev", exact: true }).click();
      await expect.poll(() => sent.some((m) => m.payload?.actionType === "remove_jev")).toBe(true);
      state.players!.pop();
      delete state.jev!.playerId;
      socket.send(JSON.stringify({ type: "state", payload: state }));
      await expect(
        page.getByRole("button", { name: "Try Jev for a game", exact: true }),
      ).toBeEnabled();
      state.you!.isHost = false;
      socket.send(JSON.stringify({ type: "state", payload: state }));
      await expect(
        page.getByRole("button", { name: "Try Jev for a game", exact: true }),
      ).toHaveCount(0);
    });
  }

test("used Jev trial is not offered again", async ({ page }) => {
  await page.goto("/design-preview/setup?state=jev-trial-used");
  await expect(
    page.getByText("Your free Jev game has been used. Connect TypeSafe to keep playing.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try Jev for a game", exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", {
      name: "Connect your account, opens Profile in a new tab",
      exact: true,
    }),
  ).toBeVisible();
});

test("Jev connection failures are visible during a match", async ({ page }, info) => {
  const state = fixture("pokemon");
  state.players![1] = {
    ...state.players![1]!,
    name: "Jev",
    codename: "Jev",
    environmentLabel: "TypeSafe",
  };
  state.jev = { available: true, playerId: state.players![1]!.id, status: "limit_reached" };
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
  await page.route("**/api/v1/rooms/join", (route) =>
    route.fulfill({
      json: {
        roomId: "jev-status",
        roomCode: "JEV234",
        gameType: "pokemon",
        gameStatus: "playing",
        wsUrl: "ws://localhost/api/v1/ws/games/jev-status",
      },
    }),
  );
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
    ws.send(
      JSON.stringify({ type: "connected", payload: { state, isHost: true, roomCode: "JEV234" } }),
    );
  });
  await page.goto("/pokemon?roomCode=JEV234");
  await expect(
    page.locator(".poke-combatant .player-name-label[data-jev-status=limit_reached]"),
  ).toContainText("Play limit reached");
  await expect(page.locator(".jev-status")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("jev-limit-in-pokemon-tile.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: info.outputPath("jev-limit-in-pokemon-tile-mobile.png"),
    fullPage: true,
  });
});

test("Jev status never changes the Contexto layout", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = fixture("contexto");
  state.players![1] = {
    ...state.players![1]!,
    name: "Jev",
    codename: "Jev",
    environmentLabel: "TypeSafe",
  };
  state.jev = { available: true, playerId: state.players![1]!.id, status: "thinking" };
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
  await page.route("**/api/v1/rooms/join", (route) =>
    route.fulfill({
      json: {
        roomId: "jev-thinking",
        roomCode: "JEV234",
        gameType: "contexto",
        gameStatus: "playing",
        wsUrl: "ws://localhost/api/v1/ws/games/jev-thinking",
      },
    }),
  );
  let socket!: WebSocketRoute;
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
    socket = ws;
    ws.send(
      JSON.stringify({ type: "connected", payload: { state, isHost: true, roomCode: "JEV234" } }),
    );
  });
  await page.goto("/contexto?roomCode=JEV234");
  const jevTile = page.locator(".contexto-rival").filter({ hasText: "Jev" });
  await expect(jevTile.locator(".player-name-label")).toContainText("Jev");
  await expect(
    jevTile.locator(".player-name-label[data-jev-status],.jev-name-note,.jev-name-dots"),
  ).toHaveCount(0);
  await expect(page.locator(".jev-status")).toHaveCount(0);

  const bounds = await page.locator(".desk-play,.contexto-stage").evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();

      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );

  expect(bounds[1]!.x).toBeCloseTo(bounds[0]!.x, 0);
  expect(bounds[1]!.width).toBeCloseTo(bounds[0]!.width, 0);
  expect(bounds[1]!.width).toBeGreaterThan(1000);
  state.jev.status = "ready";
  socket.send(JSON.stringify({ type: "state", payload: state }));
  await expect(page.locator(".jev-name-note,.jev-name-dots")).toHaveCount(0);

  const readyBounds = await page.locator(".desk-play,.contexto-stage").evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();

      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );

  expect(readyBounds).toEqual(bounds);
  state.jev.status = "retrying";
  socket.send(JSON.stringify({ type: "state", payload: state }));
  await expect(jevTile.locator(".player-name-label[data-jev-status=retrying]")).toContainText(
    "Reconnecting",
  );
  await page.screenshot({ path: info.outputPath("jev-status-in-tile.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(jevTile).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("jev-status-in-tile-mobile.png"), fullPage: true });
});
