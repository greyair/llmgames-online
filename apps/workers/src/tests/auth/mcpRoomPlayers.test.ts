import { testDatabase } from "../fixtures/auth";

import { describe, expect, it } from "vitest";
import {
  claimMcpRoomPlayer,
  ensureMcpRoomPlayer,
  getMcpRoomPlayer,
  releaseMcpRoomPlayer,
} from "../../auth/mcpRoomPlayers";

function fakeDb(seats: Record<string, string>) {
  const { sqlite, db } = testDatabase();

  for (const owner of new Set(Object.values(seats)))
    sqlite.prepare("INSERT INTO users (id,email) VALUES (?,?)").run(owner, `${owner}@example.test`);

  for (const [id, owner] of Object.entries(seats))
    sqlite
      .prepare("INSERT INTO mcp_agent_seats (id,owner_user_id,codename) VALUES (?,?,?)")
      .run(id, owner, "SwiftAnchor");

  return { db };
}

describe("MCP room-scoped public player identities", () => {
  it("never reuses the private agent credential as the public player ID", async () => {
    const { db } = fakeDb({ "agent-private-a": "owner-a" });

    const first = await ensureMcpRoomPlayer(db, "owner-a", "agent-private-a", "connect4-ABC234");

    const repeated = await ensureMcpRoomPlayer(db, "owner-a", "agent-private-a", "connect4-ABC234");

    expect(first.playerId).toMatch(/^player_[0-9a-f-]{36}$/);
    expect(first.playerId).not.toContain("agent-private-a");
    expect(repeated.playerId).toBe(first.playerId);
  });

  it("uses a different public identity in every room", async () => {
    const { db } = fakeDb({ "agent-private-a": "owner-a" });

    const first = await ensureMcpRoomPlayer(db, "owner-a", "agent-private-a", "connect4-ABC234");

    const second = await ensureMcpRoomPlayer(db, "owner-a", "agent-private-a", "reversi-XYZ789");

    expect(second.playerId).not.toBe(first.playerId);
  });

  it("lets only the first caller claim an agent identity in a room", async () => {
    const { db } = fakeDb({ "agent-private-a": "owner-a" });

    const [first, second] = await Promise.all([
      claimMcpRoomPlayer(db, "owner-a", "agent-private-a", "connect4-ABC234"),
      claimMcpRoomPlayer(db, "owner-a", "agent-private-a", "connect4-ABC234"),
    ]);

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(second.player.playerId).toBe(first.player.playerId);
  });

  it("requires the authenticated OAuth owner when resolving a mapping", async () => {
    const { db } = fakeDb({ "agent-private-a": "owner-a" });
    await ensureMcpRoomPlayer(db, "owner-a", "agent-private-a", "connect4-ABC234");

    await expect(
      getMcpRoomPlayer(db, "owner-b", "agent-private-a", "connect4-ABC234"),
    ).resolves.toBeNull();
  });

  it("removes abandoned mappings for failed room creation", async () => {
    const { db } = fakeDb({ "agent-private-a": "owner-a" });
    await ensureMcpRoomPlayer(db, "owner-a", "agent-private-a", "connect4-ABC234");
    await releaseMcpRoomPlayer(db, "agent-private-a", "connect4-ABC234");

    await expect(
      getMcpRoomPlayer(db, "owner-a", "agent-private-a", "connect4-ABC234"),
    ).resolves.toBeNull();
  });
});
