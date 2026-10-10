import type {} from "./browser-state";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`Battleship layout ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/design-preview/battleship");
    await expect(page.locator(".sea-cell")).toHaveCount(200);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath("ships.png") });

    const target = await page.locator(".sea[data-board=target] .sea-grid").boundingBox();

    if (viewport.width <= 650)
      await page.getByRole("button", { name: "Your fleet", exact: true }).click();

    const own = await page.locator(".sea[data-board=own] .sea-grid").boundingBox();

    const powers = await page.getByRole("group", { name: "Weapons", exact: true }).boundingBox();

    expect(own).not.toBeNull();
    expect(target).not.toBeNull();
    expect(powers).not.toBeNull();
    expect(Math.abs(own!.width - own!.height)).toBeLessThan(2);

    if (viewport.width <= 650) {
      expect(Math.abs(target!.width - target!.height)).toBeLessThan(2);
      expect(
        await page
          .locator(".ships-stage")
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
    } else if (viewport.height <= 450)
      expect(powers!.x).toBeGreaterThanOrEqual(own!.x + own!.width);
    else {
      expect(own!.x + own!.width).toBeLessThan(target!.x);
      expect(powers!.y).toBeGreaterThanOrEqual(own!.y + own!.height);
    }

    if (viewport.width > 650) {
      expect(powers!.y + powers!.height).toBeLessThan(viewport.height);
      expect(target!.y + target!.height).toBeLessThanOrEqual(viewport.height);
    }

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
      audit.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  });

test("ship weapons and spectator projection", async ({ page }) => {
  await page.goto("/design-preview/battleship?state=all-weapons");
  const target = page.getByRole("group", { name: "Target grid", exact: true });
  await target.getByRole("button", { name: "A1", exact: true }).click();
  await expect(page.getByLabel("Demo action")).toContainText('cannon {"row":0,"col":0}');
  await expect(page.getByRole("button", { name: /Cannon/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: /Mines/ }).click();
  const own = page.locator(".sea[data-board=own]");
  await expect(own.getByRole("button", { name: "B2, ship", exact: true })).toBeDisabled();
  await own.getByRole("button", { name: "J10", exact: true }).click();
  await expect(page.getByLabel("Demo action")).toContainText('mine {"row":9,"col":9}');
  await expect(page.locator('.sea[data-board=own] [data-row="9"][data-col="9"]')).toHaveAttribute(
    "data-mine",
    "true",
  );
  await page.getByRole("button", { name: /Bomb/ }).click();
  await expect(target.getByRole("button", { name: "J10", exact: true })).toBeDisabled();
  await target.getByRole("button", { name: "B2", exact: true }).click();
  await expect(page.getByLabel("Demo action")).toContainText('bomb {"row":1,"col":1}');
  await page.getByRole("button", { name: /Torpedo/ }).click();
  await expect(target.getByRole("button", { name: "B2", exact: true })).toBeDisabled();
  await target.getByRole("button", { name: "A2", exact: true }).click();
  await expect(page.getByLabel("Demo action")).toContainText(
    'torpedo {"row":0,"col":1,"direction":"s"}',
  );
  await page.goto("/design-preview/battleship?state=no-energy");
  await expect(page.getByRole("button", { name: /Bomb/ })).toBeDisabled();
  await page.goto("/design-preview/battleship?state=spectator");
  await expect(page.locator(".sea-cell:enabled")).toHaveCount(0);
  await expect(page.locator(".sea-cell[data-ship=true]")).toHaveCount(0);
  await expect(page.locator(".radar-scan")).toHaveCount(0);
});

test("past radar scans stay marked with contact counts", async ({ page }) => {
  await page.goto("/design-preview/battleship");
  const target = page.locator(".sea[data-board=target]");
  await expect(target.locator(".radar-scan")).toHaveCount(3);
  await expect(target.locator(".radar-scan-count")).toHaveText(["0", "2", "1"]);
  await expect(
    target.getByText("Radar scan at A1 found 0 ship cells in 4 scanned cells."),
  ).toBeAttached();
  const overlapping = target.locator(".radar-scan-area").nth(1);
  const next = target.locator(".radar-scan-area").nth(2);
  const firstBox = await overlapping.boundingBox();
  const nextBox = await next.boundingBox();
  expect(firstBox!.x + firstBox!.width).toBeGreaterThan(nextBox!.x);
  expect(firstBox!.y + firstBox!.height).toBeGreaterThan(nextBox!.y);
});

const markerColor = (page: Page) =>
  page.locator(".ships-stage").evaluate((stage) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--marker)";
    stage.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();

    return color;
  });

test("bomb leaves a neutral outline around its full area", async ({ page }, info) => {
  await page.goto("/design-preview/battleship?state=all-weapons");
  await page.getByRole("button", { name: /Bomb/ }).click();
  const target = page.locator(".sea[data-board=target]");
  await target.locator('[data-row="3"][data-col="3"]').click();
  const outline = target.locator(".bombed-area");
  await expect(outline).toHaveCSS("border-top-color", await markerColor(page));
  await expect(outline).toHaveAttribute("style", /left: 30%; top: 30%/);
  await expect(page.locator(".fx-bomb")).toHaveCount(0);
  await expect(outline).toBeVisible();
  await page.screenshot({ path: info.outputPath("bomb-outline.png") });
});

test("weapon trails show a stopped torpedo with launch arrow and all mine return shots", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/design-preview/battleship?state=all-weapons");
  const target = page.locator(".sea[data-board=target]");
  await expect(target.locator(".torpedo-path")).toHaveAttribute(
    "style",
    /left: 70%; top: 70%; width: 30%; height: 10%/,
  );
  const marker = await markerColor(page);
  await expect(target.locator(".torpedo-path")).toHaveCSS("border-top-color", marker);
  await expect(target.locator(".torpedo-start")).toHaveAttribute(
    "style",
    /left: 95%; top: 75%;.*rotate\(90deg\)/,
  );
  await expect(target.locator(".mine-shot-outline").first()).toHaveCSS(
    "border-top-color",
    "rgb(255, 224, 143)",
  );
  await expect(target.locator(".mine-shot-outline").first()).toHaveCSS(
    "border-top-style",
    "dotted",
  );
  await expect(target.locator(".triggered-mine")).toHaveAttribute(
    "aria-label",
    "Triggered mine at G7",
  );
  await expect(target.locator(".mine-shot-outline")).toHaveCount(3);
  await expect(
    target.locator('.mine-shot-outline[aria-label="Mine return shot at J5"]'),
  ).toHaveAttribute("style", /left: 40%; top: 90%/);
  await page.screenshot({ path: info.outputPath("weapon-trails.png") });
});

test("enemy weapon history stays on the board it affected", async ({ page }) => {
  await page.goto("/design-preview/battleship?state=all-weapons");
  const own = page.locator(".sea[data-board=own]");
  const target = page.locator(".sea[data-board=target]");
  await expect(own.locator(".radar-scan-count")).toHaveText("1");
  await expect(target.locator(".torpedo-path")).toHaveCount(1);
  await expect(target.locator(".mine-shot-outline")).toHaveCount(3);
  await expect(target.locator(".bombed-area")).toHaveCount(0);
  await expect(own.locator("[data-mine=true]")).toHaveCount(1);
  await expect(target.locator("[data-mine=true]")).toHaveCount(0);
});

test("radar reveals its count and announcement only after the sweep finishes", async ({ page }) => {
  await page.clock.install();
  await page.goto("/design-preview/battleship?state=all-weapons");
  const counts = page.locator('.sea[data-board="target"] .radar-scan-count');
  await expect(counts).toHaveCount(3);
  await page.getByRole("button", { name: /Radar/ }).click();
  await page.locator('.sea[data-board=target] [data-row="7"][data-col="7"]').click();
  await page.clock.runFor(50);
  await expect(page.locator(".fx-radar")).toBeVisible();
  await expect(counts).toHaveCount(3);
  await expect(
    page.getByText("Radar contact: 2 ship cell(s) in the 3×3.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.clock.runFor(3100);
  await expect(page.locator(".fx-radar")).toHaveCount(0);
  await expect(counts).toHaveCount(4);
  await expect(counts.last()).toHaveText("2");
  await expect(page.locator(".ship-notice")).toHaveText(
    "Radar contact: 2 ship cell(s) in the 3×3.",
  );
});

test("fleet placement submits only a complete draft", async ({ page }, info) => {
  await page.goto("/design-preview/placement");
  await expect(page.getByRole("button", { name: "Ready", exact: true })).toBeDisabled();
  await expect(page.locator(".fleet-picker [aria-pressed=true]")).toHaveCount(0);
  await page.getByRole("button", { name: "A1", exact: true }).click();
  await expect(page.locator(".sea-cell[data-ship=true]")).toHaveCount(0);

  for (const [name, cell] of [
    ["Carrier", "A1"],
    ["Dreadnought", "A5"],
    ["Cruiser", "E1"],
    ["Submarine", "E5"],
    ["Destroyer", "I1"],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: cell, exact: true }).click();
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(page.locator(".fleet-picker [aria-pressed=true]")).toHaveCount(0);

    if (name !== "Destroyer")
      await expect(page.getByRole("button", { name: "Ready", exact: true })).toBeDisabled();
  }

  await expect(page.locator(".fleet-choice")).toHaveCount(0);
  const board = await page.locator(".sea-grid").boundingBox();

  const ready = await page.getByRole("button", { name: "Ready", exact: true }).boundingBox();

  expect(ready!.y).toBeGreaterThanOrEqual(board!.y + board!.height);
  expect(Math.abs(ready!.x + ready!.width / 2 - board!.x - board!.width / 2)).toBeLessThan(2);
  await expect(page.locator(".sea-cell[data-ship=true]")).toHaveCount(22);
  await page.screenshot({ path: info.outputPath("placement.png") });
  await page.getByRole("button", { name: "Ready", exact: true }).click();
  await expect(page.getByLabel("Demo action")).toContainText("place_fleet");
  await expect(page.getByLabel("Demo action")).toContainText('"id":"destroyer"');
});

test("drag ships from the fleet picker, reject overlaps, and cancel outside drops", async ({
  page,
}, info) => {
  await page.goto("/design-preview/placement");
  const picker = page.getByRole("group", { name: "Choose a ship" });

  const drag = async (name: string, target: string) => {
    await picker.getByRole("button", { name, exact: true }).hover();
    await page.mouse.down();
    await page.getByRole("button", { name: target, exact: true }).hover();
  };

  await drag("Carrier", "A1");
  await expect(page.locator("[data-drop=valid]")).toHaveCount(6);
  await page.mouse.up();
  await expect(picker.getByRole("button", { name: "Carrier", exact: true })).toHaveCount(0);
  await drag("Dreadnought", "A1, ship");
  await expect(page.locator("[data-drop=invalid]")).not.toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator(".sea-cell[data-ship=true]")).toHaveCount(6);
  await drag("Dreadnought", "J10");
  await page.mouse.up();
  await expect(page.locator(".sea-cell[data-ship=true]")).toHaveCount(6);
  await drag("Dreadnought", "A5");
  await page.mouse.up();
  await expect(page.locator(".sea-cell[data-ship=true]")).toHaveCount(11);
  await picker.getByRole("button", { name: "Cruiser", exact: true }).hover();
  await page.mouse.down();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(page.locator(".sea-cell[data-ship=true]")).toHaveCount(11);
  const board = await page.locator(".sea-grid").boundingBox();

  const heading = await page
    .getByRole("heading", { name: "Place your fleet", exact: true })
    .boundingBox();

  const panel = await page.locator(".fleet-tools").boundingBox();
  expect(Math.abs(heading!.x + heading!.width / 2 - board!.x - board!.width / 2)).toBeLessThan(2);
  expect(board!.x - panel!.x - panel!.width).toBeLessThanOrEqual(26);
  await page.screenshot({ path: info.outputPath("drag-placement.png") });
});

test("touch drag places a ship on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/design-preview/placement");

  const source = await page.getByRole("button", { name: "Cruiser", exact: true }).boundingBox();

  const target = await page.getByRole("button", { name: "D3", exact: true }).boundingBox();

  const session = await page.context().newCDPSession(page);

  const start = {
    x: source!.x + source!.width / 2,
    y: source!.y + source!.height / 2,
  };

  const end = {
    x: target!.x + target!.width / 2,
    y: target!.y + target!.height / 2,
  };

  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });

  for (let step = 1; step <= 6; step++)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + ((end.x - start.x) * step) / 6,
          y: start.y + ((end.y - start.y) * step) / 6,
        },
      ],
    });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".sea-cell[data-ship=true]")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Cruiser", exact: true })).toHaveCount(0);
});

test("placed ships rotate through their handles and reject blocked turns", async ({
  page,
}, info) => {
  await page.goto("/design-preview/placement");
  await expect(page.getByRole("button", { name: /Rotate/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Carrier", exact: true }).click();
  await page.getByRole("button", { name: "A1", exact: true }).click();
  const carrier = page.locator(".sea-grid [data-ship-kind=carrier]");

  for (const rotation of [90, 180, 270, 0]) {
    await page.getByRole("button", { name: "Rotate Carrier", exact: true }).click();
    await expect(carrier).toHaveAttribute("transform", new RegExp(`rotate\\(${rotation} 50 50\\)`));
    await expect(page.locator(".sea-cell[data-ship=true]")).toHaveCount(6);
  }

  await page.getByRole("button", { name: "Dreadnought", exact: true }).click();
  await page.getByRole("button", { name: "B3", exact: true }).click();
  await page.getByRole("button", { name: "Rotate Carrier", exact: true }).click();
  await expect(carrier).toHaveAttribute("transform", "translate(0 0) rotate(0 50 50)");
  await expect(
    page.getByText("That placement overlaps a ship or goes off the grid."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Destroyer", exact: true }).click();
  await page.getByRole("button", { name: "I1", exact: true }).click();
  await page.getByRole("button", { name: "Rotate Destroyer", exact: true }).click();
  await expect(page.locator(".sea-grid [data-ship-kind=destroyer]")).toHaveAttribute(
    "transform",
    "translate(100 800) rotate(90 50 50)",
  );
  await page.screenshot({ path: info.outputPath("rotation-handles.png") });
});

test("hover highlights the whole ship and board drags preserve the grabbed offset and rotation", async ({
  page,
}, info) => {
  await page.goto("/design-preview/placement");
  await page.getByRole("button", { name: "Carrier", exact: true }).click();
  await page.getByRole("button", { name: "A1", exact: true }).click();
  const carrier = page.locator(".sea-grid [data-ship-kind=carrier]");
  await page.getByRole("button", { name: "A2, ship", exact: true }).hover();
  await expect(page.locator(".sea-grid [data-highlighted=true]")).toHaveCount(1);
  expect(
    await page
      .getByRole("button", { name: "A2, ship", exact: true })
      .evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe("none");
  await page.mouse.down();
  await page.getByRole("button", { name: "F5", exact: true }).hover();
  await page.mouse.up();
  await expect(carrier).toHaveAttribute("transform", "translate(300 500) rotate(0 50 50)");
  await expect(page.getByRole("button", { name: "A1", exact: true })).toHaveAttribute(
    "data-ship",
    "false",
  );
  await page.getByRole("button", { name: "Rotate Carrier", exact: true }).click();
  await page.getByRole("button", { name: "G5, ship", exact: true }).hover();
  await page.mouse.down();
  await page.getByRole("button", { name: "C8", exact: true }).hover();
  await page.mouse.up();
  await expect(carrier).toHaveAttribute("transform", "translate(800 100) rotate(90 50 50)");
  await page.getByRole("button", { name: "C8, ship", exact: true }).hover();
  await page.mouse.down();
  await page.getByRole("button", { name: "J10", exact: true }).hover();
  await page.mouse.up();
  await expect(carrier).toHaveAttribute("transform", "translate(800 100) rotate(90 50 50)");
  await page.getByRole("button", { name: "A1", exact: true }).hover();
  await page.getByRole("button", { name: "C8, ship", exact: true }).hover();
  await expect(page.locator(".sea-grid [data-highlighted=true]")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("ship-hover.png") });
});

test("drag abilities previews their area and only submits valid drops", async ({ page }, info) => {
  await page.goto("/design-preview/battleship?state=all-weapons");
  const target = page.locator(".sea[data-board=target]");
  const own = page.locator(".sea[data-board=own]");

  const drag = async (name: string, board: typeof target, row: number, col: number) => {
    await page.getByRole("button", { name: new RegExp(name) }).hover();
    await page.mouse.down();
    await board.locator(`[data-row="${row}"][data-col="${col}"]`).hover();
  };

  await drag("Bomb", target, 1, 1);
  await expect(own.locator(".sea-cell:enabled")).toHaveCount(0);
  await expect(target.locator("[data-effect=valid]")).toHaveCount(4);
  await expect(page.locator(".power-drag-ghost")).toBeVisible();
  await page.screenshot({ path: info.outputPath("bomb-preview.png") });
  await page.mouse.up();
  await expect(page.getByLabel("Demo action")).toContainText('bomb {"row":1,"col":1}');
  await expect(page.locator("[data-effect]")).toHaveCount(0);
  const previous = await page.getByLabel("Demo action").textContent();
  await drag("Bomb", target, 9, 9);
  await expect(target.locator("[data-effect=invalid]")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByLabel("Demo action")).toHaveText(previous!);
  await drag("Radar", target, 4, 4);
  await expect(target.locator("[data-effect=valid]")).toHaveCount(9);
  await page.mouse.up();
  await expect(page.getByLabel("Demo action")).toContainText('radar {"row":4,"col":4}');
  await drag("Torpedo", target, 0, 0);
  await expect(target.locator("[data-effect=valid]")).toHaveCount(10);
  await expect(page.locator(".power-drag-ghost")).toContainText("Possible path");
  await page.mouse.up();
  await expect(page.getByLabel("Demo action")).toContainText(
    'torpedo {"row":0,"col":0,"direction":"s"}',
  );
  await drag("Mines", target, 9, 9);
  await expect(target.locator("[data-effect]")).toHaveCount(0);
  await expect(target.locator(".sea-cell:enabled")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByLabel("Demo action")).toContainText("torpedo");
  await drag("Mines", own, 9, 9);
  await expect(own.locator("[data-effect=valid]")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByLabel("Demo action")).toContainText('mine {"row":9,"col":9}');
  await expect(page.locator('.sea[data-board=own] [data-row="9"][data-col="9"]')).toHaveAttribute(
    "data-mine",
    "true",
  );
  await drag("Bomb", target, 2, 2);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("[data-effect],.power-drag-ghost")).toHaveCount(0);
  await expect(page.getByLabel("Demo action")).toContainText("mine");
  await drag("Radar", target, 0, 0);
  await expect(target.locator("[data-effect=valid]")).toHaveCount(4);
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(page.getByLabel("Demo action")).toContainText("mine");
});

test("touch drag previews and drops an ability", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/design-preview/battleship?state=all-weapons");
  const source = await page.getByRole("button", { name: /Bomb/ }).boundingBox();

  const target = await page
    .locator('.sea[data-board=target] [data-row="1"][data-col="1"]')
    .boundingBox();

  const session = await page.context().newCDPSession(page);

  const start = {
    x: source!.x + source!.width / 2,
    y: source!.y + source!.height / 2,
  };

  const end = {
    x: target!.x + target!.width / 2,
    y: target!.y + target!.height / 2,
  };

  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });

  for (let step = 1; step <= 6; step++)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + ((end.x - start.x) * step) / 6,
          y: start.y + ((end.y - start.y) * step) / 6,
        },
      ],
    });
  await expect(page.locator("[data-effect=valid]")).toHaveCount(4);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.getByLabel("Demo action")).toContainText('bomb {"row":1,"col":1}');
  await expect(page.locator(".power-drag-ghost")).toHaveCount(0);
});

test("game log sits under your board and weapons under the target", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/design-preview/battleship");
  const log = page.getByRole("complementary", { name: "Game log" });
  await expect(log.getByRole("listitem")).toHaveCount(4);
  await expect(log).toContainText("Alex hit a ship at E4.");

  const own = await page.locator(".sea[data-board=own] .sea-grid").boundingBox();

  const target = await page.locator(".sea[data-board=target] .sea-grid").boundingBox();

  const box = await log.boundingBox();

  const weapons = await page.getByRole("group", { name: "Weapons", exact: true }).boundingBox();

  expect(box!.y).toBeGreaterThanOrEqual(own!.y + own!.height);
  expect(box!.x).toBeGreaterThanOrEqual(own!.x);
  expect(box!.x + box!.width).toBeLessThanOrEqual(own!.x + own!.width + 1);
  expect(weapons!.y).toBeGreaterThanOrEqual(target!.y + target!.height);
  expect(weapons!.x).toBeGreaterThanOrEqual(target!.x);
  expect(weapons!.x + weapons!.width).toBeLessThanOrEqual(target!.x + target!.width + 1);
  expect(Math.abs(own!.y - target!.y)).toBeLessThan(1);
  expect(Math.abs(own!.width - target!.width)).toBeLessThan(1);
  expect(own!.width).toBeGreaterThan(400);
  await expect(page.getByLabel("Toggle game log")).toHaveCount(0);
  const buttons = page.locator(".ship-weapons .ui-button");
  const first = await buttons.nth(0).boundingBox();
  const second = await buttons.nth(1).boundingBox();
  expect(first!.y).toBe(second!.y);
});

test("doodle effects follow actions and results, and sound respects mute", async ({ page }) => {
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createOscillator;
    Object.defineProperty(window, "gameAudioNotes", {
      value: 0,
      writable: true,
    });
    AudioContext.prototype.createOscillator = function () {
      window.gameAudioNotes = (window.gameAudioNotes ?? 0) + 1;

      return original.call(this);
    };
  });
  await page.goto("/design-preview/battleship?state=all-weapons");
  await expect(page.locator(".sea-cell")).toHaveCount(200);
  await expect(page.locator(".ship-fx")).toHaveCount(0);
  await page.getByRole("button", { name: /Radar/ }).click();
  await page.locator('.sea[data-board=target] [data-row="4"][data-col="4"]').click();
  await expect(page.locator(".fx-radar")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.gameAudioNotes)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Mute sound effects" }).click();

  const before = await page.evaluate(() => window.gameAudioNotes);

  await page.getByRole("button", { name: /Bomb/ }).click();
  await page.locator('.sea[data-board=target] [data-row="1"][data-col="1"]').click();
  await expect(page.locator(".fx-bomb")).toBeVisible();
  expect(await page.evaluate(() => window.gameAudioNotes)).toBe(before);
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByRole("button", { name: "Preview hit", exact: true }).click();
  await expect(page.locator(".fx-hit")).toBeVisible();
  await page.getByRole("button", { name: "Preview miss", exact: true }).click();
  await expect(page.locator(".fx-miss")).toBeVisible();
  await expect(
    page.locator('.sea[data-board=target] [data-row="3"][data-col="8"]'),
  ).toHaveAttribute("data-miss", "true");
  await expect(
    page.getByRole("img", { name: "Mine return shot at D9", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ship-fx")).toHaveCount(0, { timeout: 3000 });
});

test("completed replay reveals both fleets while keeping controls disabled", async ({ page }) => {
  await page.goto("/design-preview/battleship?state=replay");
  const target = page.locator('.sea[data-board="target"]');
  const own = page.locator('.sea[data-board="own"]');
  await expect(target.locator('.sea-cell[data-ship="true"]')).toHaveCount(22);
  await expect(own.locator('.sea-cell[data-ship="true"]')).toHaveCount(22);
  await expect(target.getByRole("button", { name: "I9, mine", exact: true })).toBeDisabled();
  await expect(page.locator(".sea-cell:enabled")).toHaveCount(0);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`energy above ten wraps vertically and previews spending ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/design-preview/battleship?state=high-energy");
    const meter = page.getByRole("img", { name: "23 energy", exact: true });
    await expect(meter.locator('.energy-cell[data-on="true"]')).toHaveCount(23);
    const first = await meter.locator(".energy-cell").nth(0).boundingBox();
    const secondRow = await meter.locator(".energy-cell").nth(10).boundingBox();
    const thirdRow = await meter.locator(".energy-cell").nth(20).boundingBox();
    expect(secondRow!.y).toBeGreaterThan(first!.y);
    expect(thirdRow!.y).toBeGreaterThan(secondRow!.y);
    await page.getByRole("button", { name: /Bomb/ }).hover();
    await expect(meter.locator('.energy-cell[data-spend="true"]')).toHaveCount(5);
    await expect(page.locator(".ships-stage")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    const box = await meter.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  });
}
