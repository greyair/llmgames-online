import type {} from "./browser-state";
import { test, expect, type WebSocketRoute } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture } from "../src/dev/previewFixtures";
import { gameRouteSlug } from "@llmgames/game-catalog";

const identity = {
  id: "preview-0",
  email: "player@example.com",
  name: null,
  gamertag: "Alex",
  gamertag_selected: 1,
};

const link = {
  roomId: "room-demo",
  roomCode: "DEMO12",
  gameType: "connect4",
  gameStatus: "waiting",
  wsUrl: "ws://localhost/api/v1/ws/games/room-demo",
  expiresAt: Date.now() + 100000,
};

const active = { ...fixture("connect4"), you: { ...fixture("connect4").you, isHost: true } };

const waiting = { ...active, status: "waiting", maxPlayers: 2 };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) => r.fulfill({ json: { user: identity } }));
});

test("clocks advance from one snapshot without network ticks or the device wall clock", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2035-01-01") });
  const serverTime = 1800000000000;

  const state = {
    ...active,
    clock: { serverTime, gameEndsAt: serverTime + 60000, turnEndsAt: serverTime + 30000 },
  };

  await page.route("**/api/v1/rooms/join", (r) => r.fulfill({ json: link }));
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) =>
    ws.send(JSON.stringify({ type: "connected", payload: { state, isHost: true } })),
  );
  await page.goto("/connect4?roomCode=DEMO12");
  await expect(page.getByLabel("Turn time remaining")).toContainText("0:30");
  await page.clock.runFor(3100);
  await expect(page.getByLabel("Turn time remaining")).toContainText("0:27");
  await expect(page.getByLabel("Match time remaining")).toHaveText("0:57");
  await page.getByLabel("Game options", { exact: true }).click();
  await expect(page.getByRole("button", { name: /^(Pause|Resume)$/ })).toHaveCount(0);
});

test("ended game screens do not show dash placeholders", async ({ page }, info) => {
  for (const path of [
    "/design-preview/pokemon?state=loss",
    "/design-preview/contexto?state=replay-ended",
  ]) {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByLabel("Turn time remaining")).toHaveCount(0);
    await expect(page.getByLabel("Match time remaining")).toHaveCount(0);
    await expect(page.getByText(/^[-–—]+$/)).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(path.includes("pokemon") ? "pokemon-ended.png" : "replay-ended.png"),
    });
  }
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
])
  test(`game navigation title is centered ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/design-preview/pokemon");
    await page.evaluate(() => document.fonts.ready);

    const alignment = await page.locator(".desk-bar").evaluate((bar) => {
      const title = bar.querySelector<HTMLElement>(".desk-title");

      if (!title) throw new Error("Missing game title");
      const barBox = bar.getBoundingClientRect();
      const titleBox = title.getBoundingClientRect();
      const groups = [bar.firstElementChild, bar.lastElementChild];
      const [leftGroup, rightGroup] = groups;

      if (!(leftGroup instanceof HTMLElement) || !(rightGroup instanceof HTMLElement))
        throw new Error("Expected toolbar groups");

      const visibleChildren = (group: HTMLElement) =>
        [...group.children].flatMap((child) => {
          if (getComputedStyle(child).position === "absolute") return [];
          const box = child.getBoundingClientRect();

          return box.width > 0 ? [box] : [];
        });

      const left = visibleChildren(leftGroup);
      const right = visibleChildren(rightGroup);

      return {
        horizontal: Math.abs(titleBox.left + titleBox.width / 2 - (barBox.left + barBox.width / 2)),
        vertical: Math.abs(titleBox.top + titleBox.height / 2 - (barBox.top + barBox.height / 2)),
        leftClearance: titleBox.left - Math.max(...left.map((box) => box.right)),
        rightClearance: Math.min(...right.map((box) => box.left)) - titleBox.right,
      };
    });

    expect(alignment.horizontal).toBeLessThanOrEqual(1);
    expect(alignment.vertical).toBeLessThanOrEqual(1);
    expect(alignment.leftClearance).toBeGreaterThanOrEqual(0);
    expect(alignment.rightClearance).toBeGreaterThanOrEqual(0);
    await page.locator(".desk-bar").screenshot({ path: info.outputPath("game-navigation.png") });
  });

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  test(`room creation layout ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/connect4");
    await expect(page.getByRole("button", { name: "Create room" })).toBeEnabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath("create-room.png"), fullPage: true });
  });

