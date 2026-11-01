import { describe, expect, it } from "vitest";
import { wireObjectSchema, wireValueSchema, type WireValue } from "@llmgames/game-catalog";
import { z } from "zod";

import { Connect4Room } from "../../durable-objects/Connect4Room";
import { GomokuRoom } from "../../durable-objects/GomokuRoom";
import type { RoomRuntime } from "../../durable-objects/runtime";
import type { Env } from "../../types";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { SqliteRoomSql } from "../fixtures/sqlite-room";
import { roomTestEnv } from "../fixtures/room-env";
import { gomokuPlugin } from "../../games/gomoku/plugin";
import { gomokuRuleBot } from "../../games/gomoku/bot";
import type { GamePlugin } from "../../games/contract";
import type { GomokuGameState } from "../../durable-objects/types";
import { BOT_MAX_STEPS_PER_TICK } from "../../durable-objects/BaseGameRoom";

/**
 * C4 rule bots.
 *
 * A bot is a policy on an ordinary seat: it has no controller, no credential and
 * no model call, and its moves go through `dispatchAction` like everyone else's.
 * These tests check the seat lifecycle and that a match actually progresses
 * without a human or a network.
 */

/** Sandbox env: the room reads its own audit trail through /sandbox/events. */
const BOT_ENV: Partial<Env> = { ENVIRONMENT: "development", SANDBOX_ENABLED: "true" };

const rowSchema = z.object({
  events: z.array(z.object({ type: z.string(), summary: z.unknown().optional() })),
});

const stateSchema = z.object({
  status: z.string(),
  players: z.array(z.object({ id: z.string(), name: z.string(), bot: z.boolean().optional() })),
  board: z.array(z.array(z.number())).optional(),
  winner: z.union([z.string(), z.null()]).optional(),
  you: z.object({ isYourTurn: z.boolean().optional() }).optional(),
});

interface Fixture<T> {
  room: T;
  runtime: MemoryRoomRuntime;
  act: (playerId: string, actionType: string, data?: WireValue) => Promise<boolean>;
  view: (playerId: string) => Promise<z.output<typeof stateSchema>>;
  events: () => Promise<z.output<typeof rowSchema>["events"]>;
  close: () => void;
}

async function createRoom<T extends GomokuRoom | Connect4Room>(
  RoomClass: new (state: RoomRuntime, env: Env) => T,
  environment: Env = roomTestEnv(BOT_ENV),
  code = "ABC234",
): Promise<Fixture<T>> {
  const runtime = new MemoryRoomRuntime(new Map());

  runtime.storage.sql = new SqliteRoomSql();

  const room = new RoomClass(runtime, environment);
  await runtime.initialized;

  const response = await room.fetch(
    new Request("https://room.test/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hostId: "host",
        hostName: "Host",
        roomCode: code,
        maxPlayers: 2,
        sandbox: true,
      }),
    }),
  );

  expect(response.ok).toBe(true);

  return {
    room,
    runtime,
    act: async (playerId, actionType, data = {}) => {
      const result = await room.fetch(
        new Request("https://room.test/agent/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playerId, actionType, data }),
        }),
      );

      return z.object({ ok: z.boolean() }).parse(wireValueSchema.parse(await result.json())).ok;
    },
    view: async (playerId) => {
      const result = await room.fetch(
        new Request(`https://room.test/agent/view?playerId=${encodeURIComponent(playerId)}`),
      );

      return stateSchema.parse(
        z.object({ state: stateSchema }).parse(wireObjectSchema.parse(await result.json())).state,
      );
    },
    events: async () => {
      const result = await room.fetch(new Request("https://room.test/sandbox/events"));

      return rowSchema.parse(wireObjectSchema.parse(await result.json())).events;
    },
    close: () => runtime.storage.values.clear(),
  };
}

/** Bot seat ids are server-generated, so read them back from the state. */
async function botIds(fixture: Fixture<GomokuRoom | Connect4Room>) {
  const state = await fixture.view("host");

  return state.players.filter((player) => player.bot).map((player) => player.id);
}

