import { roomTestEnv } from "../fixtures/room-env";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";

import { describe, expect, it, vi } from "vitest";
import { Connect4Room } from "../../durable-objects/Connect4Room";
import type { Env } from "../../types";

class IdempotencyRoom extends Connect4Room {
  protected restoreSessions(): void {}
  protected startingPlayerIndex(): number {
    return 0;
  }
}

function harness(env: Env = roomTestEnv()) {
  const storage = new Map<string, unknown>();
  // Clone like real Durable Object storage, so a write failure leaves storage
  // holding the previous snapshot instead of a mutated in-memory object.
  const state = new MemoryRoomRuntime(storage, () => undefined, [], true);
  const newRoom = () => new IdempotencyRoom(state, env);

  return { room: newRoom(), recreate: newRoom, state };
}

/** Fail only the receipt write, as a crash between the two writes would. */
function failReceiptWrites(state: MemoryRoomRuntime): () => void {
  state.storage.failWriteContaining = "ackedActionRecords";

  return () => {
    state.storage.failWriteContaining = null;
  };
}

function post<T>(room: IdempotencyRoom, route: string, body: T): Promise<Response> {
  return room.fetch(
    new Request(`https://room.test${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

type Board = number[][];

async function board(room: IdempotencyRoom): Promise<Board | undefined> {
  const view = await room.fetch(new Request("https://room.test/agent/view?playerId=host"));
  const payload = await view.json<{ state?: { board?: Board } }>();

  return payload.state?.board;
}

async function seatTwoPlayers(room: IdempotencyRoom): Promise<void> {
  expect(
    (await post(room, "/create", { hostId: "host", hostName: "Host", roomCode: "ABC234" })).status,
  ).toBe(200);

  const joined = await post(room, "/agent/join", {
    playerId: "guest",
    assignedCodename: "SwiftAnchor",
  });

  expect(joined.status).toBe(200);
  expect((await post(room, "/agent/start", { playerId: "host" })).status).toBe(200);
}

const emptyBoard = () => Array.from({ length: 6 }, () => Array(7).fill(0));

function withDisc(col: number, player: number) {
  const board = emptyBoard();

  board[5]![col] = player;

  return board;
}

describe("durable action idempotency", () => {
  it("recognises a retried request after the Durable Object restarts", async () => {
    const test = harness();
    await test.state.initialized;
    await seatTwoPlayers(test.room);

    const first = await post(test.room, "/agent/action", {
      playerId: "host",
      actionType: "drop_disc",
      data: { col: 0 },
      requestId: "move-once",
    });

    expect(first.status).toBe(200);

    const expected = emptyBoard();

    expected[5]![0] = 1;
    expect(await board(test.room)).toEqual(expected);

    // A fresh instance keeps only what the room persisted.
    const restarted = test.recreate();
    await test.state.initialized;

    const retried = await post(restarted, "/agent/action", {
      playerId: "host",
      actionType: "drop_disc",
      data: { col: 0 },
      requestId: "move-once",
    });

    const payload = await retried.json<{ ok?: boolean; replayed?: boolean }>();

    expect(retried.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, replayed: true });
    expect(await board(restarted)).toEqual(expected);
  });

  it("refuses to replay a different intent behind the same request id", async () => {
    const test = harness();
    await test.state.initialized;
    await seatTwoPlayers(test.room);

    await post(test.room, "/agent/action", {
      playerId: "host",
      actionType: "drop_disc",
      data: { col: 0 },
      requestId: "reused-id",
    });

    const conflicting = await post(test.room, "/agent/action", {
      playerId: "host",
      actionType: "drop_disc",
      data: { col: 3 },
      requestId: "reused-id",
    });

    const payload = await conflicting.json<{ error?: { code?: string } }>();

    expect(conflicting.status).toBe(409);
    expect(payload.error?.code).toBe("IDEMPOTENCY_CONFLICT");

    const expected = emptyBoard();

    expected[5]![0] = 1;
    expect(await board(test.room)).toEqual(expected);
  });

  it("treats key order as the same intent", async () => {
    const test = harness();
    await test.state.initialized;
    await seatTwoPlayers(test.room);

    await post(test.room, "/agent/action", {
      playerId: "host",
      actionType: "drop_disc",
      data: { col: 0, note: "a" },
      requestId: "ordered",
    });

    const retried = await post(test.room, "/agent/action", {
      playerId: "host",
      actionType: "drop_disc",
      data: { note: "a", col: 0 },
      requestId: "ordered",
    });

    const payload = await retried.json<{ replayed?: boolean }>();

    expect(retried.status).toBe(200);
    expect(payload.replayed).toBe(true);
  });

  it("rejects the action when state and receipt cannot be written together", async () => {
    const test = harness();
    await test.state.initialized;
    await seatTwoPlayers(test.room);

    const restoreWrites = failReceiptWrites(test.state);

    const first = await post(test.room, "/agent/action", {
      playerId: "host",
      actionType: "drop_disc",
      data: { col: 0 },
      requestId: "atomic",
    });

    restoreWrites();

    // One write carries both, so a failed write applies nothing at all.
    expect(first.status).toBe(500);
    expect(await board(test.room)).toEqual(emptyBoard());

    const restarted = test.recreate();
    await test.state.initialized;

    expect(await board(restarted)).toEqual(emptyBoard());

    // The retry now applies exactly once and keeps its receipt.
    const retried = await post(restarted, "/agent/action", {
      playerId: "host",
      actionType: "drop_disc",
      data: { col: 0 },
      requestId: "atomic",
    });

    expect(retried.status).toBe(200);
    expect(await board(restarted)).toEqual(withDisc(0, 1));

    const again = await post(restarted, "/agent/action", {
      playerId: "host",
      actionType: "drop_disc",
      data: { col: 0 },
      requestId: "atomic",
    });

    expect(await again.json<{ replayed?: boolean }>()).toMatchObject({ replayed: true });
    expect(await board(restarted)).toEqual(withDisc(0, 1));
  });


  it("replays a failed start as a failure, not an empty success", async () => {
    const test = harness();
    await test.state.initialized;

    // Only the host is seated, so the start must be refused.
    await post(test.room, "/create", { hostId: "host", hostName: "Host", roomCode: "ABC234" });

    const first = await post(test.room, "/agent/start", { playerId: "host", requestId: "start-once" });

    expect(first.status).toBe(409);

    const retried = await post(test.room, "/agent/start", {
      playerId: "host",
      requestId: "start-once",
    });

    const payload = await retried.json<{ ok?: boolean; replayed?: boolean; error?: { message?: string } }>();

    expect(retried.status).toBe(409);
    expect(payload.ok).toBe(false);
    expect(payload.replayed).toBe(true);
    expect(payload.error?.message).toEqual(expect.stringContaining("at least"));
  });
});
