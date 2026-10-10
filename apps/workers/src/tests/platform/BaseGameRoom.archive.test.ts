import { testEnv } from "../fixtures/env";
import { migratedDb } from "../fixtures/migrated-db";
import { MemoryR2Bucket } from "../fixtures/memory-r2";
import { SqliteRoomSql } from "../fixtures/sqlite-room";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import type { WireValue } from "@llmgames/game-catalog";

import { describe, expect, it, vi } from "vitest";

import { BaseGameRoom, FINAL_STATE_DELIVERY_GRACE_MS } from "../../durable-objects/BaseGameRoom";
import type { BaseGameState, Player } from "../../durable-objects/types";

class ArchiveRoom extends BaseGameRoom<BaseGameState & { winner: string | null }> {
  protected readonly roomLabel = "ArchiveRoom";
  snapshot() {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }

  protected createDefaultState(
    config: { hostId: string; hostName: string },
    roomCode: string,
  ): BaseGameState & { winner: string | null } {
    const now = Date.now();

    return {
      id: "archive-game-id",
      roomCode,
      type: "connect4",
      status: "waiting",
      players: [
        {
          id: config.hostId,
          name: config.hostName,
          isAgent: true,
          channel: "mcp",
          codename: config.hostName,
          environmentLabel: "Codex",
        },
      ],
      hostId: config.hostId,
      maxPlayers: 2,
      timerConfig: { gameTotalTime: 60_000, turnTime: 30_000 },
      gameTimeRemaining: 60_000,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: 30_000,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 60_000,
      winner: null,
    };
  }

  protected async handleGameAction(
    _player: Player,
    _payload: { actionType: string; data: WireValue },
  ): Promise<void> {}

  finish(): void {
    if (!this.gameState) throw new Error("missing state");
    this.gameState.status = "playing";
    this.gameState.turnState.phase = "play";
    this.gameState.turnState.turnNumber = 1;
    this.gameState.turnState.startedAt = Date.now();
    this.recordEvent("game_started");
    this.recordEvent("action", {
      actionType: "drop_disc",
      playerId: this.gameState.hostId,
    });
    this.gameState.winner = this.gameState.hostId;
    this.gameState.status = "ended";
    this.gameState.turnState.phase = "ended";
    this.recordEvent("game_ended", { reason: "connect4" });
    this.broadcastProjected("game_ended", { reason: "connect4" });
  }
}

function harness(failFirstUpload = false, failFirstDirectory = false) {
  const storage = new Map<string, unknown>();

  const sql = new SqliteRoomSql();

  const state = new MemoryRoomRuntime(storage, (at) => {
    alarmAt = at;
  });

  state.storage.sql = sql;
  let alarmAt: number | null = null;
  let initialized = Promise.resolve();

  const bucket = new MemoryR2Bucket();
  const uploads = vi.spyOn(bucket, "put");

  if (failFirstUpload) uploads.mockRejectedValueOnce(new Error("R2 unavailable"));
  const db = migratedDb();
  db.sqlite.prepare("INSERT INTO users(id,email) VALUES ('owner-user','owner@example.test')").run();
  db.sqlite
    .prepare(
      "INSERT INTO mcp_agent_seats(id,owner_user_id,codename,environment_label) VALUES ('agent-seat-id','owner-user','SwiftAnchor','Codex')",
    )
    .run();
  let directoryAttempts = 0;
  const originalPrepare = db.prepare.bind(db);
  vi.spyOn(db, "prepare").mockImplementation((query) => {
    if (query.includes("SET summary =")) {
      directoryAttempts++;

      if (failFirstDirectory && directoryAttempts === 1) throw new Error("D1 unavailable");
    }

    return originalPrepare(query);
  });
  const env = testEnv({ DB: db, GAME_LOGS: bucket });

  const newRoom = () => {
    const room = new ArchiveRoom(state, env);
    initialized = state.initialized;

    return { room, initialized };
  };

  const initial = newRoom();

  return {
    room: initial.room,
    initialized: initial.initialized,
    newRoom,
    storage,
    get eventRows() {
      return sql
        .exec<{ seq: number; at: number; type: string; summary_json: string | null }>(
          "SELECT * FROM game_events ORDER BY seq",
        )
        .toArray();
    },
    get rewatchRows() {
      return sql
        .exec<{ frame_index: number; at: number; label: string; state_json: string }>(
          "SELECT * FROM rewatch_frames ORDER BY frame_index",
        )
        .toArray();
    },
    get uploaded() {
      return [...bucket.objects.keys()];
    },
    getAlarm: () => alarmAt,
    getUploadAttempts: () => uploads.mock.calls.length,
  };
}

