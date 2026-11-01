import { describe, expect, it } from "vitest";
import { wireObjectSchema, wireValueSchema, type WireValue } from "@llmgames/game-catalog";
import { z } from "zod";

import { AeroplaneRoom } from "../../durable-objects/AeroplaneRoom";
import { BOT_RESUME_LIMIT, BOT_WAKE_MS } from "../../durable-objects/BaseGameRoom";
import { ReversiRoom } from "../../durable-objects/ReversiRoom";
import type { RoomRuntime } from "../../durable-objects/runtime";
import type { Env } from "../../types";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { SqliteRoomSql } from "../fixtures/sqlite-room";
import { roomTestEnv } from "../fixtures/room-env";
import { aeroplaneRuleBot } from "../../games/aeroplane/bot";
import { reversiRuleBot } from "../../games/reversi/bot";
import { gomokuRuleBot } from "../../games/gomoku/bot";
import { connect4Plugin } from "../../games/connect4/plugin";

/**
 * C4 strategies for the second and third games, plus the integration that
 * matters most: a bot turn contains more than one decision (roll, then move)
 * and the platform advances through both without a socket.
 */

const BOT_ENV: Partial<Env> = { ENVIRONMENT: "development", SANDBOX_ENABLED: "true" };

const stateSchema = z.object({
  status: z.string(),
  players: z.array(z.object({ id: z.string(), name: z.string(), bot: z.boolean().optional() })),
  board: z.union([z.array(z.array(z.number())), z.string()]).optional(),
  scores: z.record(z.string(), z.number()).optional(),
  seats: z.record(z.string(), z.number()).optional(),
  planes: z.array(z.array(z.number())).optional(),
  roll: z.union([z.number(), z.null()]).optional(),
  phase: z.string().optional(),
  turnState: z.object({ phase: z.string(), currentPlayerId: z.union([z.string(), z.null()]) }),
  you: z
    .object({ isYourTurn: z.boolean().optional(), legalActions: z.array(z.string()).optional() })
    .optional(),
  pausedBots: z.array(z.string()).optional(),
  winner: z.union([z.string(), z.null()]).optional(),
});

type RoomState = z.output<typeof stateSchema>;

async function createRoom<T extends ReversiRoom | AeroplaneRoom>(
  RoomClass: new (state: RoomRuntime, env: Env) => T,
  body: Record<string, WireValue>,
  code: string,
  onAlarm?: (at: number | null) => void,
) {
  const runtime = new MemoryRoomRuntime(new Map(), onAlarm);

  runtime.storage.sql = new SqliteRoomSql();

  const room = new RoomClass(runtime, roomTestEnv(BOT_ENV));
  await runtime.initialized;

  const created = await room.fetch(
    new Request("https://room.test/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostId: "host", hostName: "Host", roomCode: code, sandbox: true, ...body }),
    }),
  );

  expect(created.ok).toBe(true);

  const act = async (playerId: string, actionType: string, data: WireValue = {}) => {
    const result = await room.fetch(
      new Request("https://room.test/agent/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, actionType, data }),
      }),
    );

    return z.object({ ok: z.boolean() }).parse(wireValueSchema.parse(await result.json())).ok;
  };

  const view = async (playerId: string): Promise<RoomState> => {
    const result = await room.fetch(
      new Request(`https://room.test/agent/view?playerId=${encodeURIComponent(playerId)}`),
    );

    const body = z
      .object({ state: stateSchema })
      .parse(wireObjectSchema.parse(await result.json()));

    return body.state;
  };

  return { room, act, view };
}