test("revealing and copying the room code keeps the invite layout fixed", async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/design-preview/connect4?state=lobby-host");
    await page.evaluate(() => document.fonts.ready);
    const invite = page.locator(".lobby-invite");
    const actions = page.locator(".lobby-invite-actions");

    const before = await invite.evaluate((element) => {
      const box = element.getBoundingClientRect();

      return { width: box.width, height: box.height };
    });

    const actionsBefore = await actions.evaluate((element) => {
      const box = element.getBoundingClientRect();

      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });

    await page.getByRole("button", { name: "Show room code", exact: true }).click();
    await expect(page.getByLabel("Room code DEMO42", { exact: true })).toBeVisible();
    expect(
      await invite.evaluate((element) => {
        const box = element.getBoundingClientRect();

        return { width: box.width, height: box.height };
      }),
    ).toEqual(before);
    expect(
      await actions.evaluate((element) => {
        const box = element.getBoundingClientRect();

        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    ).toEqual(actionsBefore);
    await page.getByRole("button", { name: "Copy code", exact: true }).click();
    await expect(page.getByRole("button", { name: "Code copied", exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("DEMO42");
    await page.getByRole("button", { name: "Copy invite", exact: true }).click();
    await expect(page.getByRole("button", { name: "Link copied", exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`room-code-${viewport.width}.png`),
      fullPage: true,
    });
  }
});

test("create, start, move, terminal replay and delivery acknowledgement", async ({
  page,
}, info) => {
  let ws: WebSocketRoute;
  const received: unknown[] = [];
  await page.route("**/api/v1/rooms/create", async (r) => {
    expect(r.request().postDataJSON()).toMatchObject({
      gameType: "connect4",
      gameTotalTime: 1800000,
      turnTime: 30000,
    });
    await r.fulfill({ json: link });
  });
  await page.routeWebSocket("**/api/v1/ws/games/**", (route) => {
    ws = route;
    route.onMessage((data) => {
      const msg = JSON.parse(String(data));
      received.push(msg);

      if (msg.payload?.actionType === "start_game")
        route.send(JSON.stringify({ type: "game_started", payload: { state: active } }));
    });
    route.send(
      JSON.stringify({
        type: "connected",
        payload: { state: waiting, isHost: true, roomCode: link.roomCode },
      }),
    );
  });
  await page.goto("/connect4");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByRole("heading", { name: "Set up your table", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Alex avatar", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("lobby.png") });
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByRole("button", { name: "Drop in column 1", exact: true }).click();
  expect(received).toContainEqual({
    type: "action",
    payload: { actionType: "drop_disc", data: { col: 0 } },
  });
  const terminal = { ...active, status: "ended", winner: "preview-0" };

  const rewatch = {
    version: 1,
    visibility: "full_reveal",
    gameType: "connect4",
    frames: [
      { index: 0, at: 0, label: "start", state: active },
      { index: 1, at: 1, label: "finish", state: terminal },
    ],
  };

  ws!.send(
    JSON.stringify({
      type: "game_ended",
      payload: { finalState: terminal, rewatch, reason: "connect4" },
    }),
  );
  await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
  await expect(page.getByLabel("Final board")).toBeVisible();
  await expect(page.getByRole("button", { name: /Drop in column/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find another game", exact: true })).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Watch replay" })).toBeVisible();
  await expect.poll(() => received).toContainEqual({ type: "rewatch_saved" });
  expect(await page.evaluate(() => localStorage.getItem("llmgames-rewatch:room-demo"))).toBeNull();
  await page.getByRole("button", { name: "Watch replay" }).click();
  await expect(page.getByLabel("Replay position")).toBeVisible();
  await expect(page.getByRole("button", { name: /Drop in column/ })).toHaveCount(0);
});

test("join resolves game from server and socket loss disables board", async ({ page }) => {
  let current: WebSocketRoute;
  let connect = true;
  await page.route("**/api/v1/rooms/join", (r) => r.fulfill({ json: link }));
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
    current = ws;

    if (connect)
      ws.send(JSON.stringify({ type: "connected", payload: { state: active, isHost: true } }));
  });
  await page.goto("/reversi?roomCode=DEMO12");
  await expect(page).toHaveURL(/connect4\?roomCode=DEMO12/);
  await expect(page.getByRole("button", { name: "Drop in column 1", exact: true })).toBeEnabled();
  connect = false;
  current!.close();
  await expect(page.getByRole("button", { name: "Drop in column 1", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
});

test("client navigation onto a roomCode query auto-joins", async ({ page }) => {
  let releaseJoin = () => {};

  await page.route("**/api/v1/rooms/join", async (r) => {
    await new Promise<void>((resolve) => {
      releaseJoin = resolve;
    });
    await r.fulfill({ json: link });
  });
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) =>
    ws.send(
      JSON.stringify({
        type: "connected",
        payload: { state: waiting, isHost: true, roomCode: link.roomCode },
      }),
    ),
  );
  await page.goto("/connect4");
  await expect(page.getByRole("button", { name: "Create room" })).toBeEnabled();
  await page.evaluate(() => {
    const nav = window.llmgamesNavigate;

    if (!nav) throw new Error("Navigation hook is missing");
    nav("/connect4?roomCode=DEMO12");
  });
  await expect(page.getByText("Connecting to game…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create room" })).toHaveCount(0);
  releaseJoin();
  await expect(page.getByRole("heading", { name: "Set up your table", exact: true })).toBeVisible();
});

test("legacy room query auto-joins on direct entry and becomes canonical", async ({ page }) => {
  await page.route("**/api/v1/rooms/join", async (r) => {
    expect(r.request().postDataJSON()).toMatchObject({ roomCode: "DEMO12" });
    await r.fulfill({ json: link });
  });
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) =>
    ws.send(
      JSON.stringify({
        type: "connected",
        payload: { state: waiting, isHost: true, roomCode: link.roomCode },
      }),
    ),
  );
  await page.goto("/connect4?room=demo12");
  await expect(page).toHaveURL(/\/connect4\?roomCode=DEMO12$/);
  await expect(page.getByRole("heading", { name: "Set up your table", exact: true })).toBeVisible();
});

test("client navigation onto a legacy room query auto-joins", async ({ page }) => {
  await page.route("**/api/v1/rooms/join", (r) => r.fulfill({ json: link }));
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) =>
    ws.send(
      JSON.stringify({
        type: "connected",
        payload: { state: waiting, isHost: true, roomCode: link.roomCode },
      }),
    ),
  );
  await page.goto("/connect4");
  await page.evaluate(() => {
    const nav = window.llmgamesNavigate;

    if (!nav) throw new Error("Navigation hook is missing");
    nav("/connect4?room=DEMO12");
  });
  await expect(page).toHaveURL(/\/connect4\?roomCode=DEMO12$/);
  await expect(page.getByRole("heading", { name: "Set up your table", exact: true })).toBeVisible();
});

