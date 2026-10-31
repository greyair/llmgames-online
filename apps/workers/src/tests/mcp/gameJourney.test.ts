import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { gameLogDocumentSchema, wireObjectSchema, type WireObject } from "@llmgames/game-catalog";
import { z } from "zod";

import { describe, expect, it, vi } from "vitest";

import { createLlmgamesMcpServer } from "../../mcp/createServer";
import { Connect4Room } from "../../durable-objects/Connect4Room";
import { ReversiRoom } from "../../durable-objects/ReversiRoom";
import { CheckersRoom } from "../../durable-objects/CheckersRoom";
import { BattleshipRoom } from "../../durable-objects/BattleshipRoom";
import { CodenamesGameRoom } from "../../durable-objects/CodenamesGameRoom";
import { ContextoRoom } from "../../durable-objects/ContextoRoom";
import { PokerRoom } from "../../durable-objects/PokerRoom";
import { PokemonRoom } from "../../durable-objects/PokemonRoom";
import { contextoGuessFamily, contextoWord } from "../../lib/contextoRanks";
import { migratedDb } from "../fixtures/migrated-db";
import { MemoryR2Bucket } from "../fixtures/memory-r2";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { testEnv, testNamespace } from "../fixtures/env";
import type { Env } from "../../types";

/**
 * M3 acceptance: whole matches played through the **real MCP tool path**
 * (`agent_claim` → `room_create`/`room_join` → `start_game` → `send_action` →
 * `get_state`), then archived to R2 with a D1 index row and read back through
 * the shared archive contract.
 *
 * One case per migrated game, because the contract risk lives in the seams
 * between a plugin and the platform, and each game exercises different ones:
 * turn order (Connect4), automatic skips (Reversi), forced captures (Checkers),
 * private boards and placement (Battleship), roles and two-phase turns
 * (Codenames).
 *
 * Nothing is stubbed inside the Worker: the only local substitutes are the
 * in-process Durable Object namespace, D1 (real SQLite schema) and the R2
 * bucket, all of which implement the same interfaces the production bindings do.
 */

const toolContentSchema = z.array(z.object({ type: z.string(), text: z.string().optional() }));

const stateSchema = z
  .object({
    type: z.string(),
    status: z.string(),
    turnState: z
      .object({ currentPlayerId: z.string().nullable(), phase: z.string().optional() })
      .loose(),
    you: z
      .object({
        playerId: z.string(),
        legalActions: z.array(z.string()),
        yourRole: z.string().optional(),
      })
      .loose(),
    ownGrid: z.array(z.string()).optional(),
    targetGrid: z.array(z.string()).optional(),
    // Reversi uses `seats` as a seat map and Poker as a seat list, so each
    // journey parses the shape it needs.
    seats: z.unknown().optional(),
    actionPlayerId: z.string().nullish(),
    currentBet: z.number().optional(),
    toCall: z.number().optional(),
    handNumber: z.number().optional(),
    decision: z
      .object({
        forceSwitch: z.boolean().optional(),
        moves: z
          .array(z.object({ slot: z.number(), disabled: z.boolean().optional() }).loose())
          .optional(),
        switches: z.array(z.object({ slot: z.number() }).loose()).optional(),
      })
      .loose()
      .nullish(),
    progress: z
      .record(
        z.string(),
        // A rival's guesses are masked down to ranks, so only the word is optional.
        z.object({ guesses: z.array(z.object({ word: z.string().optional() }).loose()) }).loose(),
      )
      .optional(),
    legalMoves: z
      .array(
        z
          .object({
            row: z.number(),
            col: z.number(),
            fromRow: z.number().optional(),
            fromCol: z.number().optional(),
          })
          .loose(),
      )
      .optional(),
    board: z.unknown().optional(),
  })
  .loose();

type RoomState = z.output<typeof stateSchema>;

const actionResponseSchema = z.object({ ok: z.boolean().optional(), state: stateSchema });

const wordBoardSchema = z.array(
  z.object({ word: z.string(), revealed: z.boolean().optional() }).loose(),
);

type RoomClass = new (
  runtime: MemoryRoomRuntime,
  env: Env,
) => { fetch: (request: Request) => Promise<Response> };

interface Step {
  actionType: string;
  data: WireObject;
}

