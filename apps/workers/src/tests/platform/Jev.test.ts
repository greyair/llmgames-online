import { migratedDb } from "../fixtures/migrated-db";
import { MemoryR2Bucket } from "../fixtures/memory-r2";
import { testEnv } from "../fixtures/env";
import { wireObjectSchema } from "@llmgames/game-catalog";
import { parseJevView } from "../../agents/jev";
import type { WireObject } from "@llmgames/game-catalog";

import { z } from "zod";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import type { BaseGameRoom } from "../../durable-objects/BaseGameRoom";
import type { BaseGameState } from "../../durable-objects/types";
import type { RoomRuntime } from "../../durable-objects/runtime";

import { afterEach, describe, expect, it, vi } from "vitest";
import { Battle, Teams, toID } from "@pkmn/sim";
import * as pokemonEngine from "../../games/pokemon/engine";
import { Connect4Room } from "../../durable-objects/Connect4Room";
import { PokemonRoom } from "../../durable-objects/PokemonRoom";
import { ReversiRoom } from "../../durable-objects/ReversiRoom";
import { BattleshipRoom } from "../../durable-objects/BattleshipRoom";
import { ContextoRoom } from "../../durable-objects/ContextoRoom";
import { PokerRoom } from "../../durable-objects/PokerRoom";
import { BATTLESHIP_FALLBACK_FLEET, type BattleshipGameState } from "../../durable-objects/types";
import type { Env } from "../../types";
import { chooseJev, jevDecision } from "../../agents/jev";
import { encryptJevKey } from "../../agents/jevCredentials";

type RoomConstructor = new (state: RoomRuntime, env: Env) => BaseGameRoom<BaseGameState>;

function harness(Room: RoomConstructor = Connect4Room) {
  const storage = new Map<string, unknown>();
  let alarmAt = 0;

  const state = new MemoryRoomRuntime(storage, (at) => {
    alarmAt = at ?? 0;
  });

  const db = migratedDb();
  db.sqlite.prepare("INSERT INTO users (id,email) VALUES ('host','host@example.test')").run();
  const env = testEnv({ TYPESAFE_API_KEY: "test-key", DB: db, GAME_LOGS: new MemoryR2Bucket() });

  const room = new Room(state, env);

  return {
    room,
    state,
    env,
    storage,
    alarm: () => alarmAt,
    noBudget: () => {
      env.JEV_DAILY_CALL_LIMIT = "0";
      db.sqlite.exec("UPDATE jev_personal_usage SET calls = 100000");
    },
    noTrial: () => {
      db.sqlite.prepare("INSERT OR IGNORE INTO jev_trial_games(owner_id) VALUES (?)").run("host");
    },
    personal: async () => {
      env.JEV_CREDENTIAL_KEYS = JSON.stringify({ v1: btoa("b".repeat(32)) });
      const encrypted = await encryptJevKey(env, "host", "personal-id", "personal-test-key");
      db.sqlite
        .prepare(
          "INSERT OR REPLACE INTO jev_credentials(owner_id,id,ciphertext,nonce,key_version,verified_at,daily_limit) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          "host",
          "personal-id",
          encrypted.ciphertext,
          encrypted.nonce,
          encrypted.key_version,
          Date.now(),
          10000,
        );
    },
    revoke: () => {
      db.sqlite.exec("DELETE FROM jev_credentials");
    },
  };
}

type Room = ReturnType<typeof harness>["room"];