describe("reversi strategy", () => {
  it("takes a corner even when another move flips more", () => {
    const intent = reversiRuleBot.chooseAction({
      gameType: "reversi",
      playerId: "bot",
      phase: "play",
      legalActions: ["place_disc"],
      view: {
        legalMoves: [
          { row: 2, col: 3, flipCount: 6 },
          { row: 0, col: 0, flipCount: 1 },
        ],
      },
    });

    expect(intent).toEqual({ actionType: "place_disc", data: { row: 0, col: 0 } });
  });

  it("avoids the squares next to a corner", () => {
    const intent = reversiRuleBot.chooseAction({
      gameType: "reversi",
      playerId: "bot",
      phase: "play",
      legalActions: ["place_disc"],
      view: {
        legalMoves: [
          { row: 1, col: 1, flipCount: 5 },
          { row: 4, col: 4, flipCount: 2 },
        ],
      },
    });

    expect(intent).toEqual({ actionType: "place_disc", data: { row: 4, col: 4 } });
  });

  it("declines when the game offers no move", () => {
    expect(
      reversiRuleBot.chooseAction({
        gameType: "reversi",
        playerId: "bot",
        phase: "play",
        legalActions: ["pass"],
        view: { legalMoves: [] },
      }),
    ).toBeNull();
  });
});

describe("aeroplane strategy", () => {
  const base = {
    gameType: "aeroplane",
    playerId: "bot",
    phase: "roll",
    view: {
      seats: { bot: 0, rival: 1 },
      planes: [
        [-1, -1, -1, -1],
        [-1, -1, -1, -1],
      ],
      colours: [0, 1],
      takeoff: [6],
      sixes: 0,
    },
  };

  it("rolls when it is the dice phase", () => {
    expect(
      aeroplaneRuleBot.chooseAction({ ...base, legalActions: ["roll"], view: { ...base.view } }),
    ).toEqual({ actionType: "roll", data: {} });
  });

  it("launches with a six when every plane is still in the hangar", () => {
    const intent = aeroplaneRuleBot.chooseAction({
      ...base,
      phase: "choose",
      legalActions: ["launch_plane"],
      view: { ...base.view, roll: 6 },
    });

    expect(intent).toEqual({ actionType: "launch_plane", data: { plane: 1 } });
  });

  it("moves the plane that is closest to home", () => {
    const intent = aeroplaneRuleBot.chooseAction({
      ...base,
      phase: "choose",
      legalActions: ["move_plane"],
      view: {
        ...base.view,
        roll: 3,
        planes: [
          [40, 5, -1, -1],
          [10, -1, -1, -1],
        ],
      },
    });

    expect(intent).toEqual({ actionType: "move_plane", data: { plane: 1 } });
  });

  it("declines when every plane is already home", () => {
    expect(
      aeroplaneRuleBot.chooseAction({
        ...base,
        phase: "choose",
        legalActions: ["move_plane"],
        view: { ...base.view, roll: 3, planes: [[59, 59, 59, 59], [-1, -1, -1, -1]] },
      }),
    ).toBeNull();
  });
});

describe("strategies are only offered by the games that ship one", () => {
  it("leaves the other games without a bot", () => {
    expect(connect4Plugin.ruleBot).toBeUndefined();
    expect(gomokuRuleBot.id).toBe("gomoku.heuristic.v1");
    expect(reversiRuleBot.id).toBe("reversi.weighted-greedy.v1");
    expect(aeroplaneRuleBot.id).toBe("aeroplane.greedy.v1");
  });
});

/** Reversi sends a numeric grid here; the string form is the chess board. */
const gridSchema = z.array(z.array(z.number())).catch([]);

const textSchema = z.string().catch("");

function discCount(board: RoomState["board"]): number {
  const grid = gridSchema.parse(board);

  if (grid.length > 0) return grid.flat().filter((cell) => cell !== 0).length;

  return textSchema.parse(board).split("").filter((cell) => cell !== ".").length;
}