interface Journey {
  gameType:
    | "connect4"
    | "reversi"
    | "checkers"
    | "battleship"
    | "codenames"
    | "contexto"
    | "pokemon"
    | "poker";
  Room: RoomClass;
  binding:
    | "CONNECT4_ROOM"
    | "REVERSI_ROOM"
    | "CHECKERS_ROOM"
    | "BATTLESHIP_ROOM"
    | "CODENAMES_ROOM"
    | "CONTEXTO_ROOM"
    | "POKEMON_ROOM"
    | "POKER_ROOM";
  players: number;
  /** Actions the driver must get accepted before the match may stop short of an end. */
  minActions: number;
  /**
   * Poker only ends when a stack busts, which the driver cannot force inside a
   * test budget. Everything else must reach `ended` and archive.
   */
  mustEnd?: boolean;
  /** Accepted actions allowed before the driver gives up (default 160). */
  budget?: number;
  /** Lobby work that has to happen between the last join and the start. */
  prepare?: (send: Send, roomId: string, host: string) => Promise<void>;
  next: (state: RoomState, seatTurn: number, matchTurn: number) => Step | null;
  /** Fields that must never be readable by the opposing seat. */
  secret?: (state: RoomState) => string[];
  /** A rival's projection may only carry what the rules reveal about this seat. */
  assertRival?: (rival: RoomState) => void;
}

type Send = (controllerId: string, actionType: string, data: WireObject) => Promise<void>;

const BATTLESHIP_FLEET = [
  { id: "carrier", row: 2, col: 2, rotation: 90 },
  { id: "dreadnought", row: 0, col: 5, rotation: 0 },
  { id: "cruiser", row: 5, col: 9, rotation: 180 },
  { id: "submarine", row: 9, col: 4, rotation: 270 },
  { id: "destroyer", row: 6, col: 3, rotation: 90 },
];

/** Connect 4 plays a scripted line so the match ends in a known shape. */
const CONNECT4_COLUMNS = [0, 0, 1, 1, 2, 2, 3];

