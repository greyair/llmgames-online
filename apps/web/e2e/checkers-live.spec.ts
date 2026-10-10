import { sessionSeedSchema } from "./session-seed";
import {
  checkerMovesSchema,
  lastMoveSchema,
  numericBoardSchema,
} from "../src/domain/view-contracts";

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import type { ClientView } from "../src/domain/game-state";

// Local integration fixture only, including server-backed session IDs.
const sessionsPath = process.env.LLMGAMES_LIVE_TEST_SESSIONS;

test("real Worker: create, join, spectate, reconnect, complete match and replay", async ({
  browser,
}, info) => {
  test.skip(
    !sessionsPath,
    "Run seed-series-test-session.mjs --live and set LLMGAMES_LIVE_TEST_SESSIONS.",
  );
  test.setTimeout(240000);
  const sessions = sessionSeedSchema.parse(JSON.parse(readFileSync(sessionsPath!, "utf8")));

  const hostContext = await browser.newContext(),
    guestContext = await browser.newContext(),
    watchContext = await browser.newContext();

  const contexts = [hostContext, guestContext, watchContext];

  try {
    for (const [index, context] of contexts.entries())
      await context.addCookies([
        {
          name: "session",
          value: sessions[index]!.token,
          url: "http://127.0.0.1:3000",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);

    const host = await hostContext.newPage(),
      guest = await guestContext.newPage(),
      watch = await watchContext.newPage();

    const states = new Map<Page, ClientView>();
    const terminalMessages = new Map<Page, number>();

    for (const page of [host, guest, watch])
      page.on("websocket", (ws) =>
        ws.on("framereceived", ({ payload }) => {
          try {
            const message = JSON.parse(String(payload));

            const state =
              message.type === "game_ended"
                ? message.payload.finalState
                : (message.payload?.state ?? (message.type === "state" ? message.payload : null));

            if (state?.type === "checkers") states.set(page, state);

            if (message.type === "game_ended")
              terminalMessages.set(page, (terminalMessages.get(page) ?? 0) + 1);
          } catch {
            /* non-JSON keepalive */
          }
        }),
      );
    await host.goto("/checkers");
    await expect(host.getByRole("button", { name: "Create room", exact: true })).toBeEnabled();
    const created = host.waitForResponse((r) => r.url().endsWith("/api/v1/rooms/create"));
    await host.getByRole("button", { name: "Create room", exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(200);
    const link = await response.json();
    await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeDisabled();
    await guest.goto(`/checkers?roomCode=${link.roomCode}`);
    await expect(host.getByText(/^2 \/ \d+ players$/)).toBeVisible();
    await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeEnabled();
    await host.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(host.getByLabel("Checkers board", { exact: true })).toBeVisible();
    await expect(guest.getByLabel("Checkers board", { exact: true })).toBeVisible();
    await watch.goto(`/checkers?roomCode=${link.roomCode}`);
    await expect(watch.getByLabel("Checkers board", { exact: true })).toBeVisible();
    await expect(watch.locator(".checkers-cell:enabled")).toHaveCount(0);
    await guest.reload();
    await expect(guest.getByLabel("Checkers board", { exact: true })).toBeVisible();
    await host.screenshot({ path: info.outputPath("real-match.png") });

    let turns = 0,
      captures = 0,
      crowns = 0,
      chains = 0;

    // Automated fixture driver for this E2E test, never used by the multiplayer client or MCP host.
    while (states.get(host)?.status === "playing" && turns < 600) {
      const state = states.get(host)!;
      const actor = state.turnState!.currentPlayerId === state.you?.playerId ? host : guest;
      await expect
        .poll(() => states.get(actor)?.turnState?.currentPlayerId)
        .toBe(state.turnState!.currentPlayerId);
      const moves = checkerMovesSchema.parse(state.legalMoves);
      expect(moves.length).toBeGreaterThan(0);
      const move = moves[(turns * 17 + 3) % moves.length]!;
      const before = JSON.stringify(state.board);
      const piecesBefore = numericBoardSchema.parse(state.board).flat().filter(Boolean).length;

      if (!state.forcedPiece)
        await actor
          .getByRole("button", {
            name: new RegExp(`^Row ${move.fromRow + 1}, column ${move.fromCol + 1},`),
          })
          .click();
      else chains++;
      await actor
        .getByRole("button", {
          name: `Row ${move.row + 1}, column ${move.col + 1}, empty, move here`,
          exact: true,
        })
        .click();
      await expect.poll(() => JSON.stringify(states.get(host)?.board)).not.toBe(before);
      const next = states.get(host)!;

      if (numericBoardSchema.parse(next.board).flat().filter(Boolean).length < piecesBefore)
        captures++;

      if (lastMoveSchema.parse(next.lastMove)?.crowned) crowns++;
      turns++;
    }

    expect(states.get(host)?.status).toBe("ended");
    expect(turns).toBeGreaterThan(10);
    expect(captures).toBeGreaterThan(0);

    for (const page of [host, guest, watch]) {
      await expect(page.getByRole("region", { name: "Match summary" })).toBeVisible();
      expect(terminalMessages.get(page)).toBe(1);
    }

    await host.screenshot({ path: info.outputPath("real-result.png") });
    await host.getByRole("button", { name: "Watch replay", exact: true }).click();
    await expect(host.getByLabel("Replay position")).toBeVisible();
    await expect(host.locator(".checkers-cell:enabled")).toHaveCount(0);
    await host.screenshot({ path: info.outputPath("real-replay.png") });
    await writeFile(
      info.outputPath("match-evidence.json"),
      JSON.stringify({ turns, captures, crowns, chains, winner: states.get(host)?.winner }),
    );
    await info.attach("match-evidence", {
      body: JSON.stringify({ turns, captures, crowns, chains, winner: states.get(host)?.winner }),
      contentType: "application/json",
    });
  } finally {
    for (const context of contexts) await context.close();
  }
});