test("retry cleanup keeps the replacement socket connected", async ({ page }) => {
  const sockets: WebSocketRoute[] = [];
  let respond = true;
  await page.route("**/api/v1/rooms/join", (r) => r.fulfill({ json: link }));
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
    sockets.push(ws);

    if (respond)
      ws.send(JSON.stringify({ type: "connected", payload: { state: active, isHost: true } }));
  });
  await page.goto("/reversi?roomCode=DEMO12");
  await expect(page.getByRole("button", { name: "Drop in column 1", exact: true })).toBeEnabled();
  respond = false;
  const before = sockets.length;
  sockets.at(-1)!.close();
  await expect.poll(() => sockets.length).toBeGreaterThan(before);
  respond = true;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Drop in column 1", exact: true })).toBeEnabled();
  await page.waitForTimeout(1200);
  await expect(page.getByText("Reconnecting…", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Drop in column 1", exact: true })).toBeEnabled();
});

test("spectator host keeps active host controls", async ({ page }) => {
  const spectatorHost = { ...active, you: { ...active.you, isHost: true, isSpectator: true } };
  await page.route("**/api/v1/rooms/join", (r) => r.fulfill({ json: link }));
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) =>
    ws.send(
      JSON.stringify({
        type: "connected",
        payload: { state: spectatorHost, isHost: true, isSpectator: true },
      }),
    ),
  );
  await page.goto("/connect4?roomCode=DEMO12");
  await expect(page.getByRole("heading", { name: "Connect 4", exact: true })).toBeVisible();
  await page.getByLabel("Game options", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "End game", exact: true })).toBeVisible();
  await expect(page.getByLabel("Leave game", { exact: true })).toBeVisible();
});