async function post<T>(room: Room, path: string, body: T) {
  return room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function action<T>(
  room: Room,
  playerId: string,
  actionType: string,
  data: T | WireObject = {},
) {
  return post(room, "/agent/action", { playerId, actionType, data });
}

async function create(room: Room) {
  await post(room, "/create", {
    hostId: "host",
    hostName: "Human",
    roomCode: "JEV234",
    turnTime: 30000,
  });
}

async function view(room: Room, playerId = "host") {
  const response = await room.fetch(
    new Request(`https://room.test/agent/view?playerId=${playerId}`),
  );

  return (
    await response.json<{
      state: {
        players: { id: string; name: string }[];
        turnState: { currentPlayerId: string; turnNumber: number };
        board: number[][];
        legalMoves: { row: number; col: number; flipCount: number }[];
        decision: { moves: { slot: number; disabled: boolean }[] } | null;
        status: string;
      };
    }>()
  ).state;
}

function stubChoices() {
  return vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));

      return Response.json({
        answers: Object.fromEntries(
          Object.entries(body.questions).map(([id, q]) => [
            id,
            {
              type: "choice",
              choice: Object.keys(
                z.object({ criteria: wireObjectSchema }).passthrough().parse(q).criteria,
              )[0],
            },
          ]),
        ),
      });
    }),
  );
}

