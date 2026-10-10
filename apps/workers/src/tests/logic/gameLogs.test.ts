import { MemoryR2Bucket } from "../fixtures/memory-r2";
import { migratedDb } from "../fixtures/migrated-db";
import { RecordingSQLiteD1 } from "../fixtures/recording-db";
import { z } from "zod";

import { describe, expect, it } from "vitest";
import type { RewatchPayload } from "../../types";
import type { BaseGameState } from "../../durable-objects/types";
import { buildCompletedGameArchive, persistCompletedGameArchive } from "../../lib/gameLogs";

function fixture() {
  const state: BaseGameState & { winner: string } = {
    id: "game-123",
    roomCode: "ABC234",
    type: "connect4",
    status: "ended",
    players: [
      {
        id: "agent-secret-id",
        name: "SwiftAnchor",
        isAgent: true,
        channel: "mcp",
        codename: "SwiftAnchor",
        ownerGamertag: "owner",
        environmentLabel: "Codex",
      },
      { id: "human-secret-id", name: "Opponent", channel: "browser" },
    ],
    hostId: "agent-secret-id",
    maxPlayers: 2,
    timerConfig: { gameTotalTime: 60_000, turnTime: 30_000 },
    gameTimeRemaining: 50_000,
    turnState: {
      currentPlayerId: null,
      turnNumber: 3,
      phase: "ended",
      startedAt: 1_000,
      turnTimeRemaining: 0,
    },
    createdAt: 500,
    updatedAt: 4_000,
    expiresAt: 60_500,
    winner: "agent-secret-id",
  };

  const events = [
    { seq: 1, at: 1_000, type: "game_started" },
    {
      seq: 2,
      at: 2_000,
      type: "action",
      summary: {
        playerId: "agent-secret-id",
        seats: { "agent-secret-id": 1, "human-secret-id": 2 },
      },
    },
    {
      seq: 3,
      at: 4_000,
      type: "game_ended",
      summary: { reason: "connect4", winner: "agent-secret-id" },
    },
  ];

  const rewatch: RewatchPayload = {
    version: 1,
    visibility: "full_reveal",
    gameType: "connect4",
    truncated: false,
    frames: [
      {
        index: 0,
        at: 4_000,
        label: "game_ended",
        state: { players: [{ id: "agent-secret-id" }, { id: "human-secret-id" }] },
      },
    ],
  };

  return buildCompletedGameArchive(state, events, rewatch, "connect4");
}

describe("completed game archive", () => {
  it("creates one sanitized document with neutral participant references", () => {
    const archive = fixture();
    expect(archive.document).toMatchObject({
      version: 1,
      gameId: "game-123",
      winner: "p1",
      startedAt: 1_000,
      endedAt: 4_000,
      endReason: "connect4",
    });
    expect(archive.document.participants.map((participant) => participant.ref)).toEqual([
      "p1",
      "p2",
    ]);
    const serialized = JSON.stringify(archive.document);
    expect(serialized).not.toContain("agent-secret-id");
    expect(serialized).not.toContain("human-secret-id");
    expect(serialized).toContain('"playerId":"p1"');
    expect(serialized).toContain('"p1":1');
  });

  it("uploads one gzip R2 object and batches only its D1 index", async () => {
    const archive = fixture();
    const bucket = new MemoryR2Bucket();
    const migrated = migratedDb();
    const db = new RecordingSQLiteD1(migrated.sqlite);
    db.sqlite
      .prepare("INSERT INTO users(id,email) VALUES (?,?)")
      .run("owner-user-id", "owner@example.test");
    db.sqlite
      .prepare("INSERT INTO users(id,email) VALUES (?,?)")
      .run("human-secret-id", "human@example.test");
    db.sqlite
      .prepare(
        "INSERT INTO mcp_agent_seats(id,owner_user_id,codename,environment_label) VALUES (?,?,?,?)",
      )
      .run("agent-secret-id", "owner-user-id", "SwiftAnchor", "Codex");

    await persistCompletedGameArchive({ DB: db, GAME_LOGS: bucket }, archive);

    const uploadedKey = "game-logs/v1/game-123.json.gz";
    const object = await bucket.get(uploadedKey);
    expect(object).not.toBeNull();
    expect(object!.httpMetadata?.contentEncoding).toBe("gzip");
    expect(db.batches).toHaveLength(1);
    expect(db.batches[0]).toHaveLength(4);
    const uploadedBody = await object!.arrayBuffer();

    const decompressed = z
      .object({ gameId: z.string() })
      .passthrough()
      .parse(
        await new Response(
          new Blob([uploadedBody!]).stream().pipeThrough(new DecompressionStream("gzip")),
        ).json(),
      );

    expect(decompressed.gameId).toBe("game-123");
  });
});