const journeys: Journey[] = [
  {
    gameType: "connect4",
    Room: Connect4Room,
    binding: "CONNECT4_ROOM",
    players: 2,
    minActions: CONNECT4_COLUMNS.length,
    next: (_state, _seatTurn, turn) => {
      const col = CONNECT4_COLUMNS[turn];

      return col === undefined ? null : { actionType: "drop_disc", data: { col } };
    },
  },
  {
    gameType: "reversi",
    Room: ReversiRoom,
    binding: "REVERSI_ROOM",
    players: 2,
    minActions: 40,
    // Every placement flips at least one disc, so taking the first legal move
    // always reaches a board neither side can play into.
    next: (state) => {
      const [move] = state.legalMoves ?? [];

      return move ? { actionType: "place_disc", data: { row: move.row, col: move.col } } : null;
    },
  },
  {
    gameType: "checkers",
    Room: CheckersRoom,
    binding: "CHECKERS_ROOM",
    players: 2,
    minActions: 12,
    next: (state) => {
      const moves = state.legalMoves ?? [];
      const move = moves.find((candidate) => candidate.fromRow !== undefined) ?? moves[0];

      if (!move || move.fromRow === undefined || move.fromCol === undefined) return null;

      return {
        actionType: "move_checker",
        data: { fromRow: move.fromRow, fromCol: move.fromCol, row: move.row, col: move.col },
      };
    },
  },
  {
    gameType: "battleship",
    Room: BattleshipRoom,
    binding: "BATTLESHIP_ROOM",
    players: 2,
    minActions: 10,
    // 22 hull cells per fleet at roughly one shot per turn, minus the hits that
    // grant a repeat shot, needs a longer run than the shared default.
    budget: 400,
    next: (state, turn) => {
      if (state.you.legalActions.includes("place_fleet"))
        return { actionType: "place_fleet", data: { ships: BATTLESHIP_FLEET } };

      if (!state.you.legalActions.includes("cannon")) return null;

      // Each seat's own counter walks its 100 cells once, so no repeat shots.
      return {
        actionType: "cannon",
        data: { row: Math.floor(turn / 10) % 10, col: turn % 10 },
      };
    },
    // A rival sees hits and misses on this seat's water, never the ships
    // themselves: the target grid only ever holds unknown, miss or hit.
    assertRival: (rival) => {
      for (const row of rival.targetGrid ?? []) expect(row).toMatch(/^[.ox]+$/);
    },
  },
  {
    gameType: "poker",
    Room: PokerRoom,
    binding: "POKER_ROOM",
    players: 2,
    // Hands are short but a match is several of them; the driver folds, checks
    // or calls and deals the next hand once the five-second window passes.
    // Shoving every legal chance busts a stack within a hand or two, which is
    // exactly the terminal state this journey needs to reach the archive.
    minActions: 2,
    budget: 300,
    next: (state) => {
      const mine = z
        .array(z.object({ playerId: z.string(), folded: z.boolean() }).loose())
        .safeParse(state.seats).data?.find((seat) => seat.playerId === state.you.playerId);

      if (!mine || mine.folded) return null;

      if (state.you.legalActions.includes("next_hand"))
        return { actionType: "next_hand", data: {} };

      // Shoving resolves a hand at once, so stacks move and the match can end.
      if (state.you.legalActions.includes("all_in")) return { actionType: "all_in", data: {} };

      if (!state.you.legalActions.includes("check") && !state.you.legalActions.includes("call"))
        return state.you.legalActions.includes("fold")
          ? { actionType: "fold", data: {} }
          : null;

      return (state.toCall ?? 0) === 0
        ? { actionType: "check", data: {} }
        : { actionType: "call", data: {} };
    },
  },
  {
    gameType: "pokemon",
    Room: PokemonRoom,
    binding: "POKEMON_ROOM",
    players: 2,
    // A Gen 1 random battle takes dozens of turns, and each turn is two
    // sealed choices, so this is the one journey that needs a long budget.
    minActions: 4,
    budget: 400,
    next: (state) => {
      const mine = state.decision;

      if (!mine) return null;

      const switchSlot = mine.switches?.[0]?.slot;

      if (mine.forceSwitch && switchSlot !== undefined)
        return { actionType: "pokemon_switch", data: { slot: switchSlot } };

      const move = mine.moves?.find((candidate) => !candidate.disabled);

      if (move) return { actionType: "pokemon_move", data: { slot: move.slot } };

      return switchSlot === undefined
        ? null
        : { actionType: "pokemon_switch", data: { slot: switchSlot } };
    },
    // The opponent's team, exact HP and pending choice stay hidden.
    assertRival: (rival) => {
      expect(JSON.stringify(rival)).not.toContain("battleSnapshot");
    },
  },
  {
    gameType: "contexto",
    Room: ContextoRoom,
    binding: "CONTEXTO_ROOM",
    players: 2,
    minActions: 8,
    budget: 220,
    // Everyone guesses on their own clock, so the driver walks the shipped
    // vocabulary and skips any word this seat already tried. Fifty accepted
    // words per seat exhaust the table and end the match on best rank.
    next: (state, seatTurn) => {
      if (!state.you.legalActions.includes("guess_word")) return null;

      const guessed = new Set(
        (state.progress?.[state.you.playerId]?.guesses ?? [])
          .flatMap((guess) => (guess.word ? [contextoGuessFamily(guess.word)] : [])),
      );

      for (let step = 0; step < 400; step += 1) {
        const word = contextoWord((seatTurn + step) % 5000);

        if (!word) break;

        if (!guessed.has(contextoGuessFamily(word)))
          return { actionType: "guess_word", data: { word } };
      }

      return null;
    },
  },
  {
    gameType: "codenames",
    Room: CodenamesGameRoom,
    binding: "CODENAMES_ROOM",
    players: 4,
    // A first guess can be the assassin, so the match may end after one action.
    minActions: 1,
    prepare: async (send, roomId, host) => {
      await send(host, "randomize_codenames_roles", {});
    },
    next: (state, turn) => {
      const { legalActions } = state.you;

      if (!legalActions.includes("give_clue") && !legalActions.includes("guess_word")) return null;

      if (state.turnState.phase === "clue") {
        // A clue is a single word and may not repeat a visible codename, so
        // prefix one of them instead of inventing a word that might collide.
        const visible = wordBoardSchema.safeParse(state.board).data?.[0]?.word ?? "word";

        return { actionType: "give_clue", data: { word: `zq${visible}`, count: 9 } };
      }

      const board = wordBoardSchema.safeParse(state.board).data ?? [];
      const index = board.findIndex((card) => !card.revealed);

      return index === -1 ? null : { actionType: "guess_word", data: { index } };
    },
    // An operative must never be able to read the assassin's location.
    secret: (state) => (state.you.yourRole === "operative" ? ["assassin"] : []),
  },
];

