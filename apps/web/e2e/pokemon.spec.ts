import type {} from "./browser-state";
import { pokemonSidesSchema } from "../src/domain/view-contracts";

import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture } from "../src/dev/previewFixtures";
import { applyPreviewScenario } from "../src/dev/previewScenarios";

async function joinPokemonRoom(page: Page) {
  let socket: WebSocketRoute;
  const active = structuredClone(fixture("pokemon"));
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
        roomId: "pokemon-animation",
        roomCode: "PKMN42",
        gameType: "pokemon",
        gameStatus: "playing",
        wsUrl: "ws://localhost/api/v1/ws/games/pokemon-animation",
      },
    }),
  );
  await page.routeWebSocket("**/api/v1/ws/games/**", (route) => {
    socket = route;
    route.send(
      JSON.stringify({
        type: "connected",
        payload: { state: active, isHost: true, roomCode: "PKMN42" },
      }),
    );
  });
  await page.goto("/pokemon?roomCode=PKMN42");
  await expect(page.locator(".poke-field")).toBeVisible({ timeout: 30000 });

  return { socket: socket!, active };
}

for (const theme of ["light", "dark"])
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ])
    test(`Pokemon layout ${viewport.width} ${theme}`, async ({ page }, info) => {
      await page.addInitScript((theme) => localStorage.setItem("llmgames-theme", theme), theme);
      await page.setViewportSize(viewport);
      await page.goto("/design-preview/pokemon");
      await expect(page.locator(".pokemon-move")).toHaveCount(4);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: info.outputPath("pokemon.png") });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        viewport.height,
      );

      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();

      expect(
        audit.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
    });

test("Pokemon legal choices and sealed decisions", async ({ page }) => {
  const renderErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Maximum update depth"))
      renderErrors.push(message.text());
  });
  await page.goto("/design-preview/pokemon");
  await page.getByRole("button", { name: /Flamethrower/ }).click();
  await expect(page.getByLabel("Demo action")).toContainText('pokemon_move {"slot":1}');
  await page.getByRole("button", { name: "Snorlax", exact: true }).click();
  await expect(page.getByLabel("Demo action")).toContainText('pokemon_switch {"slot":2}');
  await expect(
    page.locator(".pokemon-team-row").nth(1).getByLabel("Unrevealed Pokémon"),
  ).toHaveCount(5);
  await page.goto("/design-preview/pokemon?state=forced-switch");
  await expect(page.locator(".poke-controls[data-force-switch=true]")).toBeVisible();
  await expect(page.locator(".pokemon-move")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gengar, fainted", exact: true })).toBeDisabled();
  const choices = page.locator(".poke-controls[data-force-switch=true] .poke-switch");
  await expect(choices).toHaveCount(6);

  const cardBoxes = await choices.evaluateAll((cards) =>
    cards.map((card) => {
      const box = card.getBoundingClientRect();

      return { top: box.top, left: box.left };
    }),
  );

  expect(new Set(cardBoxes.map((box) => box.top)).size).toBe(1);
  expect(cardBoxes.map((box) => box.left)).toEqual(
    [...cardBoxes].map((box) => box.left).sort((a, b) => a - b),
  );

  const nameBox = await choices.first().locator("strong").boundingBox(),
    spriteBox = await choices.first().locator(".poke-sprite").boundingBox(),
    hpBox = await choices.first().locator(".poke-health").boundingBox();

  expect(nameBox!.y + nameBox!.height).toBeLessThanOrEqual(spriteBox!.y);
  expect(spriteBox!.y + spriteBox!.height).toBeLessThanOrEqual(hpBox!.y);
  expect(spriteBox!.height).toBeGreaterThanOrEqual(80);
  await page.goto("/design-preview/pokemon?state=disabled-moves");
  await expect(page.locator(".pokemon-move:enabled")).toHaveCount(1);

  for (const state of ["choice-locked", "spectator"]) {
    await page.goto(`/design-preview/pokemon?state=${state}`);
    await expect(page.locator(".pokemon-decision button")).toHaveCount(0);
  }

  expect(renderErrors).toEqual([]);
});