describe("a bot plays real rooms", () => {
  /** Wake the room a few times; each wake advances up to a burst of bot moves. */
  async function wake(room: ReversiRoom | AeroplaneRoom, times: number) {
    for (let tick = 0; tick < times; tick++) await room.alarm();
  }

  it("plays a reversi match to the end without a human", async () => {
    const { room, act, view } = await createRoom(ReversiRoom, { maxPlayers: 2 }, "RV2345");

    await act("host", "set_host_spectating", { spectating: true });
    expect(await act("host", "add_rule_bot")).toBe(true);
    expect(await act("host", "add_rule_bot")).toBe(true);
    expect(await act("host", "start_game")).toBe(true);

    let mostDiscs = 0;
    let finished = false;

    for (let tick = 0; tick < 16 && !finished; tick++) {
      await room.alarm();

      // A finished match with no connected client is archived and purged, so a
      // missing room is a terminal observation, not a failure.
      const probe = await room.fetch(new Request("https://room.test/state"));

      if (probe.status === 404) {
        finished = true;
        break;
      }

      const state = await view("host");

      mostDiscs = Math.max(mostDiscs, discCount(state.board));

      if (state.status === "ended") finished = true;
    }

    // A reversi board starts with four discs; more than that is a real move.
    expect(mostDiscs).toBeGreaterThan(4);
    expect(finished).toBe(true);
  });

  it("launches and rolls in an aeroplane room without a human", async () => {
    const { room, act, view } = await createRoom(AeroplaneRoom, { maxPlayers: 2 }, "AR2345");

    await act("host", "set_host_spectating", { spectating: true });
    expect(await act("host", "add_rule_bot")).toBe(true);
    expect(await act("host", "add_rule_bot")).toBe(true);
    expect(await act("host", "start_game")).toBe(true);

    await wake(room, 20);

    const state = await view("host");

    const launched = (state.planes ?? []).some((planes) =>
      planes.some((progress) => progress >= 0),
    );

    // At least one six was rolled and a bot chose to use it.
    expect(launched).toBe(true);
  });

  it("keeps the bot wake after another alarm is scheduled", async () => {
    let scheduled: number | null = null;

    const { room, act } = await createRoom(ReversiRoom, { maxPlayers: 2 }, "RV6789", (at) => {
      scheduled = at;
    });

    await act("host", "set_host_spectating", { spectating: true });
    expect(await act("host", "add_rule_bot")).toBe(true);
    expect(await act("host", "add_rule_bot")).toBe(true);
    expect(await act("host", "start_game")).toBe(true);

    // `alarm()` ends by recomputing the single alarm the room may hold. Before
    // the bot term existed in that computation, this wrote the turn timer over
    // the 150 ms wake and a bot-vs-bot match sat still until a human moved.
    await room.alarm();

    expect(scheduled).not.toBeNull();
    expect(scheduled! - Date.now()).toBeLessThanOrEqual(BOT_WAKE_MS * 3);
  });

  it("finishes a bot match on the wakes it schedules itself", async () => {
    let scheduled: number | null = null;

    const { room, act, view } = await createRoom(ReversiRoom, { maxPlayers: 2 }, "RV7788", (at) => {
      scheduled = at;
    });

    await act("host", "set_host_spectating", { spectating: true });
    expect(await act("host", "add_rule_bot")).toBe(true);
    expect(await act("host", "add_rule_bot")).toBe(true);
    expect(await act("host", "start_game")).toBe(true);

    let finished = false;

    for (let tick = 0; tick < 40; tick++) {
      // Only follow a wake the room scheduled for itself; a far deadline means
      // nothing is waiting on a bot any more.
      if (scheduled === null || scheduled - Date.now() > 1000) break;

      await room.alarm();

      const probe = await room.fetch(new Request("https://room.test/state"));

      if (probe.status === 404) {
        finished = true;
        break;
      }

      if ((await view("host")).status === "ended") {
        finished = true;
        break;
      }
    }

    expect(finished).toBe(true);
  });
});

/** Exposes the protected pause hook and the raw state for restart tests. */
class StallingReversiRoom extends ReversiRoom {
  snapshot() {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }

  /** Pause one seat exactly as a failing strategy would. */
  async pauseSeat(playerId: string) {
    const seat = this.gameState?.players.find((player) => player.id === playerId);

    if (!seat) throw new Error("No such seat");

    await this.pauseBot(seat, "test-stall");
  }
}

