import { cardSeatsSchema, contextoProgressSchema, seaSchema } from "../src/domain/view-contracts";

import { test, expect, type WebSocketRoute, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture } from "../src/dev/previewFixtures";
import { applyPreviewScenario } from "../src/dev/previewScenarios";
import { gameRouteSlug } from "@llmgames/game-catalog";

async function joinPreviewRoom(page: Page, game: string) {
  let socket: WebSocketRoute;
  const active = fixture(game);
  await page.route("**/api/v1/auth/users/me", (r) =>
    r.fulfill({
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
  await page.route("**/api/v1/rooms/join", (r) =>
    r.fulfill({
      json: {
        roomId: "result-audit",
        roomCode: "END234",
        gameType: game,
        gameStatus: "playing",
        wsUrl: "ws://localhost/api/v1/ws/games/result-audit",
      },
    }),
  );
  await page.routeWebSocket("**/api/v1/ws/games/**", (ws) => {
    socket = ws;
    ws.send(
      JSON.stringify({
        type: "connected",
        payload: { state: active, isHost: true, roomCode: "END234" },
      }),
    );
  });
  await page.goto(`/${gameRouteSlug(game)}?roomCode=END234`);
  await expect(page.locator(".match-desk")).toBeVisible();

  return socket!;
}

const games = [
  "connect4",
  "reversi",
  "checkers",
  "codenames",
  "poker",
  "pokemon",
  "battleship",
  "contexto",
];

for (const game of games)
  for (const { width, height } of [
    { width: 390, height: 900 },
    { width: 1280, height: 650 },
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ])
    test(`${game} result screen ${width}x${height}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height });
      const socket = await joinPreviewRoom(page, game);

      const active = fixture(game),
        finalState = applyPreviewScenario(active, game, "win");

      const rewatch = {
        version: 1,
        visibility: "full_reveal",
        gameType: game,
        frames: [
          { index: 0, at: 0, label: "start", state: active },
          { index: 1, at: 1, label: "finish", state: finalState },
        ],
      };

      socket.send(JSON.stringify({ type: "game_ended", payload: { finalState, rewatch } }));
      const summary = page.getByRole("region", { name: "Match summary" });
      await expect(summary).toBeVisible();
      await expect(summary.getByRole("heading", { level: 1 })).toContainText(/win/i);

      if (game === "pokemon")
        await expect(page.getByRole("region", { name: "Final state" })).toHaveCount(0);
      else
        await expect(
          page.getByRole("region", {
            name: ["connect4", "reversi", "checkers"].includes(game)
              ? "Final board"
              : "Final state",
          }),
        ).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Find another game", exact: true }),
      ).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Watch replay", exact: true })).toHaveCount(1);
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
      ).toEqual([]);
      await expect(page.locator(".result-player")).toHaveCount(fixture(game).players!.length);

      for (const card of await page.locator(".result-player").all()) {
        const alignment = await card.evaluate((element) => {
          const style = getComputedStyle(element),
            bounds = element.getBoundingClientRect();

          const avatar = element.querySelector(".result-avatar")!.getBoundingClientRect();
          const name = element.querySelector(".result-player-name")!;

          return {
            avatarOffset:
              avatar.left -
              bounds.left -
              parseFloat(style.paddingLeft) -
              parseFloat(style.borderLeftWidth),
            textAlign: getComputedStyle(name).textAlign,
            alignItems: getComputedStyle(name).alignItems,
          };
        });

        expect(Math.abs(alignment.avatarOffset)).toBeLessThanOrEqual(1);
        expect(alignment.textAlign).toBe("left");
        expect(alignment.alignItems).toBe("flex-start");
      }

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );

      if (width >= 1280) {
        const fit = await page.locator(".match-result").evaluate((element) => {
          const scene = element.querySelector(".result-final, .result-board");
          const actions = element.querySelector(".result-actions");
          const bounds = element.getBoundingClientRect();

          return {
            scroll: element.scrollHeight - element.clientHeight,
            mainScroll: scene ? scene.scrollHeight - scene.clientHeight : 0,
            sceneBottom: scene?.getBoundingClientRect().bottom ?? 0,
            actionsTop: actions?.getBoundingClientRect().top ?? 0,
            actionsBottom: actions?.getBoundingClientRect().bottom ?? 0,
            viewportBottom: Math.min(bounds.bottom, innerHeight),
          };
        });

        expect(fit.scroll, `${game} result overflow at ${width}px`).toBeLessThanOrEqual(2);
        expect(fit.mainScroll, `${game} final state overflow at ${width}px`).toBeLessThanOrEqual(2);
        expect(
          fit.actionsTop,
          `${game} actions overlap the final state at ${width}px`,
        ).toBeGreaterThanOrEqual(fit.sceneBottom + 4);
        expect(
          fit.actionsBottom,
          `${game} actions below the fold at ${width}px`,
        ).toBeLessThanOrEqual(fit.viewportBottom + 1);
      }

      await page.screenshot({ path: info.outputPath("result-screen.png"), fullPage: true });
      await page.getByRole("button", { name: "Find another game" }).last().click();
      await expect(page).toHaveURL(/\/play$/);
    });

test("ship result reveals both fleets from the final rewatch frame", async ({ page }, info) => {
  const socket = await joinPreviewRoom(page, "battleship");
  const active = fixture("battleship");
  const ended = { ...active, status: "ended", winner: "preview-0" };

  const own = seaSchema.parse(active.yourBoard);

  if (!own.ships || !own.cells) throw new Error("Missing Battleship fleet fixture");

  const ownCells = own.cells;

  const revealedShips = own.ships.map((ship) => ({
    ...ship,
    cells: ownCells.flatMap((line, row) =>
      line.flatMap((id, col) => (id === ship.id ? [{ row, col }] : [])),
    ),
  }));

  const revealed = {
    ...ended,
    opponent: { ...seaSchema.parse(ended.opponent), playerId: "preview-1", revealedShips },
  };

  const rewatch = {
    version: 1,
    visibility: "full_reveal",
    gameType: "battleship",
    frames: [
      { index: 0, at: 0, label: "start", state: active },
      { index: 1, at: 1, label: "finish", state: revealed },
    ],
  };

  socket.send(JSON.stringify({ type: "game_ended", payload: { finalState: ended, rewatch } }));
  await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
  await expect(page.locator(".result-ships .doodle-ship")).toHaveCount(10);
  await expect(
    page.locator(".result-ships .sea").nth(1).locator('.sea-cell[data-row="1"][data-col="1"]'),
  ).toHaveAttribute("data-ship", "true");
  await expect(
    page.locator(".result-ships .sea").nth(0).locator('.sea-cell[data-row="1"][data-col="1"]'),
  ).toHaveAttribute("data-ship", "true");
  await page.screenshot({ path: info.outputPath("revealed-fleets.png"), fullPage: true });
});

test("large desktop ship result uses the real board and recorded weapons", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  const socket = await joinPreviewRoom(page, "battleship");

  const active = fixture("battleship"),
    ended = applyPreviewScenario(active, "battleship", "win");

  const rewatch = {
    version: 1,
    visibility: "full_reveal",
    gameType: "battleship",
    frames: [
      { index: 0, at: 0, label: "start", state: active },
      { index: 1, at: 1, label: "finish", state: ended },
    ],
  };

  socket.send(JSON.stringify({ type: "game_ended", payload: { finalState: ended, rewatch } }));
  const final = page.getByRole("region", { name: "Final state" });
  await expect(final.getByText("Final fleets", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(final.locator(".sea").nth(1).locator(".doodle-ship")).toHaveCount(5);
  await expect(final.locator(".radar-scan")).not.toHaveCount(0);
  await expect(final.locator(".bombed-area")).not.toHaveCount(0);
  await expect(final.locator(".torpedo-path")).not.toHaveCount(0);
  await expect(final.locator("[data-mine=true]")).not.toHaveCount(0);

  const trophy = await page.locator(".result-trophy").boundingBox(),
    heading = await page.locator(".result-summary h1").boundingBox();

  expect(trophy!.y + trophy!.height).toBeLessThanOrEqual(heading!.y);
  const panel = await final.boundingBox();
  expect(panel!.width).toBeGreaterThan(650);
  expect(panel!.width).toBeLessThanOrEqual(760);

  for (const sea of await final.locator(".sea").all()) {
    const board = await sea.locator(".sea-grid").boundingBox(),
      player = await sea.locator(".result-player").boundingBox();

    expect(player!.y).toBeGreaterThan(board!.y + board!.height);
  }

  expect(panel!.y + panel!.height).toBeLessThan(2160);
  await final.screenshot({ path: info.outputPath("large-final-panel.png") });
  await page.locator("body").screenshot({ path: info.outputPath("large-final-fleets.png") });
});

test("ship design preview includes a playable final replay", async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/design-preview/battleship?state=win");
  await expect(page.locator(".result-ships .doodle-ship")).toHaveCount(10);
  await expect(page.getByRole("button", { name: "Watch replay" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page
    .locator(".preview-result-shell")
    .screenshot({ path: info.outputPath("preview-final-fleets.png") });
  await page.getByRole("button", { name: "Watch replay" }).click();
  await expect(page.getByLabel("Replay position")).toBeVisible();
  await page.getByLabel("Replay position").focus();
  await page.getByLabel("Replay position").press("End");
  await expect(page.locator(".match-desk[data-phase=ended]")).toBeVisible();
  await page.getByRole("button", { name: "Back to result" }).click();
  await expect(page.getByRole("region", { name: "Final state" })).toBeVisible();
});

test("result replay opens and returns to the result beside the exit action", async ({ page }) => {
  const socket = await joinPreviewRoom(page, "connect4");

  const active = fixture("connect4"),
    finalState = applyPreviewScenario(active, "connect4", "win");

  const rewatch = {
    version: 1,
    visibility: "full_reveal",
    gameType: "connect4",
    frames: [
      { index: 0, at: 0, label: "start", state: active },
      { index: 1, at: 1, label: "finish", state: finalState },
    ],
  };

  socket.send(JSON.stringify({ type: "game_ended", payload: { finalState, rewatch } }));

  const replay = page.getByRole("button", { name: "Watch replay" }),
    exit = page.getByRole("button", { name: "Find another game" });

  await expect(replay).toBeVisible();
  await expect(exit).toBeVisible();

  const replayBox = await replay.boundingBox(),
    exitBox = await exit.boundingBox();

  expect(
    Math.abs(replayBox!.y + replayBox!.height / 2 - (exitBox!.y + exitBox!.height / 2)),
  ).toBeLessThan(1);
  expect(replayBox!.x + replayBox!.width).toBeLessThan(exitBox!.x);
  await replay.click();
  await expect(page.locator(".match-desk")).toBeVisible();
  await page.getByRole("button", { name: "Back to result" }).click();
  await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
});

test("Contexto result shows the best five final words and empty slots", async ({ page }) => {
  const socket = await joinPreviewRoom(page, "contexto");
  const active = fixture("contexto");
  const ended = { ...active, status: "ended", winner: "preview-0", secret: "ocean" };

  const progress = contextoProgressSchema.parse(structuredClone(ended.progress));

  progress["preview-1"]!.guesses = [
    { word: "late", rank: 900, sequence: 15 },
    { word: "tide", rank: 8, sequence: 12 },
    { word: "wave", rank: 17, sequence: 11 },
    { word: "shore", rank: 31, sequence: 10 },
    { word: "sea", rank: 3, sequence: 9 },
    { word: "boat", rank: 50, sequence: 8 },
  ];
  progress["preview-1"]!.bestRank = 3;
  progress["preview-5"]!.guesses = [
    { word: "deep", rank: 3310, sequence: 2 },
    { word: "blue", rank: 3480, sequence: 1 },
  ];
  const revealed = { ...ended, progress };

  const rewatch = {
    version: 1,
    visibility: "full_reveal",
    gameType: "contexto",
    frames: [
      { index: 0, at: 0, label: "start", state: active },
      { index: 1, at: 1, label: "finish", state: revealed },
    ],
  };

  socket.send(JSON.stringify({ type: "game_ended", payload: { finalState: ended, rewatch } }));
  const final = page.getByRole("region", { name: "Final state" });
  await expect(final).toBeVisible();
  await expect(final.getByText("Last guesses")).toHaveCount(0);
  await expect(final.getByText("Final word")).toBeVisible();
  await expect(final.getByText("ocean")).toBeVisible();
  const opponent = final.locator(".result-guess-player").nth(1);
  await expect(opponent.locator("li")).toHaveCount(5);
  await expect(opponent.locator("li")).toContainText([
    "sea3",
    "tide8",
    "wave17",
    "shore31",
    "boat50",
  ]);
  await expect(opponent).not.toContainText("late");
  await expect(opponent).not.toContainText("#");
  await expect(final.getByText(/Best rank/)).toHaveCount(0);

  const closeColor = await opponent
    .locator("li")
    .first()
    .evaluate((element) => getComputedStyle(element, "::before").backgroundColor);

  const farColor = await final
    .locator(".result-guess-player")
    .last()
    .locator("li")
    .first()
    .evaluate((element) => getComputedStyle(element, "::before").backgroundColor);

  expect(closeColor).not.toBe(farColor);
  const sparse = final.locator(".result-guess-player").last();
  await expect(sparse.locator("li")).toHaveCount(5);
  await expect(sparse.locator(".result-guess-placeholder")).toHaveCount(3);
});

test("Poker result shows final chips while replay retains the hand", async ({ page }) => {
  const socket = await joinPreviewRoom(page, "poker");
  const active = fixture("poker");
  const ended = { ...active, status: "ended", winner: "preview-0" };

  const seats = cardSeatsSchema.parse(ended.seats).map((seat) =>
    seat.playerId === "preview-1"
      ? {
          ...seat,
          hole: [
            { rank: "K", suit: "H" },
            { rank: "Q", suit: "D" },
          ],
        }
      : seat,
  );

  const revealed = { ...ended, seats };

  const rewatch = {
    version: 1,
    visibility: "full_reveal",
    gameType: "poker",
    frames: [
      { index: 0, at: 0, label: "start", state: active },
      { index: 1, at: 1, label: "finish", state: revealed },
    ],
  };

  socket.send(JSON.stringify({ type: "game_ended", payload: { finalState: ended, rewatch } }));
  const final = page.getByRole("region", { name: "Final state" });
  await expect(final.getByRole("heading", { name: "Final chips" })).toBeVisible();
  await expect(final.locator(".result-poker-standing")).toHaveCount(seats.length);
  await expect(final.getByRole("img", { name: "K of hearts" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Watch replay" })).toBeVisible();
});

test("Connect 4 shows the winning bounce before the result", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const socket = await joinPreviewRoom(page, "connect4");
  const active = fixture("connect4");
  const board = Array.from({ length: 6 }, () => Array<number>(7).fill(0));
  board[5]![0] = 1;
  board[5]![1] = 1;
  board[5]![2] = 1;
  socket.send(JSON.stringify({ type: "state", payload: { ...active, board } }));
  await expect(page.locator('.discs-cell[data-row="5"][data-col="3"]')).toHaveAttribute(
    "aria-label",
    /empty/,
  );
  const finalBoard = board.map((row) => [...row]);
  finalBoard[5]![3] = 1;
  socket.send(
    JSON.stringify({
      type: "game_ended",
      payload: {
        finalState: {
          ...active,
          board: finalBoard,
          status: "ended",
          winner: "preview-0",
          lastMove: { row: 5, col: 3, seat: 1 },
        },
      },
    }),
  );
  await expect(
    page.locator(".match-desk[data-finishing=true] .discs-cell[data-winning=true]"),
  ).toHaveCount(4);
  await expect(page.getByRole("region", { name: "Match summary" })).toHaveCount(0);
  await page.waitForTimeout(950);
  await page.screenshot({ path: info.outputPath("winning-bounce.png") });
  await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
});

test("Pokémon finishes the final attack before showing rewatch", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const socket = await joinPreviewRoom(page, "pokemon");
  const active = fixture("pokemon");

  const ended = {
    ...active,
    status: "ended",
    winner: "preview-0",
    battleLog: [
      ...(active.battleLog ?? []),
      "|move|p1a: Charizard|Slash|p2a: Blastoise",
      "|-damage|p2a: Blastoise|0 fnt",
      "|faint|p2a: Blastoise",
      "|win|Alex",
    ],
  };

  const rewatch = {
    version: 1,
    visibility: "full_reveal",
    gameType: "pokemon",
    frames: [
      { index: 0, at: 0, label: "start", state: active },
      { index: 1, at: 1, label: "finish", state: ended },
    ],
  };

  socket.send(JSON.stringify({ type: "game_ended", payload: { finalState: ended, rewatch } }));
  await expect(page.locator(".match-desk[data-finishing=true] .pokemon-stage")).toBeVisible();
  await expect(page.getByRole("button", { name: "Watch replay" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Watch replay" })).toBeVisible();
});

test("Poker keeps the last hand visible until playback catches up", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const socket = await joinPreviewRoom(page, "poker");
  const active = fixture("poker");

  const ended = {
    ...active,
    status: "ended",
    winner: "preview-0",
    lastHandResult: {
      winners: ["preview-0"],
      showdown: true,
      pot: 150,
      payouts: [{ playerId: "preview-0", amount: 150 }],
    },
  };

  socket.send(JSON.stringify({ type: "game_ended", payload: { finalState: ended } }));
  await expect(page.locator(".match-desk[data-finishing=true] .poker-workspace")).toBeVisible();
  await expect(page.getByRole("region", { name: "Match summary" })).toHaveCount(0);
  await expect(page.locator(".poker-table-story")).toContainText("wins the pot");
  await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
});

for (const game of games)
  for (const width of [390, 1440])
    test(`${game} spectator result is full-screen without controls ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/design-preview/spectator?state=watch-${gameRouteSlug(game)}-win`);
      const result = page.locator(".match-result[data-broadcast=true]");
      await expect(result).toBeVisible();
      await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /Back to games|Find another game/ }),
      ).toHaveCount(0);
      await expect(page.locator(".result-heading,.result-actions")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await result.screenshot({ path: info.outputPath("spectator-result.png") });
    });

test("ship room keeps its result and replay after terminal socket close", async ({ page }) => {
  const active = fixture("battleship");
  let ws: WebSocketRoute;
  const sent: unknown[] = [];
  await page.route("**/api/v1/auth/users/me", (r) =>
    r.fulfill({
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
  await page.route("**/api/v1/rooms/join", (r) =>
    r.fulfill({
      json: {
        roomId: "ship-terminal",
        roomCode: "ABC234",
        gameType: "battleship",
        gameStatus: "playing",
        wsUrl: "ws://localhost/api/v1/ws/games/ship-terminal",
      },
    }),
  );
  await page.routeWebSocket("**/api/v1/ws/games/**", (socket) => {
    ws = socket;
    socket.onMessage((data) => sent.push(JSON.parse(String(data))));
    socket.send(
      JSON.stringify({
        type: "connected",
        payload: { state: active, isHost: true, roomCode: "ABC234" },
      }),
    );
  });
  await page.goto("/battleship?roomCode=ABC234");
  await expect(page.locator(".sea")).toHaveCount(2);
  const ended = { ...active, status: "ended", winner: "preview-0" };

  const rewatch = {
    version: 1,
    visibility: "full_reveal",
    gameType: "battleship",
    frames: [
      { index: 0, at: 0, label: "start", state: active },
      { index: 1, at: 1, label: "finish", state: ended },
    ],
  };

  ws!.send(JSON.stringify({ type: "game_ended", payload: { finalState: ended, rewatch } }));
  await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
  ws!.send(JSON.stringify({ type: "state", payload: active }));
  await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
  ws!.close();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => sent).toContainEqual({ type: "rewatch_saved" });
  await page.getByRole("button", { name: "Watch replay" }).click();
  await expect(page.locator(".sea")).toHaveCount(2);
  await expect(page.getByLabel("Replay position")).toBeVisible();
  await page.getByRole("button", { name: "Back to result" }).click();
  await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a draw has no winner badge or confetti", async ({ page }) => {
  const socket = await joinPreviewRoom(page, "codenames");
  socket.send(
    JSON.stringify({
      type: "game_ended",
      payload: { finalState: applyPreviewScenario(fixture("codenames"), "codenames", "draw") },
    }),
  );
  await expect(page.getByRole("region", { name: "Match summary" })).toContainText(
    "A draw. Well played.",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".result-art[data-celebrate=true]")).toHaveCount(0);
  await expect(page.locator(".result-player[data-winner=true]")).toHaveCount(0);
});

test("Pokemon result stays compact with the finished replay available", async ({ page }) => {
  const socket = await joinPreviewRoom(page, "pokemon");
  const active = fixture("pokemon");
  const revealed = applyPreviewScenario(active, "pokemon", "win");
  const projected = { ...revealed, sides: active.sides };

  const rewatch = {
    version: 1,
    visibility: "full_reveal",
    gameType: "pokemon",
    frames: [
      { index: 0, at: 0, label: "start", state: active },
      { index: 1, at: 1, label: "finish", state: revealed },
    ],
  };

  socket.send(JSON.stringify({ type: "game_ended", payload: { finalState: projected, rewatch } }));
  await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Final teams" })).toHaveCount(0);
  await expect(page.locator(".result-mon")).toHaveCount(0);
  await page.getByRole("button", { name: "Watch replay" }).click();
  await expect(page.locator(".poke-field")).toBeVisible();
  await page.getByRole("button", { name: "Back to result" }).click();
  await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 650 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`Pokemon replay keeps the move slider inside the viewport ${viewport.width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const socket = await joinPreviewRoom(page, "pokemon");

    const active = fixture("pokemon"),
      ended = applyPreviewScenario(active, "pokemon", "win");

    const rewatch = {
      version: 1,
      visibility: "full_reveal",
      gameType: "pokemon",
      frames: [
        { index: 0, at: 0, label: "start", state: active },
        { index: 1, at: 1, label: "finish", state: ended },
      ],
    };

    socket.send(JSON.stringify({ type: "game_ended", payload: { finalState: ended, rewatch } }));
    await page.getByRole("button", { name: "Watch replay" }).click();
    const slider = page.getByRole("slider", { name: "Replay position" });
    await expect(slider).toBeVisible();
    const bounds = await slider.boundingBox();
    expect(bounds!.y).toBeGreaterThan(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      viewport.height,
    );
    const field = await page.locator(".poke-field").boundingBox();

    for (const panel of await page.locator(".poke-field .poke-status").all()) {
      const box = await panel.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(field!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(field!.x + field!.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(field!.y + field!.height);
    }

    await slider.fill("1");
    await expect(slider).toHaveValue("1");
    await slider.fill("0");
    await expect(slider).toHaveValue("0");
    await page.screenshot({ path: info.outputPath("replay.png") });
    await page.getByRole("button", { name: "Back to result" }).click();
    await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
  });