test("Pokemon plays resolved battle animations", async ({ page }) => {
  test.setTimeout(45000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/design-preview/pokemon?state=choice-locked");
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Auto battle" }).uncheck();
  await page.getByRole("button", { name: "Preview animations" }).click();
  await expect(page.locator('.poke-effects[data-kind="move"]')).toBeVisible();
  await expect(page.locator('.poke-platform[data-animation="hit"]')).toBeVisible();
  await expect(page.locator(".poke-effects")).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator(".poke-status").filter({ hasText: "Blastoise" })).toContainText(
    "50/100",
  );
});

test("Pokemon finishes a faint animation before showing replacement choices", async ({ page }) => {
  test.setTimeout(45000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const { socket, active } = await joinPokemonRoom(page);
  await expect(page.getByRole("button", { name: /Flamethrower/ })).toBeVisible();
  const before = await page.locator(".poke-field").boundingBox();
  const forced = applyPreviewScenario(structuredClone(active), "pokemon", "forced-switch");
  forced.battleTurn = (active.battleTurn ?? 4) + 1;
  forced.battleLog = [
    ...(active.battleLog ?? []),
    "|turn|5",
    "|move|p2a: Blastoise|Hydro Pump|p1a: Charizard",
    "|-damage|p1a: Charizard|0 fnt",
    "|faint|p1a: Charizard",
  ];
  socket.send(JSON.stringify({ type: "state", payload: forced }));
  await expect(page.locator(".poke-effects[data-kind=move]")).toBeVisible();
  await expect(page.locator(".poke-controls[data-force-switch=true]")).toHaveCount(0);
  await expect(page.locator(".pokemon-move")).toHaveCount(4);
  await expect(page.locator(".poke-controls[data-force-switch=true]")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator(".poke-effects")).toHaveCount(0);
  const after = await page.locator(".poke-field").boundingBox();
  expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(24);

  const replacementSprite = await page
    .locator(".poke-controls[data-force-switch=true] .poke-switch .poke-sprite")
    .nth(1)
    .boundingBox();

  expect(replacementSprite?.width).toBeGreaterThanOrEqual(80);
});

test("Pokemon plays the final attack before opening the result screen", async ({ page }) => {
  test.setTimeout(45000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const { socket, active } = await joinPokemonRoom(page);
  const ended = structuredClone(active);
  ended.status = "ended";
  ended.winner = "preview-0";
  ended.battleTurn = (active.battleTurn ?? 4) + 1;
  ended.decision = null;
  ended.battleLog = [
    ...(active.battleLog ?? []),
    "|turn|5",
    "|move|p1a: Charizard|Slash|p2a: Blastoise",
    "|-damage|p2a: Blastoise|0 fnt",
    "|faint|p2a: Blastoise",
  ];

  const opponent = pokemonSidesSchema
    .parse(ended.sides)
    .find((side) => side.seat === "p2")
    ?.pokemon.find((mon) => mon.active);

  if (opponent) {
    opponent.condition = "0 fnt";
    opponent.fainted = true;
  }

  socket.send(JSON.stringify({ type: "game_ended", payload: { finalState: ended } }));
  await expect(page.locator(".poke-effects[data-kind=move]")).toBeVisible();
  await expect(page.locator(".match-result")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".poke-effects")).toHaveCount(0);
});

test("Pokemon preview automatically animates both sides", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/design-preview/pokemon");
  await expect(page.locator('.poke-effects[data-kind="move"][data-own="true"]')).toBeVisible();
  await expect(page.locator(".pokemon-move")).toHaveCount(4);
  await expect(page.locator(".pokemon-move:enabled")).toHaveCount(0);
  await expect(page.locator('.poke-effects[data-kind="move"][data-own="false"]')).toBeVisible();
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Auto battle" }).uncheck();
  await expect(page.locator(".poke-effects")).toHaveCount(0);
  await expect(page.locator(".pokemon-move")).toHaveCount(4);
});