/** A started reversi room with two bots and the host spectating. */
async function startBotRoom(code: string) {
  const runtime = new MemoryRoomRuntime(new Map());

  runtime.storage.sql = new SqliteRoomSql();

  const room = new StallingReversiRoom(runtime, roomTestEnv(BOT_ENV));
  await runtime.initialized;

  const created = await room.fetch(
    new Request("https://room.test/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostId: "host", hostName: "Host", roomCode: code, maxPlayers: 2 }),
    }),
  );

  expect(created.ok).toBe(true);

  /** Actions answer 200 with `{ ok }`; the body is what has to be true. */
  const acted = async (
    playerId: string,
    actionType: string,
    data: Record<string, WireValue> = {},
  ) => {
    const response = await room.fetch(
      new Request("https://room.test/agent/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, actionType, data }),
      }),
    );

    return z.object({ ok: z.boolean() }).parse(wireValueSchema.parse(await response.json())).ok;
  };

  const view = async (subject: ReversiRoom = room) => {
    const response = await subject.fetch(
      new Request("https://room.test/agent/view?playerId=host"),
    );

    return z
      .object({ state: stateSchema })
      .parse(wireObjectSchema.parse(await response.json())).state;
  };

  expect(await acted("host", "set_host_spectating", { spectating: true })).toBe(true);
  expect(await acted("host", "add_rule_bot")).toBe(true);
  expect(await acted("host", "add_rule_bot")).toBe(true);
  expect(await acted("host", "start_game")).toBe(true);

  return { room, runtime, acted, view, bots: room.snapshot().players.filter((p) => p.bot) };
}

describe("a paused bot stays paused", () => {
  it("restores the paused seats after the room restarts", async () => {
    const { runtime, room, view, bots } = await startBotRoom("RV4455");

    expect(bots).toHaveLength(2);

    // Pause both: with either one live, the revived room would move and the
    // comparison below could not tell a lost pause from a missed turn.
    for (const bot of bots) await room.pauseSeat(bot.id);

    expect(runtime.storage.values.get("botPaused")).toEqual(bots.map((bot) => bot.id));

    // The same storage, woken in a fresh isolate: the pause has to survive.
    const revived = new ReversiRoom(runtime, roomTestEnv(BOT_ENV));
    await runtime.initialized;

    const before = await view(revived);

    await revived.alarm();

    expect(await view(revived)).toEqual(before);
  });

  it("offers the host a resume, and stops offering it after the budget", async () => {
    const { room, acted, view, bots } = await startBotRoom("RV5566");
    const bot = bots[0]!;

    expect((await view()).you?.legalActions).not.toContain("resume_rule_bot");

    await room.pauseSeat(bot.id);

    expect((await view()).you?.legalActions).toContain("resume_rule_bot");
    expect((await view()).pausedBots).toEqual([bot.id]);

    // Three attempts are allowed; the fourth has to be refused, because a
    // structural stall would otherwise retry for ever.
    for (let attempt = 1; attempt <= BOT_RESUME_LIMIT; attempt++) {
      expect(await acted("host", "resume_rule_bot", { playerId: bot.id }), `resume ${attempt}`).toBe(
        true,
      );

      expect((await view()).pausedBots ?? []).toEqual([]);

      await room.pauseSeat(bot.id);
    }

    expect(await acted("host", "resume_rule_bot", { playerId: bot.id })).toBe(false);
  });

  it("lets the resumed bot move again", async () => {
    const { room, acted, view, bots } = await startBotRoom("RV6677");

    // Both paused first, so a stable board proves nothing is moving at all.
    for (const bot of bots) await room.pauseSeat(bot.id);

    const stalled = await view();

    await room.alarm();

    expect(await view()).toEqual(stalled);

    for (const bot of bots) expect(await acted("host", "resume_rule_bot", { playerId: bot.id })).toBe(true);

    await room.alarm();

    expect(await view()).not.toEqual(stalled);
  });
});
