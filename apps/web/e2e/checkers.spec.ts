import { expect, test, type WebSocketRoute } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture } from "../src/dev/previewFixtures";

const identity = {
  id: "preview-0",
  email: "checkers@example.test",
  name: null,
  gamertag: "Alex",
  gamertag_selected: 1,
};

const active = { ...fixture("checkers"), you: { ...fixture("checkers").you, isHost: true } };

const link = {
  roomId: "checkers-demo",
  roomCode: "CHK234",
  gameType: "checkers",
  gameStatus: "waiting",
  wsUrl: "ws://localhost/api/v1/ws/games/checkers-demo",
  expiresAt: Date.now() + 1000000,
};

test("Checkers appears in the library, public rules, and room setup", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: identity } }));
  await page.goto("/play");

  const tile = page
    .locator(".game-tile")
    .filter({ has: page.getByRole("heading", { name: "Checkers", exact: true }) });

  await expect(tile).toBeVisible();
  await expect(tile.locator(".game-glyph svg")).toBeVisible();
  await page.goto("/games/checkers");
  await expect(page.getByRole("heading", { name: "Checkers", exact: true })).toBeVisible();
  await expect(page.getByText(/Captures are mandatory/)).toBeVisible();
  await page.goto("/checkers");
  await expect(page.getByRole("button", { name: "Create room", exact: true })).toBeEnabled();
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  for (const theme of ["light", "dark"])
    test(`Checkers fits and remains readable ${viewport.width} ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((value) => {
        localStorage.setItem("llmgames-theme", value);
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.goto("/design-preview/checkers");
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByLabel("Checkers board", { exact: true })).toBeVisible();
      await expect(page.getByLabel("12 black pieces", { exact: true })).toBeVisible();
      await expect(page.getByLabel("12 white pieces", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const box = await page.getByLabel("Checkers board", { exact: true }).boundingBox();
      expect(box!.width).toBeGreaterThan(160);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      await expect(page.locator(".checker-piece")).toHaveCount(24);
      await page.screenshot({ path: info.outputPath("checkers.png") });
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
    });

test("create, start, keyboard move, forced continuation, reconnect, and saved replay", async ({
  page,
}) => {
  let socket: WebSocketRoute;
  const messages: unknown[] = [];
  let connect = true;
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: identity } }));
  await page.route("**/api/v1/rooms/create", (r) => {
    expect(r.request().postDataJSON()).toMatchObject({ gameType: "checkers" });

    return r.fulfill({ json: link });
  });
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      messages.push(msg);

      if (msg.payload?.actionType === "start_game")
        ws.send(JSON.stringify({ type: "game_started", payload: { state: active } }));
    });

    if (connect)
      ws.send(
        JSON.stringify({
          type: "connected",
          payload: { state: { ...active, status: "waiting", maxPlayers: 2 }, isHost: true },
        }),
      );
  });
  await page.goto("/checkers");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page
    .getByRole("button", { name: "Row 6, column 1, black man", exact: true })
    .press("Enter");
  // An unchanged server snapshot must not clear an in-progress selection.
  socket!.send(JSON.stringify({ type: "state", payload: structuredClone(active) }));
  await page
    .getByRole("button", { name: "Row 5, column 2, empty, move here", exact: true })
    .press("Enter");
  await expect
    .poll(() => messages)
    .toContainEqual({
      type: "action",
      payload: { actionType: "move_checker", data: { fromRow: 5, fromCol: 0, row: 4, col: 1 } },
    });
  const board = Array.from({ length: 8 }, () => Array(8).fill(0));
  board[3]![2] = 1;
  board[2]![3] = 2;
  board[0]![7] = 4;

  const chain = {
    ...active,
    board,
    scores: { 1: 1, 2: 2 },
    forcedPiece: { row: 3, col: 2 },
    legalMoves: [{ fromRow: 3, fromCol: 2, row: 1, col: 4, capture: { row: 2, col: 3 } }],
    lastMove: { fromRow: 5, fromCol: 0, row: 3, col: 2 },
  };

  socket!.send(JSON.stringify({ type: "state", payload: chain }));
  await expect(page.getByRole("status")).toContainText("Keep jumping");
  await expect(page.getByLabel("Row 1, column 8, white king", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "Row 2, column 5, empty, move here", exact: true })
    .click();
  await expect
    .poll(() => messages)
    .toContainEqual({
      type: "action",
      payload: { actionType: "move_checker", data: { fromRow: 3, fromCol: 2, row: 1, col: 4 } },
    });
  connect = false;
  socket!.close();
  await expect(page.getByText("Reconnecting…", { exact: false })).toBeVisible();
  await expect(page.locator(".checkers-cell:enabled")).toHaveCount(0);
  await expect.poll(() => socket).toBeTruthy();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  socket!.send(JSON.stringify({ type: "connected", payload: { state: chain, isHost: true } }));

  const terminal = {
    ...chain,
    status: "ended",
    winner: "preview-0",
    forcedPiece: null,
    legalMoves: [],
  };

  socket!.send(
    JSON.stringify({
      type: "game_ended",
      payload: {
        finalState: terminal,
        reason: "no_legal_moves",
        rewatch: {
          version: 1,
          visibility: "full_reveal",
          gameType: "checkers",
          frames: [
            { index: 0, at: 0, label: "start", state: active },
            { index: 1, at: 1, label: "finish", state: terminal },
          ],
        },
      },
    }),
  );
  await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
  await expect.poll(() => messages).toContainEqual({ type: "rewatch_saved" });
  await page.getByRole("button", { name: "Watch replay", exact: true }).click();
  await expect(page.getByLabel("Replay position")).toBeVisible();
  await expect(page.getByLabel("Checkers board", { exact: true })).toBeVisible();
  await expect(page.locator(".checkers-cell:enabled")).toHaveCount(0);
});

test("spectators and broadcast operators see kings without move controls", async ({ page }) => {
  for (const url of [
    "/design-preview/checkers?state=spectator",
    "/design-preview/spectator?state=watch-checkers",
  ]) {
    await page.goto(url);
    await expect(page.getByLabel("Checkers board", { exact: true })).toBeVisible();
    await expect(page.locator(".checkers-cell:enabled")).toHaveCount(0);
  }
});