test("end confirmation stays open when the socket drops", async ({ page }) => {
  let socket: WebSocketRoute;
  await page.route("**/api/v1/rooms/join", (r) => r.fulfill({ json: link }));
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
    socket = ws;
    ws.send(JSON.stringify({ type: "connected", payload: { state: active, isHost: true } }));
  });
  await page.goto("/connect4?roomCode=DEMO12");
  await expect(page.getByRole("button", { name: "Drop in column 1", exact: true })).toBeVisible();
  await page.getByLabel("Game options", { exact: true }).click();
  await page.getByRole("button", { name: "End game", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  socket!.close();
  await expect(page.getByText("Reconnecting…", { exact: false })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "End game", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("server join errors keep the form usable", async ({ page }) => {
  await page.route("**/api/v1/rooms/join", (r) =>
    r.fulfill({ status: 404, json: { error: "Room not found" } }),
  );
  await page.goto("/connect4");
  await page.getByLabel("Room code").fill("BAD123");
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Room not found");
  await expect(page.getByRole("button", { name: "Join", exact: true })).toBeEnabled();
});

test("host can tap a player and move them to spectators", async ({ page }) => {
  const lobby = {
    ...waiting,
    players: [
      { id: "preview-0", name: "Alex" },
      { id: "preview-1", name: "Mika" },
    ],
    spectators: [{ id: "preview-2", name: "Jules" }],
    you: { ...waiting.you, playerId: "preview-0", isHost: true },
  };

  const actions: unknown[] = [];
  await page.route("**/api/v1/rooms/join", (r) => r.fulfill({ json: link }));
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
    ws.onMessage((data) => actions.push(JSON.parse(String(data))));
    ws.send(JSON.stringify({ type: "connected", payload: { state: lobby, isHost: true } }));
  });
  await page.goto("/connect4?roomCode=DEMO12");
  await page.getByRole("button", { name: "Move Mika", exact: true }).click();
  await expect(page.getByText("Mika: choose a destination below.", { exact: true })).toBeVisible();
  await page
    .getByRole("region", { name: "Spectators", exact: true })
    .getByRole("button", { name: "Move here", exact: true })
    .click();
  await expect
    .poll(() => actions)
    .toContainEqual({
      type: "action",
      payload: { actionType: "move_player_to_spectator", data: { playerId: "preview-1" } },
    });
});

test("host can drag a player into spectators", async ({ page }) => {
  const lobby = {
    ...waiting,
    players: [
      { id: "preview-0", name: "Alex" },
      { id: "preview-1", name: "Mika" },
    ],
    spectators: [{ id: "preview-2", name: "Jules" }],
    you: { ...waiting.you, playerId: "preview-0", isHost: true },
  };

  const actions: unknown[] = [];
  await page.route("**/api/v1/rooms/join", (r) => r.fulfill({ json: link }));
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
    ws.onMessage((data) => actions.push(JSON.parse(String(data))));
    ws.send(JSON.stringify({ type: "connected", payload: { state: lobby, isHost: true } }));
  });
  await page.goto("/connect4?roomCode=DEMO12");
  await page.locator(".lobby-settings>summary").click();
  const card = page.getByRole("button", { name: "Move Mika", exact: true });
  const target = page.getByRole("region", { name: "Spectators", exact: true });
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  expect(from).toBeTruthy();
  expect(to).toBeTruthy();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() => actions)
    .toContainEqual({
      type: "action",
      payload: { actionType: "move_player_to_spectator", data: { playerId: "preview-1" } },
    });
});

test("keyboard selection can choose a lobby destination", async ({ page }) => {
  const lobby = {
    ...waiting,
    players: [
      { id: "preview-0", name: "Alex" },
      { id: "preview-1", name: "Mika" },
    ],
    spectators: [{ id: "preview-2", name: "Jules" }],
    you: { ...waiting.you, playerId: "preview-0", isHost: true },
  };

  const actions: unknown[] = [];
  await page.route("**/api/v1/rooms/join", (r) => r.fulfill({ json: link }));
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
    ws.onMessage((data) => actions.push(JSON.parse(String(data))));
    ws.send(JSON.stringify({ type: "connected", payload: { state: lobby, isHost: true } }));
  });
  await page.goto("/connect4?roomCode=DEMO12");
  await page.getByRole("button", { name: "Move Mika", exact: true }).press("Enter");
  await expect(page.getByText("Mika: choose a destination below.", { exact: true })).toBeVisible();
  await page
    .getByRole("region", { name: "Spectators", exact: true })
    .getByRole("button", { name: "Move here", exact: true })
    .press("Enter");
  await expect
    .poll(() => actions)
    .toContainEqual({
      type: "action",
      payload: { actionType: "move_player_to_spectator", data: { playerId: "preview-1" } },
    });
});