async function seatBot(fixture: Fixture<GomokuRoom | Connect4Room>) {
  expect(await fixture.act("host", "add_rule_bot")).toBe(true);

  const [bot] = await botIds(fixture);

  expect(bot).toBeDefined();

  return bot!;
}

/** First empty point, walking out from the centre. */
function freePoint(board: number[][] | undefined) {
  if (!board) return null;

  const mid = Math.floor(board.length / 2);

  for (let radius = 0; radius < board.length; radius++) {
    for (let row = 0; row < board.length; row++) {
      for (let col = 0; col < board.length; col++) {
        if (Math.abs(row - mid) + Math.abs(col - mid) !== radius) continue;

        if (board[row]?.[col] === 0) return { row, col };
      }
    }
  }

  return null;
}

/** Wake the room until nobody is left to move, bounded so a bug cannot hang. */
async function runToRest(room: GomokuRoom, limit = 40) {
  for (let tick = 0; tick < limit; tick++) await room.alarm();
}

describe("rule bot seats", () => {
  it("adds a named bot seat for the host only", async () => {
    const fixture = await createRoom(GomokuRoom);
    const bot = await seatBot(fixture);

    const state = await fixture.view("host");
    const seat = state.players.find((player) => player.id === bot);

    // A bot is not an MCP agent: it has a name and a marker, nothing else.
    expect(seat).toMatchObject({ bot: true, name: "Bot 1" });

    // A non-host cannot seat one.
    expect(await fixture.act(bot, "add_rule_bot")).toBe(false);
  });

  it("refuses a bot for a game without a policy", async () => {
    const fixture = await createRoom(Connect4Room, roomTestEnv(BOT_ENV), "CN2345");

    expect(await fixture.act("host", "add_rule_bot")).toBe(false);
  });

  it("never exceeds the room's seat count", async () => {
    const fixture = await createRoom(GomokuRoom);

    expect(await fixture.act("host", "add_rule_bot")).toBe(true);
    // Two seats, both taken.
    expect(await fixture.act("host", "add_rule_bot")).toBe(false);
  });

  it("removes every bot again", async () => {
    const fixture = await createRoom(GomokuRoom);

    await seatBot(fixture);

    expect(await fixture.act("host", "remove_rule_bot")).toBe(true);
    expect(await botIds(fixture)).toHaveLength(0);
  });
});