test("Pokemon spectator sees battle motion with available artwork", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/design-preview/spectator?state=watch-pokemon");
  await expect(page.locator(".poke-battler-motion")).toHaveCount(2);
  // The OSS checkout uses a static placeholder until optional artwork is installed.
  await expect(page.locator(".poke-battler-motion .poke-sprite")).toHaveCount(2);
  await expect(page.locator(".poke-battler-motion").first()).toHaveCSS("animation-name", "none");
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Auto battle" }).uncheck();
  await page.getByRole("button", { name: "Preview battle animation" }).click();
  await expect(
    page.locator('.poke-platform[data-animation="move"] .poke-battler-motion'),
  ).toBeVisible();
  await expect(
    page.locator('.poke-platform[data-animation="hit"] .poke-battler-motion'),
  ).toBeVisible();
  await expect(page.locator(".poke-effects")).toHaveCount(0, { timeout: 20000 });
});

test("Every Gen 1 move has a working Showdown animation", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/design-preview/pokemon?state=choice-locked");
  await expect(page.locator(".poke-field")).toBeVisible();

  const result = await page.evaluate(async () => {
    const renderer = await import("/src/game-ui/pokemon/showdown/renderer.js");
    const upstream = await import("/src/game-ui/pokemon/showdown/upstream.js");
    const moves = await import("/src/features/pokemon/gen1-moves.json");
    await renderer.preloadEffects();
    upstream.$.fx.off = true;
    const originalDelay = upstream.$.fn.delay;
    upstream.$.fn.delay = function () {
      return this;
    };

    const errors: string[] = [];

    for (const moveId of Object.keys(moves.default)) {
      try {
        await renderer.playEffect(
          document.querySelector<HTMLElement>(".poke-field")!,
          { id: 1, kind: "move", moveId, actor: "p1", target: "p2", label: moveId, duration: 660 },
          "p1",
        ).finished;
      } catch (error) {
        errors.push(moveId + ": " + String(error));
      }
    }

    upstream.$.fx.off = false;
    upstream.$.fn.delay = originalDelay;

    return {
      errors,
      count: Object.keys(moves.default).length,
      assets: Object.values(upstream.BattleEffects).every(
        (e) => !("url" in e) || e.url.startsWith("/pokemon/showdown/fx/"),
      ),
    };
  });

  expect(result.errors).toEqual([]);
  expect(result.count).toBe(165);
  expect(result.assets).toBe(true);
  await expect(page.locator(".showdown-animation-layer")).toHaveCount(0);
});

test("Showdown move visual review", async ({ page }, info) => {
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/design-preview/pokemon?state=choice-locked");
  await expect(page.locator(".poke-field")).toBeVisible();

  for (const moveId of [
    "flamethrower",
    "surf",
    "hydropump",
    "thunderbolt",
    "icebeam",
    "psychic",
    "swordsdance",
  ]) {
    await page.evaluate(async (moveId) => {
      const renderer = await import("/src/game-ui/pokemon/showdown/renderer.js");
      await renderer.preloadEffects();
      window.reviewAnimation = renderer.playEffect(
        document.querySelector<HTMLElement>(".poke-field")!,
        {
          id: 1,
          kind: "move",
          moveId,
          actor: "p1",
          target: moveId === "swordsdance" ? "p1" : "p2",
          label: moveId,
          duration: 660,
        },
        "p1",
      );
    }, moveId);
    await page.waitForTimeout(400);
    await page.screenshot({ path: info.outputPath(moveId + ".png") });
    await page.evaluate(() => window.reviewAnimation?.cancel());
  }
});

test("Move details appear on hover and keyboard focus", async ({ page }, info) => {
  await page.goto("/design-preview/pokemon");
  const move = page.getByRole("button", { name: /Flamethrower/ });
  await move.hover();
  await expect(page.getByRole("tooltip")).toContainText("10% chance to burn");
  await expect(page.getByRole("tooltip")).toContainText("95");
  await expect(page.getByRole("tooltip")).toContainText("100%");
  await page.screenshot({ path: info.outputPath("move-tooltip.png") });
  await move.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("Pokemon move buttons remain clickable on a narrow desktop", async ({ page }) => {
  await page.setViewportSize({ width: 782, height: 950 });
  await page.goto("/design-preview/pokemon");
  await expect(page.locator(".pokemon-move")).toHaveCount(4);

  const unobstructed = await page.locator(".pokemon-move").evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();

      return button.contains(
        document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
      );
    }),
  );

  expect(unobstructed).toEqual([true, true, true, true]);
  await page.locator(".pokemon-move").nth(3).click();
  await expect(page.getByLabel("Demo action")).toContainText('pokemon_move {"slot":4}');
});
