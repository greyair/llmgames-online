import { wireObjectSchema, type WireObject } from "@llmgames/game-catalog";
import { describe, expect, it } from "vitest";

import { gamePluginFor } from "../../games/registry";
import { CheckersRoom } from "../../durable-objects/CheckersRoom";
import { Connect4Room } from "../../durable-objects/Connect4Room";
import { ReversiRoom } from "../../durable-objects/ReversiRoom";
import { createGameRoomFixture } from "../fixtures/game-room";

/**
 * M3.4.1 — a rule module's projection must be the only door out.
 *
 * `projectState` was declared by the Checkers plugin but never called: the base
 * `projectStateFor` still returned the raw state, so the browser and WebSocket
 * views carried `positionCounts`, the repetition bookkeeping the pre-plugin room
 * stripped. Wiring one hook is not enough — the guard here is that for every
 * migrated game, whatever the plugin hides is absent from all three views a
 * client can read: browser, agent and replay.
 */

type RoomCtor = Parameters<typeof createGameRoomFixture>[0];

type Fixture = Awaited<ReturnType<typeof createGameRoomFixture>>;

const MIGRATED: ReadonlyArray<readonly [string, RoomCtor]> = [
  ["p4", Connect4Room],
  ["rv", ReversiRoom],
  ["ck", CheckersRoom],
];

/** Keys the plugin keeps inside the server, computed from the plugin itself. */
function hiddenKeys(fixture: Fixture, playerId: string): readonly string[] {
  const state = fixture.state();
  const plugin = gamePluginFor(state.type);

  expect(plugin).not.toBeNull();

  const projection = plugin?.projectState?.(state, playerId) ?? state;

  return Object.keys(state).filter((key) => !Object.hasOwn(projection, key));
}

function browserOf(fixture: Fixture, playerId: string): WireObject {
  return wireObjectSchema.parse(fixture.room.browser(playerId));
}

function rewatchOf(fixture: Fixture): WireObject {
  return wireObjectSchema.parse(fixture.room.rewatch());
}

describe("plugin state projection", () => {
  for (const [prefix, Room] of MIGRATED) {
    it(`keeps ${prefix} hidden fields out of every client view`, async () => {
      const fixture = await createGameRoomFixture(Room, prefix, 2);
      const viewer = fixture.ids[0]!;
      const hidden = hiddenKeys(fixture, viewer);

      const browser = browserOf(fixture, viewer);
      const agent = wireObjectSchema.parse(await fixture.view(viewer));
      const replay = rewatchOf(fixture);

      for (const key of hidden) {
        expect(browser).not.toHaveProperty(key);
        expect(agent).not.toHaveProperty(key);
        expect(replay).not.toHaveProperty(key);
      }

      // A game with nothing to hide still has to publish the board itself, so a
      // projection that dropped everything would fail here instead of passing.
      expect(browser).toHaveProperty("board");
      expect(agent).toHaveProperty("board");
    });
  }

  it("hides Checkers repetition bookkeeping, as the pre-plugin room did", async () => {
    const fixture = await createGameRoomFixture(CheckersRoom, "ckp", 2);
    const viewer = fixture.ids[0]!;

    // The hidden set is not empty, which is what makes the loop above meaningful.
    expect(hiddenKeys(fixture, viewer)).toEqual(["positionCounts"]);
    expect(fixture.state().positionCounts).toBeTypeOf("object");

    const serialized = JSON.stringify({
      browser: browserOf(fixture, viewer),
      agent: await fixture.view(viewer),
      replay: rewatchOf(fixture),
    });

    expect(serialized).not.toContain("positionCounts");
  });

  it("applies the same projection to the shared broadcast view", async () => {
    const fixture = await createGameRoomFixture(CheckersRoom, "ckb", 2);
    // `/broadcast` serves the payload pushed to every spectator socket, so it is
    // the third door out. `broadcastProjection` keeps its own allowlist, which is
    // why this stays green even without a plugin projection — the point is that
    // neither layer may start forwarding internal bookkeeping.
    fixture.state().broadcastAllowed = true;

    const response = await fixture.room.fetch(new Request("https://fixture.invalid/broadcast"));

    expect(response.status).toBe(200);

    const broadcast = wireObjectSchema.parse(await response.json());

    expect(broadcast).toHaveProperty("board");
    expect(broadcast).not.toHaveProperty("positionCounts");
  });
});