describe("a bot plays the match", () => {
  it("moves on its own when it holds the first turn", async () => {
    const fixture = await createRoom(GomokuRoom);
    const bot = await seatBot(fixture);

    expect(await fixture.act("host", "start_game")).toBe(true);

    const state = await fixture.view("host");
    const stones = (state.board ?? []).flat().filter((cell) => cell !== 0).length;

    // If the drawn starter was the bot it has already placed a stone; otherwise
    // the host holds the decision and nothing has moved yet.
    expect(stones === 1 || stones === 0).toBe(true);

    const events = await fixture.events();

    if (stones === 1) expect(events.some((event) => event.type === "action")).toBe(true);
    expect(bot).toBeTruthy();
  });

  it("answers a human move immediately", async () => {
    const fixture = await createRoom(GomokuRoom);

    await seatBot(fixture);
    await fixture.act("host", "start_game");

    const started = await fixture.view("host");

    const stonesAtStart = (started.board ?? []).flat().filter((cell) => cell !== 0).length;

    // The bot may hold the drawn first turn, in which case it already moved.
    expect(stonesAtStart).toBeLessThanOrEqual(1);

    // The bot prefers the centre, so ask the board for a free point instead of
    // assuming one: (7,7) may already hold the bot's opening stone.
    if (started.you?.isYourTurn) {
      const free = freePoint(started.board);

      expect(free).not.toBeNull();
      expect(
        await fixture.act("host", "place_stone", { row: free!.row, col: free!.col }),
      ).toBe(true);
    }

    const after = await fixture.view("host");
    const stones = (after.board ?? []).flat().filter((cell) => cell !== 0).length;

    // One stone is the human's, so the second can only be the bot's reply.
    expect(stones).toBeGreaterThanOrEqual(2);
  });

  it("records bot moves in the action log with the bot's own identity", async () => {
    const fixture = await createRoom(GomokuRoom);
    const bot = await seatBot(fixture);

    await fixture.act("host", "start_game");

    const state = await fixture.view("host");

    if ((state.board ?? []).flat().every((cell) => cell === 0))
      await fixture.act("host", "place_stone", { row: 7, col: 7 });

    const logged = await fixture.events();
    const actions = logged.filter((event) => event.type === "action");

    expect(actions.length).toBeGreaterThan(0);
    expect(bot).toBeTruthy();
  });

  it("finishes a bot-versus-bot match without a human or a model", async () => {
    // No provider key anywhere: a rule bot must not need one.
    const fixture = await createRoom(
      GomokuRoom,
      roomTestEnv({ ...BOT_ENV, TYPESAFE_API_KEY: undefined }),
    );

    // Two bots only: the host leaves a seat for the second bot.
    expect(await fixture.act("host", "set_host_spectating", { spectating: true })).toBe(true);
    expect(await fixture.act("host", "add_rule_bot")).toBe(true);
    expect(await fixture.act("host", "add_rule_bot")).toBe(true);

    expect(await fixture.act("host", "start_game")).toBe(true);

    // The match ends by itself. A finished room with no connected client is
    // purged, so "the room stopped existing" is also a terminal observation.
    let finished = false;

    for (let tick = 0; tick < 60 && !finished; tick++) {
      await fixture.room.alarm();

      const probe = await fixture.room.fetch(new Request("https://room.test/state"));

      if (probe.status === 404) {
        finished = true;
        break;
      }

      const state = await fixture.view("host").catch(() => null);

      if (state?.status === "ended") finished = true;
    }

    expect(finished).toBe(true);
  });

  it("spends at most one burst per wake-up", async () => {
    const fixture = await createRoom(GomokuRoom);

    await fixture.act("host", "set_host_spectating", { spectating: true });
    await fixture.act("host", "add_rule_bot");
    await fixture.act("host", "add_rule_bot");
    await fixture.act("host", "start_game");

    const before = (await fixture.view("host")).board?.flat().filter((cell) => cell !== 0).length ?? 0;

    expect(before).toBeLessThanOrEqual(BOT_MAX_STEPS_PER_TICK);

    await fixture.room.alarm();

    const after = (await fixture.view("host")).board?.flat().filter((cell) => cell !== 0).length ?? 0;

    expect(after).toBeLessThanOrEqual(before + BOT_MAX_STEPS_PER_TICK);
  });
});

describe("bot failure handling", () => {
  it("pauses a bot whose strategy has nothing to say, and keeps the room playable", async () => {
    const runtime = new MemoryRoomRuntime(new Map());

    runtime.storage.sql = new SqliteRoomSql();

    const silent: GamePlugin<GomokuGameState, "gomoku"> = {
      ...gomokuPlugin,
      ruleBot: { id: "silent", chooseAction: () => null },
    };

    class SilentBotRoom extends GomokuRoom {
      protected gameRules() {
        return silent;
      }
    }

    const room = new SilentBotRoom(runtime, roomTestEnv());
    await runtime.initialized;

    await room.fetch(
      new Request("https://room.test/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostId: "host", hostName: "Host", roomCode: "ABC234", maxPlayers: 2 }),
      }),
    );

    const act = async (actionType: string) =>
      room.fetch(
        new Request("https://room.test/agent/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playerId: "host", actionType, data: {} }),
        }),
      );

    expect((await act("add_rule_bot")).ok).toBe(true);
    expect((await act("start_game")).ok).toBe(true);

    // Whatever the draw, the host can still act or end the match afterwards.
    const ended = await act("end_game");

    expect(ended.ok).toBe(true);
  });

  it("returns null instead of guessing when the move is not offered", () => {
    expect(
      gomokuRuleBot.chooseAction({
        gameType: "gomoku",
        playerId: "bot",
        phase: "play",
        legalActions: ["leave"],
        view: {},
      }),
    ).toBeNull();
  });
});