async function ready(h = harness()) {
  await create(h.room);
  expect((await action(h.room, "host", "add_jev")).status).toBe(200);
  const bot = (await view(h.room)).players.find((p) => p.name === "Jev")!.id;
  expect((await post(h.room, "/agent/start", { playerId: "host" })).status).toBe(200);

  return { ...h, bot };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("hosted Jev seats", () => {
  it("uses the personal key without the site key and never persists plaintext", async () => {
    stubChoices();
    const setup = harness();
    await setup.personal();
    delete setup.env.TYPESAFE_API_KEY;
    const h = await ready(setup);

    if ((await view(h.room)).turnState.currentPlayerId === "host")
      await action(h.room, "host", "drop_disc", { col: 6 });
    await h.room.alarm();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]![1]!.headers).toMatchObject({
      Authorization: "Bearer personal-test-key",
    });
    expect(vi.mocked(fetch).mock.calls[0]![1]!.redirect).toBe("manual");
    expect(JSON.stringify([...h.storage])).not.toContain("personal-test-key");
    expect(JSON.stringify(await view(h.room))).not.toContain("personal-id");
  });
  it("adopts a personal key connected after Jev joins but before the match starts", async () => {
    stubChoices();
    const h = harness();
    await create(h.room);
    expect((await action(h.room, "host", "add_jev")).status).toBe(200);
    h.noTrial();
    await h.personal();
    expect((await post(h.room, "/agent/start", { playerId: "host" })).status).toBe(200);
    const state = await view(h.room);

    if (state.turnState.currentPlayerId === "host")
      await action(h.room, "host", "drop_disc", { col: 6 });
    await h.room.alarm();
    expect(vi.mocked(fetch).mock.calls[0]![1]!.headers).toMatchObject({
      Authorization: "Bearer personal-test-key",
    });
  });
  it("does not fall back to the site key after personal credential revocation", async () => {
    stubChoices();
    const setup = harness();
    await setup.personal();
    const h = await ready(setup);
    h.revoke();

    if ((await view(h.room)).turnState.currentPlayerId === "host")
      await action(h.room, "host", "drop_disc", { col: 6 });
    await h.room.alarm();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows one seat, only the host, supported games, available capacity, and lobby removal", async () => {
    const h = harness();
    await create(h.room);

    const results = await Promise.all([
      action(h.room, "host", "add_jev"),
      action(h.room, "host", "add_jev"),
    ]);

    expect(results.map((r) => r.status).filter((code) => code === 200)).toHaveLength(1);
    const bot = (await view(h.room)).players.find((p) => p.name === "Jev")!.id;
    expect((await action(h.room, bot, "remove_jev")).status).not.toBe(200);
    expect((await action(h.room, "host", "remove_jev")).status).toBe(200);
    expect((await view(h.room)).players).toHaveLength(1);
    await post(h.room, "/agent/join", { playerId: "other", assignedCodename: "SwiftAnchor" });
    expect((await action(h.room, "host", "add_jev")).status).not.toBe(200);
    const disabled = harness();
    delete disabled.env.TYPESAFE_API_KEY;
    await create(disabled.room);
    expect((await action(disabled.room, "host", "add_jev")).status).not.toBe(200);
  });

  it("requires a personal TypeSafe connection after the sponsored game is used", async () => {
    const setup = harness();
    setup.noTrial();
    await create(setup.room);
    const response = await action(setup.room, "host", "add_jev");
    expect(response.status).not.toBe(200);
    expect(await response.text()).toContain("free Jev game has been used");
  });

  it("makes exactly one legal Connect 4 move for a decision", async () => {
    stubChoices();
    const h = await ready();

    if ((await view(h.room)).turnState.currentPlayerId === "host")
      await action(h.room, "host", "drop_disc", { col: 6 });
    const before = await view(h.room);
    await h.room.alarm();
    await h.room.alarm();
    const after = await view(h.room);
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
    expect(request.questions.move.instructions).toContain("You are playing Connect 4");
    expect(request.questions.move.instructions).toContain(
      "Your discs use the digit equal to `yourSeat`",
    );
    expect(request.questions.move.instructions).toContain(
      "the game ends before the opponent can respond",
    );
    expect(request.questions.move.instructions).toContain(
      "Never prefer building your own line over a required block",
    );
    expect(request.questions.move.instructions).toContain(
      "Prevent this opponent fork before building your own attack",
    );
    expect(Object.keys(request.questions.move.criteria)).toEqual([
      "column_0",
      "column_1",
      "column_2",
      "column_3",
      "column_4",
      "column_5",
      "column_6",
    ]);
    expect(request.questions.move.criteria.column_0).toEqual({
      dropColumn: 0,
      resultingBoard: expect.any(Array),
    });
    expect(after.turnState.currentPlayerId).toBe("host");
    expect(after.board.flat().filter(Boolean)).toHaveLength(
      before.board.flat().filter(Boolean).length + 1,
    );
    expect((await action(h.room, "host", "remove_jev")).status).not.toBe(200);
  });

  it("chooses a legal Reversi placement and flips server-owned discs", async () => {
    stubChoices();
    const h = await ready(harness(ReversiRoom));

    if ((await view(h.room)).turnState.currentPlayerId === "host") {
      const legal = (await view(h.room)).legalMoves[0]!;
      expect((await action(h.room, "host", "place_disc", legal)).status).toBe(200);
    }

    const before = await view(h.room, h.bot);
    await h.room.alarm();
    const after = await view(h.room, h.bot);
    expect(fetch).toHaveBeenCalledOnce();
    expect(after.board.flat().filter(Boolean)).toHaveLength(
      before.board.flat().filter(Boolean).length + 1,
    );
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
    expect(Object.keys(body.questions.move.criteria)).toEqual(
      before.legalMoves.map((m) => `place_${m.row}_${m.col}`),
    );
    expect(h.storage.get("jevSeat")).toMatchObject({ status: "ready" });
  });

  it("places a private fleet once, restores it, and continues after cannon hits", async () => {
    stubChoices();
    const h = await ready(harness(BattleshipRoom));
    await h.room.alarm();
    await h.room.alarm();
    expect(fetch).toHaveBeenCalledOnce();
    const placed = (await h.state.storage.get<BattleshipGameState>("gameState"))!;
    const own = placed.boards.find((b) => b.playerId === h.bot)!;
    expect(own.ready).toBe(true);
    expect(own.cells.flat().filter(Boolean)).toHaveLength(22);
    // Put the human fleet in known row pairs. Jev must not receive its cells.
    const fleet = BATTLESHIP_FALLBACK_FLEET.map((placement) => ({ ...placement }));
    expect((await action(h.room, "host", "place_fleet", { ships: fleet })).status).toBe(200);
    const battle = (await h.state.storage.get<BattleshipGameState>("gameState"))!;

    if (battle.turnState.currentPlayerId === "host") {
      const opponent = battle.boards.find((b) => b.playerId === h.bot)!;
      const row = opponent.cells.findIndex((r) => r.includes(null));
      const col = opponent.cells[row]!.indexOf(null);
      expect((await action(h.room, "host", "cannon", { row, col })).status).toBe(200);
    }

    const restored = new BattleshipRoom(h.state, h.env);
    await vi.waitFor(async () => expect((await view(restored)).status).toBe("playing"));
    await restored.alarm();
    await restored.alarm();
    expect(fetch).toHaveBeenCalledTimes(3);

    const requests = vi
      .mocked(fetch)
      .mock.calls.slice(1)
      .map((call) => JSON.parse(String(call[1]!.body)));

    const ownGrid: string[][] = own.cells.map((row) => row.map((cell) => (cell ? "s" : ".")));

    for (const shot of (await h.state.storage.get<BattleshipGameState>("gameState"))!.shots)
      if (shot.byPlayerId !== h.bot) ownGrid[shot.row]![shot.col] = shot.hit ? "x" : "o";
    expect(requests[0].state.ownGrid).toEqual(ownGrid.map((row) => row.join("")));
    expect(requests[0].state.turnTimeRemaining).toBeGreaterThan(0);
    expect(requests[0].state.gameTimeRemaining).toBeGreaterThan(0);
    expect(requests[0].state.targetGrid).toEqual(Array(10).fill(".........."));
    expect(requests[1].state.targetGrid[0]).toBe("x.........");
    expect(requests[1].questions.target_cannon.criteria).not.toHaveProperty("cannon_0_0");
    expect(JSON.stringify(requests)).not.toContain('"boards"');
    expect(h.storage.get("jevSeat")).toMatchObject({ status: "ready" });
  });

  it.each(["bomb", "radar", "mine", "torpedo"] as const)(
    "submits a valid Battleship %s and preserves radar observations",
    async (weapon) => {
      stubChoices();
      const h = await ready(harness(BattleshipRoom));
      await h.room.alarm();
      const fleet = BATTLESHIP_FALLBACK_FLEET.map((placement) => ({ ...placement }));
      await action(h.room, "host", "place_fleet", { ships: fleet });
      const saved = (await h.state.storage.get<BattleshipGameState>("gameState"))!;
      saved.turnState.currentPlayerId = h.bot;
      saved.boards.find((b) => b.playerId === h.bot)!.munitionPoints = 10;
      h.storage.set("gameState", saved);
      const restored = new BattleshipRoom(h.state, h.env);
      await vi.waitFor(async () => expect((await view(restored)).status).toBe("playing"));
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          const body = JSON.parse(String(init.body));
          expect(body.questions.move.criteria).toHaveProperty(weapon);
          const choice = Object.keys(body.questions[`target_${weapon}`].criteria)[0];

          return Response.json({
            answers: {
              move: { type: "choice", choice: weapon },
              [`target_${weapon}`]: { type: "choice", choice },
            },
          });
        }),
      );
      await restored.alarm();
      expect(fetch).toHaveBeenCalledOnce();
      expect(h.storage.get("jevSeat")).toMatchObject({ status: "ready" });
      expect((await view(restored)).turnState.currentPlayerId).toBe(h.bot);

      if (weapon === "radar") {
        // A human miss replaces the announcement; the next model input still has Jev's scan.
        const human = saved.boards.find((b) => b.playerId === "host")!;
        const humanRow = human.cells.findIndex((r) => r.includes(null));
        await action(restored, h.bot, "cannon", {
          row: humanRow,
          col: human.cells[humanRow]!.indexOf(null),
        });
        const own = saved.boards.find((b) => b.playerId === h.bot)!;
        const ownRow = own.cells.findIndex((r) => r.includes(null));
        await action(restored, "host", "cannon", {
          row: ownRow,
          col: own.cells[ownRow]!.indexOf(null),
        });
        await restored.alarm();
        const body = JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]!.body));
        expect(body.state.radarScans).toEqual([{ row: 0, col: 0, shipCells: 3 }]);
      }
    },
  );

  it("sends only Pokémon's private projection, seals once, and acts again after resolution", async () => {
    // A random opening can KO only the human, leaving Jev correctly waiting
    // for a forced replacement. Use harmless teams to exercise two sealed turns.
    vi.spyOn(pokemonEngine, "createBattle").mockImplementation(() => {
      const battle = new Battle({ formatid: toID(pokemonEngine.FORMAT), seed: "gen5,1,2,3,4" });

      for (const id of ["p1", "p2"] as const) {
        battle.setPlayer(id, {
          name: id,
          team: Teams.import(
            ["Magikarp", "Gyarados", "Snorlax", "Chansey", "Ditto", "Pikachu"]
              .map((species) => `${species}\n- Splash`)
              .join("\n\n"),
          )!,
        });
      }

      return battle;
    });
    stubChoices();
    const h = await ready(harness(PokemonRoom));
    await h.room.alarm();
    await h.room.alarm();
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
    expect(JSON.stringify(request)).not.toContain("battleSnapshot");
    expect(JSON.stringify(request)).not.toContain("ownerId");
    expect(
      request.state.sides
        .find((s: { seat: string }) => s.seat !== request.state.yourSeat)
        .pokemon.filter((p: { hidden?: boolean }) => p.hidden),
    ).toHaveLength(5);
    expect((await view(h.room, h.bot)).decision).toBeNull();
    const human = await view(h.room);
    expect(
      (
        await action(h.room, "host", "pokemon_move", {
          slot: human.decision!.moves.find((m) => !m.disabled)!.slot,
        })
      ).status,
    ).toBe(200);
    await h.room.alarm();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("plays one legal Poker action from the private seat projection", async () => {
    stubChoices();
    const h = await ready(harness(PokerRoom));

    const initial = z
      .object({
        actionPlayerId: z.string(),
        seats: z.array(z.object({ playerId: z.string() }).passthrough()),
      })
      .passthrough()
      .parse(h.storage.get("gameState"));

    if (initial.actionPlayerId === "host") {
      expect((await action(h.room, "host", "call")).status).toBe(200);
    }

    await h.room.alarm();
    expect(fetch).toHaveBeenCalledOnce();
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
    const self = request.state.seats.find((seat: { isYou?: boolean }) => seat.isYou);
    const opponent = request.state.seats.find((seat: { isYou?: boolean }) => !seat.isYou);
    expect(self.hole).toHaveLength(2);
    expect(opponent.hole).toBeUndefined();
    expect(request.questions.move.criteria).toHaveProperty("fold");
    expect(h.storage.get("jevSeat")).toMatchObject({ status: "ready" });
  });

  it("accepts a Battleship reply when only the supplied clocks have ticked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    stubChoices();
    const h = await ready(harness(BattleshipRoom));
    await h.room.alarm();
    await action(h.room, "host", "place_fleet", { ships: BATTLESHIP_FALLBACK_FLEET });
    const state = (await h.state.storage.get<BattleshipGameState>("gameState"))!;

    if (state.turnState.currentPlayerId === "host") {
      const own = state.boards.find((board) => board.playerId === h.bot)!;
      const row = own.cells.findIndex((line) => line.includes(null));
      await action(h.room, "host", "cannon", { row, col: own.cells[row]!.indexOf(null) });
    }

    const previousShots = (await h.state.storage.get<BattleshipGameState>("gameState"))!.shots
      .length;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        expect(body.state.turnTimeRemaining).toBeGreaterThan(0);
        const target = Object.keys(body.questions.target_cannon.criteria)[0];
        vi.setSystemTime(Date.now() + 2000);

        return Response.json({
          answers: {
            move: { type: "choice", choice: "cannon" },
            target_cannon: { type: "choice", choice: target },
          },
        });
      }),
    );
    await h.room.alarm();
    expect(fetch).toHaveBeenCalledOnce();
    expect((await h.state.storage.get<BattleshipGameState>("gameState"))!.shots).toHaveLength(
      previousShots + 1,
    );
    expect(h.storage.get("jevSeat")).toMatchObject({ status: "ready" });
  });

  it("discards an API reply if the room ends while it is pending", async () => {
    let reply!: (r: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            reply = resolve;
          }),
      ),
    );
    const h = await ready(harness(PokemonRoom));
    const pending = h.room.alarm();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await action(h.room, "host", "end_game");
    reply(Response.json({ answers: { move: { type: "choice", choice: "pokemon_move_1" } } }));
    await pending;
    expect(fetch).toHaveBeenCalledOnce();
    const ended = (await h.state.storage.get<{ status: string } | undefined>("gameState"))!;
    expect(!ended || ended.status === "ended").toBe(true);
  });

  it("fails closed on quota and API errors without inventing a move", async () => {
    stubChoices();
    const h = await ready(harness(PokemonRoom));
    h.noBudget();
    await h.room.alarm();
    await h.room.alarm();
    expect(fetch).not.toHaveBeenCalled();
    expect(h.storage.get("jevSeat")).toMatchObject({ status: "limit_reached" });
    expect((await view(h.room, h.bot)).decision).not.toBeNull();
    const errorRoom = await ready(harness(PokemonRoom));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("private provider error", { status: 401 })),
    );
    await errorRoom.room.alarm();
    await errorRoom.room.alarm();
    expect(fetch).toHaveBeenCalledOnce();
    expect(errorRoom.storage.get("jevSeat")).toMatchObject({ status: "unavailable" });
  });

  it.each([301, 302, 303, 307, 308])(
    "rejects a provider redirect (%i) without retrying or playing a move",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(null, { status, headers: { Location: "https://other.test/systemone" } }),
        ),
      );
      const h = await ready(harness(PokemonRoom));
      await h.room.alarm();
      await h.room.alarm();
      expect(fetch).toHaveBeenCalledOnce();
      expect(vi.mocked(fetch).mock.calls[0]![1]!.redirect).toBe("manual");
      expect(h.storage.get("jevSeat")).toMatchObject({ status: "unavailable" });
      expect((await view(h.room, h.bot)).decision).not.toBeNull();
    },
  );

  it("retries a transient failure once and restores a pending seat after a restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 429 })),
    );
    const h = await ready(harness(PokemonRoom));
    await h.room.alarm();
    expect(h.storage.get("jevSeat")).toMatchObject({ attempts: 1, status: "retrying" });
    const restored = new PokemonRoom(h.state, h.env);
    // Drain the asynchronous storage restoration before advancing the alarm.
    await vi.advanceTimersByTimeAsync(2500);
    await restored.alarm();
    await restored.alarm();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(h.storage.get("jevSeat")).toMatchObject({ attempts: 2, status: "unavailable" });
  });

  it("never promotes Jev to host when the human leaves", async () => {
    const h = harness();
    await create(h.room);
    await action(h.room, "host", "add_jev");
    await action(h.room, "host", "leave");
    const saved = (await h.state.storage.get<{ status: string } | undefined>("gameState"))!;
    expect(!saved || saved.status === "ended").toBe(true);
  });
});

