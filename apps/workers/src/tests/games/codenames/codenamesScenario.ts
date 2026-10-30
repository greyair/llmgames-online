import type { WireValue } from "@llmgames/game-catalog";
import { z } from "zod";

import type { CodenamesGameRoom } from "../../../durable-objects/CodenamesGameRoom";
import type { RoomRuntime } from "../../../durable-objects/runtime";
import type { Env } from "../../../types";
import {
  cardIndex,
  post,
  seatFor,
  step,
  transcriptRoom,
  type Transcript,
  type TranscriptRejection,
  type TranscriptRoom,
} from "./codenamesTranscript";

/**
 * The M3.6 scenario.
 *
 * Run twice: once against the pre-plugin room to freeze a golden transcript, then
 * against the migrated room. It covers the lobby role machinery, the clue and
 * guess phases, every way a turn can end, the two ways a match ends, the overall
 * clock, and what each of the four seats — and a watcher — can read at each step.
 */

export interface ScenarioHooks {
  Room: new (state: RoomRuntime, env: Env) => CodenamesGameRoom;
  runtime: () => RoomRuntime;
  env: Env;
}

const SEATS = ["p1", "p2", "p3", "p4"] as const;

/** Codename format is validated on join, so these must look like agent names. */
const CODENAMES = ["CalmAnvil", "BoldBarrel", "BraveArrow"] as const;

const ROLE_ORDER = [
  ["p1", "red", "spymaster"],
  ["p2", "blue", "spymaster"],
  ["p3", "red", "operative"],
  ["p4", "blue", "operative"],
] as const;

const errorBody = z
  .object({
    ok: z.boolean().optional(),
    error: z.object({ message: z.string(), code: z.string().optional() }).optional(),
    message: z.string().optional(),
  })
  .passthrough();

