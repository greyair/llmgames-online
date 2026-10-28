import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { ArchiveParticipant } from "@llmgames/game-catalog";
import { fixture } from "../src/dev/previewFixtures";

const agents = [
  {
    codename: "SwiftAnchor",
    environmentLabel: "Codex",
    createdAt: 1788970000,
    lastUsedAt: 1788970300,
    hasRoomHistory: true,
    isActive: true,
  },
  {
    codename: "BrightRook",
    environmentLabel: "Claude",
    createdAt: 1788970000,
    lastUsedAt: null,
    hasRoomHistory: true,
    isActive: false,
  },
];

const game = {
  id: "game-one",
  gameType: "connect4",
  startedAt: 1788970000,
  endedAt: 1788970300,
  endReason: "connect4",
  winner: "a",
  eventCount: 16,
  sizeBytes: 1024,
  participants: [
    {
      ref: "a",
      isYours: true,
      isAgent: true,
      codename: "SwiftAnchor",
      environmentLabel: "Codex",
      displayName: "SwiftAnchor",
      ownerGamertag: "Alex",
    },
    {
      ref: "b",
      isYours: false,
      isAgent: false,
      codename: null,
      environmentLabel: null,
      displayName: "Mika",
      ownerGamertag: null,
    },
  ],
};

/**
 * R2 documents follow the archive contract (`name`, optional agent fields), which
 * is not the same shape as the D1 summary rows above. Building them separately is
 * what makes these mocks realistic.
 */
function archiveParticipants(participants: typeof game.participants) {
  return participants.map((participant) => {
    const archived: ArchiveParticipant = {
      ref: participant.ref,
      name: participant.displayName,
      isAgent: participant.isAgent,
    };

    if (participant.codename) archived.codename = participant.codename;

    if (participant.environmentLabel) archived.environmentLabel = participant.environmentLabel;

    if (participant.ownerGamertag) archived.ownerGamertag = participant.ownerGamertag;

    return archived;
  });
}

