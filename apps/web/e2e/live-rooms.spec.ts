import { sessionSeedSchema } from "./session-seed";
import { test, expect, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";

const sessionsPath = process.env.LLMGAMES_LIVE_TEST_SESSIONS;

test.skip(
  !sessionsPath,
  "Run seed-series-test-session.mjs --live against the local Worker and set LLMGAMES_LIVE_TEST_SESSIONS",
);

async function authorize(context: BrowserContext, seat: 1 | 2 | 3 | 4) {
  const sessions = sessionSeedSchema.parse(JSON.parse(readFileSync(sessionsPath!, "utf8")));
  await context.addCookies([
    {
      name: "session",
      value: sessions[seat - 1]!.token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test("real Connect 4 room completes and replays without device storage", async ({
  browser,
}, info) => {
  test.setTimeout(60000);

  const one = await browser.newContext(),
    two = await browser.newContext();

  await authorize(one, 1);
  await authorize(two, 2);

  const host = await one.newPage(),
    guest = await two.newPage();

  try {
    await host.goto("http://localhost:3001/connect4");
    await host.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeVisible();
    const code = new URL(host.url()).searchParams.get("roomCode");
    expect(code).toBeTruthy();
    await guest.goto(`http://localhost:3001/connect4?roomCode=${code}`);
    await expect(host.getByText(/^2 \/ \d+ players$/)).toBeVisible();
    await host.getByRole("button", { name: "Start game", exact: true }).click();
    await expect
      .poll(
        async () =>
          Number(
            await host.getByRole("button", { name: "Drop in column 1", exact: true }).isEnabled(),
          ) +
          Number(
            await guest.getByRole("button", { name: "Drop in column 1", exact: true }).isEnabled(),
          ),
      )
      .toBe(1);

    const first = (await host
      .getByRole("button", { name: "Drop in column 1", exact: true })
      .isEnabled())
      ? host
      : guest;

    const second = first === host ? guest : host;
    const winner = first === host ? "UITestOne" : "UITestTwo";
    await expect(
      first.getByRole("button", { name: "Drop in column 1", exact: true }),
    ).toBeEnabled();
    await first.getByRole("button", { name: "Drop in column 1", exact: true }).click();
    await expect(
      second.getByRole("button", { name: "Drop in column 7", exact: true }),
    ).toBeEnabled();
    await second.getByRole("button", { name: "Drop in column 7", exact: true }).click();
    await expect(
      first.getByRole("button", { name: "Drop in column 1", exact: true }),
    ).toBeEnabled();
    await first.getByRole("button", { name: "Drop in column 1", exact: true }).click();
    await expect(
      second.getByRole("button", { name: "Drop in column 7", exact: true }),
    ).toBeEnabled();
    await second.getByRole("button", { name: "Drop in column 7", exact: true }).click();
    await expect(
      first.getByRole("button", { name: "Drop in column 1", exact: true }),
    ).toBeEnabled();
    await first.getByRole("button", { name: "Drop in column 1", exact: true }).click();
    await expect(
      second.getByRole("button", { name: "Drop in column 7", exact: true }),
    ).toBeEnabled();
    await second.getByRole("button", { name: "Drop in column 7", exact: true }).click();
    await expect(
      first.getByRole("button", { name: "Drop in column 1", exact: true }),
    ).toBeEnabled();
    await first.getByRole("button", { name: "Drop in column 1", exact: true }).click();
    await expect(
      first
        .getByRole("region", { name: "Match summary" })
        .getByRole("heading", { name: "You win!", exact: true }),
    ).toBeVisible();
    await expect(
      second
        .getByRole("region", { name: "Match summary" })
        .getByRole("heading", { name: `${winner} wins!`, exact: true }),
    ).toBeVisible();
    await expect(host.getByRole("dialog")).toHaveCount(0);
    await expect(guest.getByRole("dialog")).toHaveCount(0);
    expect(
      await host.evaluate(
        () => Object.keys(localStorage).filter((key) => key.startsWith("llmgames-rewatch:")).length,
      ),
    ).toBe(0);
    await host.screenshot({ path: info.outputPath("real-result.png") });
    await host.getByRole("button", { name: "Watch replay", exact: true }).click();
    await expect(host.getByLabel("Replay position")).toBeVisible();
    await expect(host.getByRole("button", { name: /Drop in column/ })).toHaveCount(0);
  } finally {
    await one.close();
    await two.close();
  }
});

for (const game of ["reversi", "poker"])
  test(`real ${game} projection and action`, async ({ browser }, info) => {
    test.setTimeout(45000);

    const one = await browser.newContext(),
      two = await browser.newContext();

    await authorize(one, 1);
    await authorize(two, 2);

    const host = await one.newPage(),
      guest = await two.newPage();

    try {
      await host.goto(`http://localhost:3001/${game}`);
      await host.getByRole("button", { name: "Create room", exact: true }).click();
      await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeVisible();
      const code = new URL(host.url()).searchParams.get("roomCode");
      await guest.goto(`http://localhost:3001/${game}?roomCode=${code}`);
      await expect(host.getByText(/^2 \/ \d+ players$/)).toBeVisible();
      await host.getByRole("button", { name: "Start game", exact: true }).click();

      if (game === "reversi") {
        await expect
          .poll(
            async () =>
              (await host.locator(".discs-cell:enabled").count()) +
              (await guest.locator(".discs-cell:enabled").count()),
          )
          .toBe(4);
        const first = (await host.locator(".discs-cell:enabled").count()) ? host : guest;
        const second = first === host ? guest : host;
        await expect(
          host
            .locator(".desk-player")
            .filter({ hasText: first === host ? "UITestOne" : "UITestTwo" })
            .getByRole("img", { name: "Black pieces", exact: true }),
        ).toBeVisible();
        await first.locator(".discs-cell:enabled").first().click();
        await expect(second.locator(".playing-disc.piece-1")).toHaveCount(4);
        await expect(second.locator(".playing-disc.piece-2")).toHaveCount(1);
        await second.locator(".discs-cell:enabled").first().click();
        await expect.poll(() => host.locator(".playing-disc:not(.piece-0)").count()).toBe(6);
        await expect.poll(() => guest.locator(".playing-disc:not(.piece-0)").count()).toBe(6);
      } else {
        await expect
          .poll(
            async () =>
              (await host.getByRole("button", { name: "Fold", exact: true }).count()) +
              (await guest.getByRole("button", { name: "Fold", exact: true }).count()),
          )
          .toBe(1);

        const actor = (await host.getByRole("button", { name: "Fold", exact: true }).count())
          ? host
          : guest;

        await expect(actor.getByRole("img", { name: "Hidden card", exact: true })).toHaveCount(2);
        await actor.getByRole("button", { name: "Fold", exact: true }).click();
        await expect(host.getByRole("button", { name: "Next hand", exact: true })).toBeVisible();
      }

      await host.screenshot({ path: info.outputPath("real-board.png") });
      await host.getByLabel("Game options", { exact: true }).click();
      await host.getByRole("button", { name: "End game", exact: true }).click();
      await host.getByRole("dialog").getByRole("button", { name: "End game", exact: true }).click();
      await expect(host.getByRole("region", { name: "Match summary" })).toBeVisible();
      await expect(guest.getByRole("region", { name: "Match summary" })).toBeVisible();
      await expect(host.getByRole("button", { name: "Watch replay", exact: true })).toBeVisible();
      await expect(guest.getByRole("button", { name: "Watch replay", exact: true })).toBeVisible();
    } finally {
      await one.close();
      await two.close();
    }
  });

for (const game of ["pokemon", "battleship"])
  test(`real ${game} setup and decision`, async ({ browser }, info) => {
    test.setTimeout(45000);

    const one = await browser.newContext(),
      two = await browser.newContext();

    await authorize(one, 1);
    await authorize(two, 2);

    const host = await one.newPage(),
      guest = await two.newPage();

    try {
      await host.goto(`http://localhost:3001/${game}`);
      await host.getByRole("button", { name: "Create room", exact: true }).click();
      await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeVisible();
      const code = new URL(host.url()).searchParams.get("roomCode");
      await guest.goto(`http://localhost:3001/${game}?roomCode=${code}`);
      await expect(host.getByText(/^2 \/ \d+ players$/)).toBeVisible();
      await host.getByRole("button", { name: "Start game", exact: true }).click();

      if (game === "pokemon") {
        await expect(host.locator(".pokemon-move:enabled").first()).toBeVisible();
        await expect(guest.locator(".pokemon-move:enabled").first()).toBeVisible();
        await expect(
          host.getByRole("img", { name: "Unrevealed Pokémon", exact: true }),
        ).toHaveCount(5);
        await host.locator(".pokemon-move:enabled").first().click();
        await expect(host.locator(".pokemon-move:enabled")).toHaveCount(0);
        await expect(guest.locator(".pokemon-move:enabled").first()).toBeVisible();
        await guest.locator(".pokemon-move:enabled").first().click();
        await expect
          .poll(
            async () =>
              (await host.locator(".poke-turn").innerText()) === "Turn 2" ||
              (await host.locator(".pokemon-decision[data-force-switch=true]").count()) > 0 ||
              (await guest.locator(".pokemon-decision[data-force-switch=true]").count()) > 0,
          )
          .toBe(true);
      } else {
        await expect(host.getByRole("button", { name: "Ready", exact: true })).toBeDisabled();

        const placeFleet = async (page: typeof host) => {
          for (const [ship, cell] of [
            ["Carrier", "A1"],
            ["Dreadnought", "A6"],
            ["Cruiser", "D1"],
            ["Sub", "D5"],
            ["Destroyer", "D8"],
          ] as const) {
            await page.getByRole("button", { name: new RegExp(ship) }).click();

            const row = cell.charCodeAt(0) - 65,
              col = Number(cell.slice(1)) - 1;

            await page
              .locator(`.sea[data-board="target"] .sea-cell[data-row="${row}"][data-col="${col}"]`)
              .click();
          }

          await page.getByRole("button", { name: "Ready", exact: true }).click();
        };

        await placeFleet(host);
        await placeFleet(guest);
        await expect(host.getByRole("group", { name: "Weapons", exact: true })).toBeVisible();
        await expect
          .poll(
            async () =>
              Number(
                await host
                  .getByRole("group", { name: "Target grid", exact: true })
                  .getByRole("button", { name: "A1", exact: true })
                  .isEnabled(),
              ) +
              Number(
                await guest
                  .getByRole("group", { name: "Target grid", exact: true })
                  .getByRole("button", { name: "A1", exact: true })
                  .isEnabled(),
              ),
          )
          .toBe(1);

        const actor = (await host
          .getByRole("group", { name: "Target grid", exact: true })
          .getByRole("button", { name: "A1", exact: true })
          .isEnabled())
          ? host
          : guest;

        await actor
          .getByRole("group", { name: "Target grid", exact: true })
          .getByRole("button", { name: "A1", exact: true })
          .click();
        await expect(actor.locator(".ship-notice")).toContainText("Hit! (2 pts)");
      }

      await host.screenshot({ path: info.outputPath("real-board.png") });
      await host.getByLabel("Game options", { exact: true }).click();
      await host.getByRole("button", { name: "End game", exact: true }).click();
      await host.getByRole("dialog").getByRole("button", { name: "End game", exact: true }).click();
      await expect(host.getByRole("region", { name: "Match summary" })).toBeVisible();
      await expect(guest.getByRole("region", { name: "Match summary" })).toBeVisible();
      await expect(host.getByRole("button", { name: "Watch replay", exact: true })).toBeVisible();
      await expect(guest.getByRole("button", { name: "Watch replay", exact: true })).toBeVisible();
    } finally {
      await one.close();
      await two.close();
    }
  });

test("real Codenames roles, private keys and clue transition", async ({ browser }, info) => {
  test.setTimeout(90000);

  const one = await browser.newContext(),
    two = await browser.newContext(),
    three = await browser.newContext(),
    four = await browser.newContext();

  await authorize(one, 1);
  await authorize(two, 2);
  await authorize(three, 3);
  await authorize(four, 4);

  const host = await one.newPage(),
    red = await two.newPage(),
    blueSpy = await three.newPage(),
    blue = await four.newPage();

  try {
    await host.goto("http://localhost:3001/codenames");
    await host
      .getByRole("group", { name: "Time per turn", exact: true })
      .getByRole("button", { name: "150s", exact: true })
      .click();
    await host.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeVisible();
    const code = new URL(host.url()).searchParams.get("roomCode");
    await red.goto(`http://localhost:3001/codenames?roomCode=${code}`);
    await blueSpy.goto(`http://localhost:3001/codenames?roomCode=${code}`);
    await blue.goto(`http://localhost:3001/codenames?roomCode=${code}`);
    await expect(host.getByText(/^4 \/ \d+ players$/)).toBeVisible();
    await expect(host.locator('.lobby-team[data-team="blue"]')).toContainText("UITestTwo");
    await expect(host.locator('.lobby-team[data-team="red"]')).toContainText("UITestOne");
    await expect(host.locator('.lobby-team[data-team="blue"]')).toContainText("UITestFour");
    await expect(host.locator('.lobby-team[data-team="red"]')).toContainText("UITestThree");
    await host.getByRole("button", { name: "Start game", exact: true }).click();
    const views = [host, red, blueSpy, blue];
    await expect
      .poll(async () => {
        const counts = await Promise.all(
          views.map((view) => view.locator(".word-card:not([data-team=hidden])").count()),
        );

        return counts.filter((count) => count === 25).length;
      })
      .toBe(2);
    await expect
      .poll(async () => {
        const counts = await Promise.all(views.map((view) => view.getByLabel("Clue word").count()));

        return counts.filter(Boolean).length;
      })
      .toBe(1);
    let spy = host;

    if (!(await spy.getByLabel("Clue word").count())) spy = red;

    if (!(await spy.getByLabel("Clue word").count())) spy = blueSpy;

    if (!(await spy.getByLabel("Clue word").count())) spy = blue;
    let operative = red;

    for (const view of views) {
      if (view !== spy && (await view.locator(".word-card[data-team=hidden]").count()) === 25) {
        operative = view;
        break;
      }
    }

    await expect(operative.locator(".word-card[data-team=hidden]")).toHaveCount(25);
    const activeTeam = await spy.locator(".words-turn-heading").getAttribute("data-team");

    const safeIndex = await spy
      .locator(`.word-card[data-team="${activeTeam}"]`)
      .first()
      .getAttribute("data-index");

    await spy.getByLabel("Clue word").fill("Quizzical");
    await spy.getByLabel("Clue count").selectOption("1");
    await spy.getByRole("button", { name: "Give clue", exact: true }).click();
    await expect
      .poll(async () => {
        const counts = await Promise.all(
          views.map((view) => view.locator(".word-card:enabled").count()),
        );

        return counts.reduce((max, count) => Math.max(max, count), 0);
      })
      .toBeGreaterThan(0);

    for (const view of views) {
      if (await view.locator(".word-card:enabled").count()) {
        operative = view;
        break;
      }
    }

    await operative.locator(`.word-card[data-index="${safeIndex}"]`).click();
    await expect(operative.locator(".word-card[data-revealed=true]")).toHaveCount(1);
    await operative.screenshot({ path: info.outputPath("real-codenames.png") });
    await host.getByLabel("Game options", { exact: true }).click();
    await host.getByRole("button", { name: "End game", exact: true }).click();
    await host.getByRole("dialog").getByRole("button", { name: "End game", exact: true }).click();

    for (const view of views)
      await expect(view.getByRole("region", { name: "Match summary" })).toBeVisible();
  } finally {
    await one.close();
    await two.close();
    await three.close();
    await four.close();
  }
});

for (const game of ["checkers", "contexto"])
  test(`real ${game} action reaches both seats`, async ({ browser }, info) => {
    test.setTimeout(60000);

    const one = await browser.newContext(),
      two = await browser.newContext();

    await authorize(one, 1);
    await authorize(two, 2);

    const host = await one.newPage(),
      guest = await two.newPage();

    try {
      await host.goto(`http://localhost:3001/${game}`);
      await host.getByRole("button", { name: "Create room", exact: true }).click();
      await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeVisible();
      const code = new URL(host.url()).searchParams.get("roomCode");
      await guest.goto(`http://localhost:3001/${game}?roomCode=${code}`);
      await expect(host.getByText(/^2 \/ \d+ players$/)).toBeVisible();
      await host.getByRole("button", { name: "Start game", exact: true }).click();

      if (game === "checkers") {
        await expect
          .poll(
            async () =>
              (await host.locator(".checkers-cell:enabled").count()) +
              (await guest.locator(".checkers-cell:enabled").count()),
          )
          .toBeGreaterThan(0);
        const actor = (await host.locator(".checkers-cell:enabled").count()) ? host : guest;
        const other = actor === host ? guest : host;
        await actor.locator(".checkers-cell[data-source=true]:enabled").first().click();
        await actor.locator(".checkers-cell[data-destination=true]:enabled").first().click();
        await expect(
          other.locator(".checkers-cell[data-source=true]:enabled").first(),
        ).toBeVisible();
        await expect(host.locator(".checkers-cell[data-last-move=true]")).toHaveCount(1);
        await expect(guest.locator(".checkers-cell[data-last-move=true]")).toHaveCount(1);
      } else {
        await host.getByLabel("Guess a word", { exact: true }).fill("water");
        await host.getByRole("button", { name: "Guess", exact: true }).click();
        await expect(host.getByLabel(/Last guess water, rank/)).toBeVisible();
        const rivals = guest.getByRole("region", { name: "Other players' hidden guesses" });
        await expect(rivals).toContainText("1 / 50");
        await expect(rivals).not.toContainText("water");
        await guest.getByLabel("Guess a word", { exact: true }).fill("house");
        await guest.getByRole("button", { name: "Guess", exact: true }).click();
        await expect(guest.getByLabel(/Last guess house, rank/)).toBeVisible();
        await expect(
          host.getByRole("region", { name: "Other players' hidden guesses" }),
        ).not.toContainText("house");
      }

      await host.screenshot({ path: info.outputPath("real-board.png") });
      await host.getByLabel("Game options", { exact: true }).click();
      await host.getByRole("button", { name: "End game", exact: true }).click();
      await host.getByRole("dialog").getByRole("button", { name: "End game", exact: true }).click();
      await expect(host.getByRole("region", { name: "Match summary" })).toBeVisible();
      await expect(guest.getByRole("region", { name: "Match summary" })).toBeVisible();
    } finally {
      await one.close();
      await two.close();
    }
  });