describe("Jev option validation", () => {
  it("describes every Connect 4 choice only by its column and resulting board", () => {
    const winning = jevDecision(
      parseJevView({
        gameType: "connect4",
        status: "playing",
        legalActions: ["drop_disc"],
        board: ["0000000", "0000000", "0000000", "0000000", "0000000", "1110000"],
        boardFormat: "rows top-to-bottom; 0 empty, 1 seat 1, 2 seat 2",
        yourSeat: 1,
        legalColumns: [0, 1, 2, 3, 4, 5, 6],
        turnNumber: 7,
      }),
    )!;

    expect(Object.keys(winning.options)).toEqual([
      "column_0",
      "column_1",
      "column_2",
      "column_3",
      "column_4",
      "column_5",
      "column_6",
    ]);

    for (const [id, option] of Object.entries(winning.options)) {
      expect(option.description).toEqual({
        dropColumn: Number(id.slice("column_".length)),
        resultingBoard: expect.any(Array),
      });
    }

    expect(winning.options.column_3!.description).toEqual({
      dropColumn: 3,
      resultingBoard: ["0000000", "0000000", "0000000", "0000000", "0000000", "1111000"],
    });
  });

  it("omits disabled Pokémon moves and accepts only exact supplied options", async () => {
    const decision = jevDecision(
      parseJevView({
        gameType: "pokemon",
        status: "playing",
        legalActions: ["pokemon_move", "pokemon_switch"],
        decision: {
          moves: [
            { slot: 1, name: "Disabled", disabled: true },
            { slot: 2, name: "Surf" },
          ],
          switches: [{ slot: 4, name: "Pikachu" }],
        },
      }),
    )!;

    expect(Object.keys(decision.options)).toEqual(["pokemon_move_2", "pokemon_switch_4"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ answers: { move: { type: "choice", choice: "pokemon_move_1" } } }),
      ),
    );
    await expect(chooseJev(testEnv({ TYPESAFE_API_KEY: "test" }), decision)).rejects.toThrow(
      "unavailable",
    );
  });

  it("offers legal 10-chip Poker totals and bounds deep-stack choices", () => {
    const base = {
      gameType: "poker",
      status: "playing",
      phase: "preflop",
      handNumber: 1,
      legalActions: ["fold", "call", "raise", "all_in"],
      pot: 15,
      currentBet: 10,
      minRaise: 10,
      toCall: 5,
      blinds: { sb: 5, bb: 10 },
      seats: [
        {
          playerId: "jev",
          isYou: true,
          stack: 995,
          streetBet: 5,
          hole: [
            { rank: "A", suit: "S" },
            { rank: "K", suit: "S" },
          ],
        },
        { playerId: "human", stack: 990, streetBet: 10 },
      ],
    };

    const decision = jevDecision(parseJevView(base))!;
    expect(decision.options).toHaveProperty("raise_to_20");
    expect(decision.options).toHaveProperty("raise_to_990");
    expect(decision.options).not.toHaveProperty("raise_to_1000");
    expect(
      Object.values(decision.options)
        .filter((option) => option.action.actionType === "raise")
        .every(
          (option) => "raiseTo" in option.action.data && option.action.data.raiseTo % 10 === 0,
        ),
    ).toBe(true);
    expect(decision.options.all_in).toEqual(
      expect.objectContaining({ action: { actionType: "all_in", data: {} } }),
    );

    const deep = jevDecision(
      parseJevView({
        ...base,
        seats: [{ ...base.seats[0], stack: 5_995 }, base.seats[1]],
      }),
    )!;

    expect(Object.keys(deep.options).length).toBeLessThanOrEqual(255);
    expect(deep.options).toHaveProperty("raise_to_20");
    expect(deep.options).toHaveProperty("raise_to_5990");
  });
});

it("plays concurrent semantic guesses, bills all stages and stops at budget exhaustion", async () => {
  stubChoices();
  const h = await ready(harness(ContextoRoom));
  await h.room.alarm();

  const stored = z
    .object({
      progress: z.record(
        z.string(),
        z.object({ guesses: z.array(z.object({ word: z.string() }).passthrough()) }).passthrough(),
      ),
    })
    .passthrough()
    .parse(h.storage.get("gameState"));

  expect(stored.progress[h.bot]!.guesses).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(
    z.object({ calls: z.number() }).passthrough().parse(h.storage.get("jevSeat")).calls,
  );
  expect(fetch).toHaveBeenCalledTimes(4);
  h.noBudget();
  await h.room.alarm();
  expect(
    z.object({ status: z.string() }).passthrough().parse(h.storage.get("jevSeat")).status,
  ).toBe("limit_reached");
  expect(fetch).toHaveBeenCalledTimes(4);
});