const rewatch = {
  version: 1,
  visibility: "full_reveal",
  gameType: "connect4",
  frames: [
    { index: 0, at: 0, label: "Match started", state: fixture("connect4") },
    {
      index: 1,
      at: 900,
      label: "Match finished",
      state: { ...fixture("connect4"), status: "ended", winner: "preview-0" },
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/users/me", (r) =>
    r.fulfill({
      json: {
        user: {
          id: "user",
          email: "player@example.com",
          name: null,
          gamertag: "Alex",
          gamertag_selected: 1,
        },
      },
    }),
  );
  await page.route("**/api/v1/auth/users/me/agents", (r) => r.fulfill({ json: { agents } }));
  await page.route("**/api/v1/auth/users/me/game-logs", (r) =>
    r.fulfill({ json: { games: [game], nextCursor: null } }),
  );
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  for (const path of ["agent-log", "history"])
    test(`${path} ${viewport.width}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await page.goto("/" + path);
      await expect(page.getByText("SwiftAnchor", { exact: false }).first()).toBeVisible();
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath("archive.png"), fullPage: true });
    });

test("active agents cannot be removed and failed removal keeps identity", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me/agents/BrightRook", (r) =>
    r.fulfill({ status: 409, json: { error: "This agent joined a game. Try after it finishes." } }),
  );
  await page.goto("/agent-log");
  await expect(page.getByRole("button", { name: "Remove SwiftAnchor" })).toBeDisabled();
  await page.getByRole("button", { name: "Remove BrightRook" }).click();
  await expect(page.getByRole("group", { name: "Confirm removal of BrightRook" })).toBeVisible();
  await page.getByRole("button", { name: "Remove identity", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("joined a game");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "BrightRook", exact: true })).toBeVisible();
});

test("bulk deletion keeps active agents and refreshes list", async ({ page }) => {
  let removed = false;
  await page.route("**/api/v1/auth/users/me/agents", (r) => {
    if (r.request().method() === "DELETE") {
      removed = true;

      return r.fulfill({ json: { deletedCount: 1, preservedActiveCount: 1 } });
    }

    return r.fulfill({ json: { agents: removed ? [agents[0]] : agents } });
  });
  await page.goto("/agent-log");
  await page.getByRole("button", { name: "Remove inactive agents" }).click();
  await page.getByRole("button", { name: "Remove identity", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 active identities kept");
  await expect(page.getByRole("heading", { name: "BrightRook", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "SwiftAnchor", exact: true })).toBeVisible();
});

test("account replay opens read-only, steps, and returns to history", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/auth/users/me/game-logs/game-one", (r) =>
    r.fulfill({
      json: {
        version: 1,
        gameId: game.id,
        gameType: game.gameType,
        startedAt: 0,
        endedAt: 1,
        endReason: "ended",
        winner: "a",
        participants: archiveParticipants(game.participants),
        events: [],
        rewatch,
      },
    }),
  );
  await page.goto("/history");
  await page.locator(".history-summary").first().click();
  await expect(page.getByRole("button", { name: "Rewatch game", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rewatch game", exact: true }).click();
  await expect(page.getByLabel("Replay position")).toHaveValue("0");
  await expect(page.getByRole("button", { name: /Drop in column/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Next frame" }).click();
  await expect(page.getByLabel("Replay position")).toHaveValue("1");
  await page.screenshot({ path: info.outputPath("replay.png") });
  await page.getByRole("button", { name: "Close rewatch", exact: true }).click();
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
});

test("legacy device replays are cleared without touching preferences", async ({ page }) => {
  await page.addInitScript(
    (serialized) => {
      localStorage.setItem("llmgames-rewatch:demo", serialized);
      localStorage.setItem("llmgames-interface-sound", "off");
    },
    JSON.stringify({ roomId: "demo", savedAt: 1788970300000, rewatch }),
  );
  await page.goto("/history");
  await expect(page.locator(".history-entry")).toHaveCount(1);
  await expect(
    page.evaluate(() => localStorage.getItem("llmgames-rewatch:demo")),
  ).resolves.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("llmgames-interface-sound"))).toBe("off");
});

test("history paginates and retries unavailable replay", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me/game-logs", (r) =>
    r.fulfill({ json: { games: [game], nextCursor: "older" } }),
  );
  await page.route("**/api/v1/auth/users/me/game-logs?before=older", (r) =>
    r.fulfill({
      json: { games: [{ ...game, id: "game-two", gameType: "reversi" }], nextCursor: null },
    }),
  );
  await page.route("**/api/v1/auth/users/me/game-logs/game-one", (r) =>
    r.fulfill({ status: 404, json: { error: "Game log is unavailable" } }),
  );
  await page.goto("/history");
  await page.getByRole("button", { name: "Load older games" }).click();
  await expect(page.getByRole("heading", { name: "Reversi", exact: true })).toBeVisible();
  await page.locator(".history-summary").first().click();
  await expect(page.getByRole("button", { name: "Retry game log" })).toBeVisible();
  await page.getByRole("button", { name: "Retry game log" }).click();
  await expect(page.getByRole("alert")).toContainText("unavailable");
});

test("signed-in navigation links to profile", async ({ page }) => {
  await page.goto("/play");
  await expect(page.getByRole("link", { name: "Profile", exact: true })).toHaveAttribute(
    "href",
    "/profile",
  );
});

test("history identity labels distinguish agents from humans", async ({ page }) => {
  await page.goto("/history");
  const summary = page.locator(".history-summary").first();
  await expect(summary).toContainText("SwiftAnchor");
  await expect(summary).toContainText("Codex · Alex");
  await expect(summary).toContainText("Mika");
  await expect(summary).not.toContainText("Human");
  expect(
    await summary.locator(".player-name-label").evaluateAll((labels) =>
      labels
        .filter((label) => label.querySelector("small"))
        .every((label) => {
          const strong = label.querySelector("strong")?.getBoundingClientRect();
          const small = label.querySelector("small")?.getBoundingClientRect();

          return Boolean(strong && small && small.top >= strong.bottom - 2);
        }),
    ),
  ).toBe(true);
});

test("event log exposes retained details without executing content", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/auth/users/me/game-logs/game-one", (r) =>
    r.fulfill({
      json: {
        version: 1,
        gameId: game.id,
        gameType: game.gameType,
        startedAt: 0,
        endedAt: 1,
        endReason: "ended",
        winner: "a",
        participants: archiveParticipants(game.participants),
        events: [
          { seq: 1, at: 1788970300000, type: "game_started", summary: { players: 2 } },
          {
            seq: 2,
            at: 1788970310000,
            type: "player_action",
            summary: { action: "drop_disc", data: { col: 3 }, note: "<script>invalid()</script>" },
          },
        ],
        rewatch,
      },
    }),
  );
  await page.goto("/history");
  await page.locator(".history-summary").first().click();
  await expect(page.getByLabel("Game events")).toContainText("player action");
  await expect(page.getByLabel("Game events")).toContainText("drop_disc");
  await expect(page.getByLabel("Game events")).toContainText("<script>invalid()</script>");
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("event-log.png") });
  await page.locator(".history-summary").first().click();
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
});

test("history expands replay and events in place without streaming links", async ({ page }) => {
  await page.route("**/api/v1/auth/users/me/game-logs", (r) =>
    r.fulfill({
      json: {
        games: [
          {
            ...game,
            featured: { watchUrl: "https://www.twitch.tv/llmgames_online", recording: false },
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.route("**/api/v1/auth/users/me/game-logs/game-one", (r) =>
    r.fulfill({
      json: {
        version: 1,
        gameId: game.id,
        gameType: game.gameType,
        startedAt: 0,
        endedAt: 1,
        endReason: "ended",
        winner: "a",
        participants: archiveParticipants(game.participants),
        events: [{ seq: 1, at: 1788970300000, type: "game_started", summary: { players: 2 } }],
        rewatch,
      },
    }),
  );
  await page.goto("/history");
  await expect(page.getByText("Featured", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Watch/ })).toHaveCount(0);
  await page.locator(".history-summary").click();
  await expect(page.getByLabel("Game events")).toContainText("game started");
  await page.getByRole("button", { name: "Rewatch game", exact: true }).click();
  await expect(page.getByLabel("Replay position")).toHaveValue("0");
  await page.getByRole("button", { name: "Next frame" }).click();
  await expect(page.getByLabel("Replay position")).toHaveValue("1");
  await page.getByRole("button", { name: "2×", exact: true }).click();
  await expect(page.getByRole("button", { name: "2×", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Close rewatch" }).click();
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/history$/);
});

test("agent client and owner labels survive refreshing the identity list", async ({ page }) => {
  await page.goto("/agent-log");

  const row = page
    .locator(".agent-list .ui-card")
    .filter({ has: page.getByRole("heading", { name: "SwiftAnchor", exact: true }) });

  await expect(row).toContainText("Codex · Alex");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(row).toContainText("Codex · Alex");
  await expect(row).not.toContainText("Human");
});

for (const gameType of ["pokemon", "poker"])
  for (const width of [390, 1440])
    test(`replay public player labels ${gameType} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      const state = fixture(gameType);
      state.players = state.players?.map((player, index) =>
        index === 0
          ? {
              ...player,
              isAgent: true,
              codename: "SwiftAnchor",
              environmentLabel: "Codex",
              ownerGamertag: "PlayerOne",
            }
          : player,
      );

      const replay = {
        version: 1,
        visibility: "full_reveal",
        gameType,
        frames: [{ index: 0, at: 0, label: "Battle", state }],
      };

      const replayGame = { ...game, id: "identity-replay", gameType };
      await page.route("**/api/v1/auth/users/me/game-logs", (r) =>
        r.fulfill({ json: { games: [replayGame], nextCursor: null } }),
      );
      await page.route("**/api/v1/auth/users/me/game-logs/identity-replay", (r) =>
        r.fulfill({
          json: {
            version: 1,
            gameId: replayGame.id,
            gameType,
            startedAt: 0,
            endedAt: 1,
            endReason: "ended",
            winner: null,
            participants: archiveParticipants(replayGame.participants),
            events: [],
            rewatch: replay,
          },
        }),
      );
      await page.goto("/history");

      const row = page.locator(".history-entry").filter({
        has: page.getByRole("heading", {
          name: gameType === "pokemon" ? "Pokémon" : "Poker",
          exact: true,
        }),
      });

      await row.locator(".history-summary").click();
      await row.getByRole("button", { name: "Rewatch game", exact: true }).click();
      const board = row.locator(".inline-replay-board");
      await expect(board).toContainText("Codex · PlayerOne");
      await expect(board).toContainText("Mika");
      await expect(board).not.toContainText("Human");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        await board.locator(".player-name-label").evaluateAll((labels) =>
          labels.every((label) => {
            const box = label.getBoundingClientRect();

            const parent = label
              .closest(".poker-seat-nameplate,.poke-trainer")
              ?.getBoundingClientRect();

            return (
              !parent ||
              (box.left >= parent.left - 1 &&
                box.right <= parent.right + 1 &&
                label.scrollWidth <= label.clientWidth + 1)
            );
          }),
        ),
      ).toBe(true);
      await board.screenshot({ path: info.outputPath("identity-replay.png") });
    });