async function create(room: ArchiveRoom): Promise<void> {
  const response = await room.fetch(
    new Request("https://room.test/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hostId: "agent-seat-id",
        hostName: "SwiftAnchor",
        roomCode: "ABC234",
      }),
    }),
  );

  expect(response.status).toBe(200);
}

describe("completed game archive lifecycle", () => {
  it("keeps the ended outbox and retries when the broadcast directory fails", async () => {
    const test = harness(false, true);
    await test.initialized;
    await create(test.room);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      test.room.finish();
      await test.room.fetch(new Request("https://room.test/agent/view?playerId=agent-seat-id"));
      await vi.waitFor(() => expect(log).toHaveBeenCalled());
      expect(test.room.snapshot().status).toBe("ended");
      expect(test.getAlarm()).toBeGreaterThan(Date.now());
      expect(test.getUploadAttempts()).toBe(0);
      await test.room.alarm();
      await vi.waitFor(() => expect(test.storage.size).toBe(0));
      expect(test.getUploadAttempts()).toBe(1);
    } finally {
      log.mockRestore();
    }
  });

  it("uploads one object before purging the room outbox", async () => {
    const test = harness();
    await create(test.room);
    test.room.finish();

    const finalView = await test.room.fetch(
      new Request("https://room.test/agent/view?playerId=agent-seat-id"),
    );

    expect(await finalView.json()).toMatchObject({ state: { status: "ended" } });
    await vi.waitFor(() => expect(test.getUploadAttempts()).toBe(1));

    expect(test.uploaded).toEqual(["game-logs/v1/archive-game-id.json.gz"]);
    expect(test.eventRows.map((row) => row.type)).toEqual(["game_started", "action", "game_ended"]);
    expect(test.rewatchRows.map((row) => row.label)).toEqual(["game_started", "game_ended"]);
    expect(test.storage.has("eventBuffer")).toBe(false);
    expect(test.storage.size).toBe(0);
  });

  it("restores the ended outbox and retries a failed upload after restart", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const test = harness(true);
    await create(test.room);
    test.room.finish();

    const firstFinalView = await test.room.fetch(
      new Request("https://room.test/agent/view?playerId=agent-seat-id"),
    );

    expect(await firstFinalView.json()).toMatchObject({
      state: { status: "ended" },
    });
    await vi.waitFor(() => expect(test.getUploadAttempts()).toBe(1));

    expect(test.getUploadAttempts()).toBe(1);
    expect(test.storage.size).toBeGreaterThan(0);
    expect(test.room.snapshot().status).toBe("ended");
    expect(test.getAlarm()).not.toBeNull();

    const restarted = test.newRoom();
    await restarted.initialized;
    expect(test.getAlarm()).not.toBeNull();
    const restoredState = test.room.snapshot();

    const graceClock = vi
      .spyOn(Date, "now")
      .mockReturnValue(restoredState.updatedAt + FINAL_STATE_DELIVERY_GRACE_MS);

    try {
      await restarted.room.alarm();
    } finally {
      graceClock.mockRestore();
    }

    await vi.waitFor(() => expect(test.getUploadAttempts()).toBe(2));
    expect(test.uploaded).toEqual(["game-logs/v1/archive-game-id.json.gz"]);
    expect(test.storage.size).toBe(0);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("game-log archive failed"),
      expect.any(Error),
    );
    errorLog.mockRestore();
  });
});