export async function buildTranscript(hooks: ScenarioHooks): Promise<Transcript> {
  const steps: Transcript["steps"] = [];
  const rejections: TranscriptRejection[] = [];
  const rooms: TranscriptRoom[] = [];

  const open = () => {
    const room = transcriptRoom(hooks.Room, hooks.runtime(), hooks.env);

    rooms.push(room);

    return room;
  };

  const act = async (
    room: TranscriptRoom,
    playerId: string,
    actionType: string,
    data: WireValue = {},
  ) => {
    const response = await post(room, "/agent/action", { playerId, actionType, data });

    if (!response.ok) throw new Error(`${actionType}: ${await response.text()}`);

    return response;
  };

  const reject = async (
    room: TranscriptRoom,
    label: string,
    playerId: string,
    actionType: string,
    data: WireValue = {},
  ) => {
    const response = await post(room, "/agent/action", { playerId, actionType, data });
    const body = errorBody.parse(await response.json());

    rejections.push({
      label,
      status: response.status,
      message: body.error?.message ?? body.message ?? null,
      code: body.error?.code ?? null,
    });
  };

  const joinSeats = async (room: TranscriptRoom) => {
    for (const [index, playerId] of SEATS.slice(1).entries())
      await post(room, "/agent/join", {
        playerId,
        assignedCodename: CODENAMES[index]!,
      });
  };

  /** Seat four players and give each an explicit role. */
  const seatFour = async (roomCode: string) => {
    const room = open();

    await post(room, "/create", {
      hostId: "p1",
      hostName: "Host",
      roomCode,
      maxPlayers: 8,
      turnTime: 60_000,
      gameTotalTime: 1_800_000,
    });

    await joinSeats(room);

    for (const [playerId, team, role] of ROLE_ORDER)
      await act(room, "p1", "assign_codenames_role", { playerId, team, role });

    return room;
  };

  // ─── Room A: a full turn cycle ─────────────────────────────────
  const main = open();

  await post(main, "/create", {
    hostId: "p1",
    hostName: "Host",
    roomCode: "CN2345",
    maxPlayers: 8,
    turnTime: 60_000,
    gameTotalTime: 1_800_000,
  });

  await joinSeats(main);

  steps.push(step(main, "lobby:joined", SEATS));

  for (const [playerId, team, role] of ROLE_ORDER)
    await act(main, "p1", "assign_codenames_role", { playerId, team, role });

  steps.push(step(main, "lobby:roles", SEATS));

  await act(main, "p1", "reset_codenames_roles");
  steps.push(step(main, "lobby:reset", SEATS));

  await act(main, "p1", "randomize_codenames_roles");
  steps.push(step(main, "lobby:randomized", SEATS));

  // Restore the known arrangement so the rest of the script can act by role.
  for (const [playerId, team, role] of ROLE_ORDER)
    await act(main, "p1", "assign_codenames_role", { playerId, team, role });

  steps.push(step(main, "lobby:explicit", SEATS));

  await post(main, "/agent/start", { playerId: "p1" });
  steps.push(step(main, "start:clue", SEATS));

  const state = () => main.snapshot();
  const redSpy = () => seatFor(state(), "red", "spymaster");
  const redOp = () => seatFor(state(), "red", "operative");
  const blueSpy = () => seatFor(state(), "blue", "spymaster");
  const blueOp = () => seatFor(state(), "blue", "operative");

  await reject(main, "clue:not-spymaster", redOp(), "give_clue", { word: "alpha", count: 1 });
  await reject(main, "clue:two-words", redSpy(), "give_clue", { word: "two words", count: 1 });
  await reject(main, "clue:bad-count", redSpy(), "give_clue", { word: "alpha", count: 25 });
  await reject(main, "clue:visible-word", redSpy(), "give_clue", {
    word: state().board[0]!.word,
    count: 1,
  });
  await reject(main, "guess:before-clue", redOp(), "guess_word", { index: 0 });
  await reject(main, "end-turn:no-guesses", redOp(), "end_turn");
  await reject(main, "lobby:roles-locked", redSpy(), "assign_codenames_role", {
    playerId: redSpy(),
    team: "red",
    role: "operative",
  });

  await act(main, redSpy(), "give_clue", { word: "alpha", count: 2 });
  steps.push(step(main, "clue:red", SEATS));

  await act(main, redOp(), "guess_word", { index: cardIndex(state(), "red") });
  steps.push(step(main, "guess:red-correct", SEATS));

  await reject(main, "guess:already-revealed", redOp(), "guess_word", {
    index: state().board.find((card) => card.revealed)!.index,
  });
  await reject(main, "guess:not-operative", redSpy(), "guess_word", {
    index: cardIndex(state(), "red", 1),
  });

  await act(main, redOp(), "guess_word", { index: cardIndex(state(), "neutral") });
  steps.push(step(main, "guess:neutral-passes", SEATS));

  await act(main, blueSpy(), "give_clue", { word: "beta", count: 1 });
  steps.push(step(main, "clue:blue", SEATS));

  await act(main, blueOp(), "guess", { index: cardIndex(state(), "blue") });
  steps.push(step(main, "guess:blue-correct", SEATS));

  await act(main, blueOp(), "guess_word", { index: cardIndex(state(), "red") });
  steps.push(step(main, "guess:wrong-team-passes", SEATS));

  await act(main, redSpy(), "give_clue", { word: "gamma", count: 3 });
  await act(main, redOp(), "guess_word", { index: cardIndex(state(), "red") });
  await act(main, redOp(), "end_turn");
  steps.push(step(main, "end-turn:stopped", SEATS));

  await main.expireTurn(state().turnState.currentPlayerId);
  steps.push(step(main, "timeout:turn", SEATS));

  // ─── Room B: every agent contacted ────────────────────────────
  const sweep = await seatFour("CN2346");

  await post(sweep, "/agent/start", { playerId: "p1" });

  const sweepState = () => sweep.snapshot();

  await act(sweep, seatFor(sweepState(), "red", "spymaster"), "give_clue", {
    word: "zeta",
    count: "unlimited",
  });

  for (let revealed = 0; revealed < 9; revealed++)
    await act(sweep, seatFor(sweepState(), "red", "operative"), "guess_word", {
      index: cardIndex(sweepState(), "red"),
    });

  steps.push(step(sweep, "end:all-agents", SEATS));

  // ─── Room C: the assassin ends it early ───────────────────────
  const trap = await seatFour("CN2347");

  await post(trap, "/agent/start", { playerId: "p1" });

  await act(trap, seatFor(trap.snapshot(), "red", "spymaster"), "give_clue", {
    word: "omega",
    count: 2,
  });
  await act(trap, seatFor(trap.snapshot(), "red", "operative"), "guess_word", {
    index: cardIndex(trap.snapshot(), "assassin"),
  });
  steps.push(step(trap, "end:assassin", SEATS));

  // ─── Room D: the overall clock ends an unfinished board ───────
  const clock = await seatFour("CN2348");

  await post(clock, "/agent/start", { playerId: "p1" });
  clock.expireMatch();
  steps.push(step(clock, "end:match-timeout", SEATS));

  // ─── Room E: a lobby that cannot start ────────────────────────
  const unfinished = open();

  await post(unfinished, "/create", {
    hostId: "p1",
    hostName: "Host",
    roomCode: "CN2349",
    maxPlayers: 8,
    turnTime: 60_000,
  });

  await joinSeats(unfinished);

  // Two red players, no blue operative: unbalanced and roleless.
  await act(unfinished, "p1", "assign_codenames_role", {
    playerId: "p1",
    team: "red",
    role: "spymaster",
  });
  await act(unfinished, "p1", "assign_codenames_role", {
    playerId: "p2",
    team: "red",
    role: "operative",
  });

  const refused = await unfinished.startAs("p1");
  const body = errorBody.parse(await refused.json());

  rejections.push({
    label: "start:roles-incomplete",
    status: refused.status,
    message: body.error?.message ?? body.message ?? null,
    code: body.error?.code ?? null,
  });

  return {
    steps,
    rejections,
    events: rooms.flatMap((room) => room.events),
    replay: trap.replayView(),
  };
}