test("full table disables moving a spectator into player seats", async ({ page }) => {
  const lobby = {
    ...waiting,
    players: [
      { id: "preview-0", name: "Alex" },
      { id: "preview-1", name: "Mika" },
    ],
    spectators: [{ id: "preview-2", name: "Jules" }],
    you: { ...waiting.you, playerId: "preview-0", isHost: true },
  };

  await page.route("**/api/v1/rooms/join", (r) => r.fulfill({ json: link }));
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) =>
    ws.send(JSON.stringify({ type: "connected", payload: { state: lobby, isHost: true } })),
  );
  await page.goto("/connect4?roomCode=DEMO12");
  await page.locator(".lobby-settings>summary").click();
  await page.getByRole("button", { name: "Move Jules", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Players", exact: true })
      .getByRole("button", { name: "Move here", exact: true }),
  ).toBeDisabled();
});

test("guest can choose only their own codenames role", async ({ page }) => {
  const source = fixture("codenames");

  const lobby = {
    ...source,
    status: "waiting",
    you: { ...source.you, playerId: "preview-0", isHost: false },
  };

  await page.route("**/api/v1/rooms/join", (r) =>
    r.fulfill({ json: { ...link, gameType: "codenames" } }),
  );
  await page.routeWebSocket("**/api/v1/ws/**", (ws) =>
    ws.send(JSON.stringify({ type: "connected", payload: { state: lobby, isHost: false } })),
  );
  await page.goto("/codenames?roomCode=DEMO12");
  await expect(page.getByRole("button", { name: "Move Alex", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Move BrightRook", exact: true })).toBeDisabled();
});

test("host can override an occupied codenames spymaster seat", async ({ page }) => {
  const source = fixture("codenames");

  const lobby = {
    ...source,
    status: "waiting",
    you: { ...source.you, playerId: "preview-0", isHost: true },
  };

  const actions: unknown[] = [];
  await page.route("**/api/v1/rooms/join", (r) =>
    r.fulfill({ json: { ...link, gameType: "codenames" } }),
  );
  await page.routeWebSocket("**/api/v1/ws/**", (ws) => {
    ws.onMessage((data) => actions.push(JSON.parse(String(data))));
    ws.send(JSON.stringify({ type: "connected", payload: { state: lobby, isHost: true } }));
  });
  await page.goto("/codenames?roomCode=DEMO12");
  await page.getByRole("button", { name: "Move Alex", exact: true }).click();
  await page
    .getByRole("region", { name: "Blue spymaster", exact: true })
    .getByRole("button", { name: "Move here", exact: true })
    .click();
  await expect
    .poll(() => actions)
    .toContainEqual({
      type: "action",
      payload: {
        actionType: "assign_codenames_role",
        data: { playerId: "preview-0", team: "blue", role: "spymaster" },
      },
    });
});

test("start stays disabled below the player minimum", async ({ page }) => {
  const lobby = {
    ...waiting,
    players: [{ id: "preview-0", name: "Alex" }],
    you: { ...waiting.you, playerId: "preview-0", isHost: true },
  };

  await page.route("**/api/v1/rooms/join", (r) => r.fulfill({ json: link }));
  await page.routeWebSocket("**/api/v1/ws/**", (ws) =>
    ws.send(JSON.stringify({ type: "connected", payload: { state: lobby, isHost: true } })),
  );
  await page.goto("/connect4?roomCode=DEMO12");
  await expect(page.getByRole("button", { name: "Start game", exact: true })).toBeDisabled();
});

for (const gameType of [
  "connect4",
  "reversi",
  "codenames",
  "poker",
  "pokemon",
  "battleship",
  "contexto",
])
  test(`waiting lobby seats players directly for ${gameType}`, async ({ page }) => {
    const source = fixture(gameType);

    const lobby = {
      ...source,
      status: "waiting",
      players: [{ id: "preview-0", name: "Alex" }],
      spectators: [{ id: "preview-1", name: "Mika" }],
      maxPlayers: gameType === "codenames" ? 4 : 2,
      you: { ...source.you, playerId: "preview-0", isHost: true, isSpectator: false },
      assignments:
        gameType === "codenames" ? { "preview-0": { team: "red", role: "operative" } } : undefined,
    };

    await page.route("**/api/v1/rooms/join", (r) =>
      r.fulfill({ json: { ...link, gameType: gameType, roomCode: "DEMO12" } }),
    );
    await page.routeWebSocket("**/api/v1/ws/**", (ws) =>
      ws.send(JSON.stringify({ type: "connected", payload: { state: lobby, isHost: true } })),
    );
    await page.goto(`/${gameRouteSlug(gameType)}?roomCode=DEMO12`);
    await expect(
      page.getByRole("heading", { name: "Set up your table", exact: true }),
    ).toBeVisible();

    if (gameType === "codenames") {
      await expect(
        page
          .getByRole("region", { name: "Red operatives", exact: true })
          .getByRole("button", { name: "Move Alex", exact: true }),
      ).toBeVisible();
    } else {
      await expect(
        page
          .getByRole("region", { name: "Players", exact: true })
          .getByRole("button", { name: "Move Alex", exact: true }),
      ).toBeVisible();
    }

    await expect(page.getByRole("region", { name: "Spectators", exact: true })).toBeHidden();
    await page.locator(".lobby-settings>summary").click();
    await expect(
      page
        .getByRole("region", { name: "Spectators", exact: true })
        .getByRole("button", { name: "Move Mika", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Waiting to choose", { exact: true })).toHaveCount(0);
  });

test("codenames roles reset without a waiting bucket", async ({ page }) => {
  const source = fixture("codenames");

  const lobby = {
    ...source,
    status: "waiting",
    you: { ...source.you, playerId: "preview-0", isHost: true },
    assignments: {
      "preview-0": { team: "red", role: "operative" },
      "preview-1": { team: "red", role: "spymaster" },
    },
  };

  const updated = {
    ...lobby,
    assignments: {
      "preview-0": { team: "red", role: "operative" },
      "preview-1": { team: "red", role: "spymaster" },
      "preview-2": { team: "blue", role: "operative" },
      "preview-3": { team: "blue", role: "spymaster" },
    },
  };

  const actions: unknown[] = [];
  await page.route("**/api/v1/rooms/join", (r) =>
    r.fulfill({ json: { ...link, gameType: "codenames" } }),
  );
  await page.routeWebSocket("**/api/v1/ws/**", (ws) => {
    ws.onMessage((data) => {
      const msg = JSON.parse(String(data));
      actions.push(msg);

      if (msg.payload?.actionType === "reset_codenames_roles")
        ws.send(JSON.stringify({ type: "state", payload: updated }));
    });
    ws.send(JSON.stringify({ type: "connected", payload: { state: lobby, isHost: true } }));
  });
  await page.goto("/codenames?roomCode=DEMO12");
  await expect(page.getByRole("region", { name: "Waiting to choose", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reset teams", exact: true }).click();
  await expect
    .poll(() => actions)
    .toContainEqual({ type: "action", payload: { actionType: "reset_codenames_roles", data: {} } });

  for (const name of ["Alex", "BrightRook", "Jules", "Sam"])
    await expect(page.getByRole("button", { name: `Move ${name}`, exact: true })).toBeVisible();
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`lobby and host controls ${viewport.width}`, async ({ page }, info) => {
    let stream: WebSocketRoute;
    await page.setViewportSize(viewport);
    await page.route("**/api/v1/rooms/join", (r) => r.fulfill({ json: link }));
    await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
      stream = ws;
      ws.send(JSON.stringify({ type: "connected", payload: { state: waiting, isHost: true } }));
    });
    await page.goto("/connect4?roomCode=DEMO12");
    await expect(page.getByRole("button", { name: "Start game", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("lobby.png") });
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
    stream!.send(JSON.stringify({ type: "game_started", payload: { state: active } }));
    await page.getByLabel("Game options", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("live-room.png") });
    await page.getByRole("button", { name: "End game", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Keep playing", exact: true }).click();
  });