function roomHarness(binding: Journey["binding"], Room: RoomClass) {
  const db = migratedDb();

  db.sqlite
    .prepare(
      "INSERT INTO users(id,email,gamertag,gamertag_selected) VALUES ('owner','owner@example.test','Owner',1)",
    )
    .run();

  const bucket = new MemoryR2Bucket();
  const rooms = new Map<string, { fetch: (request: Request) => Promise<Response> }>();

  const namespace = testNamespace(async (name, request) => {
    const existing = rooms.get(name);

    if (existing) return existing.fetch(request);

    const runtime = new MemoryRoomRuntime(new Map());
    const room = new Room(runtime, env);

    rooms.set(name, room);
    await runtime.initialized;

    return room.fetch(request);
  });

  const env: Env = testEnv({ DB: db, GAME_LOGS: bucket, [binding]: namespace });

  return { db, bucket, rooms, env };
}

async function connect(env: Env) {
  const server = createLlmgamesMcpServer({
    env,
    user: {
      id: "owner",
      email: "owner@example.test",
      name: "Owner",
      gamertag: "Owner",
      created_at: 0,
      updated_at: 0,
    },
    clientId: null,
    origin: "https://www.llmgames.online",
  });

  const client = new Client({ name: "journey", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const call = async (name: string, args: WireObject = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = toolContentSchema.parse(result.content)[0]?.text;
    const body = wireObjectSchema.parse(text ? JSON.parse(text) : {});

    return { isError: Boolean(result.isError), body };
  };

  return { client, call };
}

describe("MCP match journey", () => {
  for (const journey of journeys) {
    it(`plays ${journey.gameType} over MCP without leaking private state`, async () => {
      const harness = roomHarness(journey.binding, journey.Room);
      const { client, call } = await connect(harness.env);

      try {
        const controllers: string[] = [];

        for (let seat = 0; seat < journey.players; seat += 1) {
          const claim = await call("agent_claim");

          expect(claim.isError).toBe(false);
          controllers.push(z.string().parse(claim.body.controllerId));
        }

        const hostController = controllers[0];

        if (!hostController) throw new Error("agent_claim did not return a controller");

        const created = await call("room_create", {
          controllerId: hostController,
          gameType: journey.gameType,
          turnTime: 30_000,
        });

        expect(created.isError).toBe(false);

        const roomId = z.string().parse(created.body.roomId);
        const roomCode = z.string().parse(created.body.roomCode);

        expect(roomId).toBe(`${journey.gameType}-${roomCode}`);

        for (const controllerId of controllers.slice(1)) {
          const joined = await call("room_join", { controllerId, roomCode });

          expect(joined.isError).toBe(false);
        }

        const send: Send = async (controllerId, actionType, data) => {
          const result = await call("send_action", { controllerId, roomId, actionType, data });

          expect(result.isError, `${actionType} rejected: ${JSON.stringify(result.body)}`).toBe(
            false,
          );
        };

        if (journey.prepare) await journey.prepare(send, roomId, hostController);

        const started = await call("start_game", { controllerId: hostController, roomId });

        expect(started.isError).toBe(false);

        const stateOf = async (controllerId: string) =>
          actionResponseSchema.parse((await call("get_state", { controllerId, roomId })).body).state;

        // Seat order is random, so map every controller to the seat it plays.
        const controllersBySeat = new Map<string, string>();

        for (const controllerId of controllers) {
          const state = await stateOf(controllerId);

          controllersBySeat.set(state.you.playerId, controllerId);
        }

        expect(controllersBySeat.size).toBe(journey.players);

        const budget = journey.budget ?? 160;
        const perSeat = new Map<string, number>();
        let state = await stateOf(hostController);
        let accepted = 0;

        let idles = 0;

        for (let turn = 0; turn < budget && state.status === "playing"; turn += 1) {
          const current = state.turnState.currentPlayerId;
          const owned = current ? controllersBySeat.get(current) : undefined;

          // A named turn owner must be a seat some controller is playing.
          if (current) expect(controllersBySeat.has(current)).toBe(true);

          // Placement, simultaneous clues and other role-scoped decisions have
          // no single turn owner, so ask each seat what it is allowed to send.
          let actor = owned;

          if (!actor)
            for (const candidate of controllers) {
              const own = await stateOf(candidate);

              if (journey.next(own, perSeat.get(candidate) ?? 0, turn)) {
                actor = candidate;
                break;
              }
            }

          if (!actor) {
            // The server may hold decisions for a moment (Poker's result
            // window); wait it out instead of calling the journey finished.
            if (idles++ > 40) break;

            await new Promise((done) => setTimeout(done, 200));
            state = await stateOf(hostController);
            turn -= 1;

            continue;
          }

          const own = await stateOf(actor);
          const step = journey.next(own, perSeat.get(actor) ?? 0, turn);

          if (!step) {
            // A seat may be "on turn" while the server still withholds its
            // actions; wait rather than ending the journey early.
            if (idles++ > 40) break;

            await new Promise((done) => setTimeout(done, 200));
            turn -= 1;

            continue;
          }

          await send(actor, step.actionType, step.data);
          accepted += 1;
          perSeat.set(actor, (perSeat.get(actor) ?? 0) + 1);
          state = await stateOf(actor);
        }

        expect(accepted).toBeGreaterThanOrEqual(journey.minActions);

        if (journey.mustEnd !== false) expect(state.status).toBe("ended");

        // Private material never reaches another seat's projection.
        for (const controllerId of controllers) {
          const own = await stateOf(controllerId);

          expect(own.you.playerId).toBe(
            [...controllersBySeat.entries()].find(([, value]) => value === controllerId)?.[0],
          );
          expect(JSON.stringify(own)).not.toContain(controllerId);

          const rival = controllers.find((other) => other !== controllerId);

          if (rival) journey.assertRival?.(await stateOf(rival));

          for (const secret of journey.secret?.(own) ?? []) {
            const rivalState = await stateOf(
              controllers.find((candidate) => candidate !== controllerId)!,
            );

            expect(JSON.stringify(rivalState)).not.toContain(secret);
          }
        }

        if (journey.mustEnd === false) {
          // A hand certainly finished even if no stack busted yet.
          expect(harness.bucket.objects.size).toBeLessThanOrEqual(1);

          return;
        }

        for (const controllerId of controllers)
          await call("get_state", { controllerId, roomId });

        await vi.waitFor(() => expect(harness.bucket.objects.size).toBe(1), { timeout: 5_000 });

        const [key] = [...harness.bucket.objects.keys()];
        const stored = await harness.bucket.get(key!);

        expect(stored).not.toBeNull();

        const raw = await new Response(
          new Blob([await stored!.arrayBuffer()]).stream().pipeThrough(
            new DecompressionStream("gzip"),
          ),
        ).text();

        const document = gameLogDocumentSchema.parse(JSON.parse(raw));

        expect(document.gameType).toBe(journey.gameType);
        expect(document.version).toBe(1);
        expect(document.participants.every((participant) => participant.isAgent)).toBe(true);
        expect(document.participants).toHaveLength(journey.players);
        // A lobby action can be archived before the start (Codenames role
        // assignment), so only presence is guaranteed, not position.
        const eventTypes = document.events.map((event) => event.type);

        expect(eventTypes).toContain("game_started");
        expect(eventTypes).toContain("game_ended");

        const frames = z.array(wireObjectSchema).parse(document.rewatch.frames);

        expect(frames.length).toBeGreaterThan(1);
        expect(JSON.stringify(frames.at(-1))).toContain('"status":"ended"');

        for (const controllerId of controllers) expect(raw).not.toContain(controllerId);

        const index = harness.db.sqlite
          .prepare("SELECT game_type, end_reason, r2_key FROM game_logs")
          .all();

        expect(index).toEqual([
          {
            game_type: journey.gameType,
            end_reason: document.endReason,
            r2_key: key,
          },
        ]);
      } finally {
        await client.close();
      }
      // Battleship needs a few hundred round trips; the default 5s is tight
      // once the whole suite shares two workers.
    }, 30_000);
  }
});
