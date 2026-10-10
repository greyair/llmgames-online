import { z } from "zod";
import { testDatabase } from "../fixtures/auth";

import { describe, expect, it } from "vitest";
import {
  createMcpAgentSeat,
  deleteAllOwnedMcpAgentSeats,
  deleteOwnedMcpAgentSeat,
  deleteOwnedMcpAgentSeatByCodename,
  environmentLabelFromClientName,
  listManagedMcpAgentSeats,
  requireMcpAgentAvailable,
} from "../../auth/mcpAgentSeats";

function identitySeats(sqlite: ReturnType<typeof testDatabase>["sqlite"]) {
  return {
    get size() {
      return Number(sqlite.prepare("SELECT count(*) AS count FROM mcp_agent_seats").get()!.count);
    },
    keys() {
      return sqlite
        .prepare("SELECT id FROM mcp_agent_seats ORDER BY id")
        .all()
        .map((row) => z.string().parse(row.id))
        .values();
    },
    has(id: string) {
      return Boolean(sqlite.prepare("SELECT id FROM mcp_agent_seats WHERE id=?").get(id));
    },
  };
}

function fakeIdentityDb() {
  const { sqlite, db } = testDatabase();
  sqlite.exec("INSERT INTO users (id,email) VALUES ('owner-a','owner-a@example.test')");
  sqlite.exec(
    "INSERT INTO mcp_agent_seats (id,owner_user_id,codename,client_id,environment_label,created_at,last_used_at) VALUES ('agent-a','owner-a','SwiftAnchor','codex-client','Codex',1,2),('agent-b','owner-a','CalmSpinningHarbor','codex-client','Codex',1,2)",
  );
  sqlite.exec(
    "INSERT INTO mcp_room_players (room_id,agent_id,player_id) VALUES ('connect4-ABC234','agent-a','player-active')",
  );
  sqlite
    .prepare(
      "INSERT INTO active_rooms (room_code,game_type,room_id,status,expires_at,created_at) VALUES (?,?,?,?,?,?)",
    )
    .run("ABC234", "connect4", "connect4-ABC234", "active", Date.now() + 60_000, Date.now());

  return { db, sqlite, seats: identitySeats(sqlite) };
}

function fakeIdentityCapDb(unusedSeatIds: string[]) {
  const { sqlite, db } = testDatabase();
  sqlite.exec("INSERT INTO users (id,email) VALUES ('owner-a','owner-a@example.test')");
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < 32; i++) {
    const id = `agent-${i}`;
    sqlite
      .prepare(
        "INSERT INTO mcp_agent_seats (id,owner_user_id,codename,environment_label,created_at,last_used_at) VALUES (?,?,?,?,?,?)",
      )
      .run(id, "owner-a", `Agent${i}`, "MCP Agent", now - 600 - i, now - 600 - i);

    if (!unusedSeatIds.includes(id))
      sqlite
        .prepare("INSERT INTO mcp_room_players (room_id,agent_id,player_id) VALUES (?,?,?)")
        .run(`historic-${i}`, id, `player-${i}`);
  }

  return { db, seats: identitySeats(sqlite) };
}

describe("MCP environment labels", () => {
  it.each([
    ["OpenAI Codex", "Codex"],
    ["Claude Desktop", "Claude"],
    ["Cursor", "Cursor"],
    ["Grok MCP", "Grok"],
    ["ChatGPT", "ChatGPT"],
    ["Gemini CLI", "Gemini"],
  ])("maps %s to %s", (clientName, expected) => {
    expect(environmentLabelFromClientName(clientName)).toBe(expected);
  });

  it("uses a neutral label for unknown or missing clients", () => {
    expect(environmentLabelFromClientName("Custom Host")).toBe("MCP Agent");
    expect(environmentLabelFromClientName(null)).toBe("MCP Agent");
  });
});

describe("persistent MCP agent identity lifecycle", () => {
  it("lists every identity for web management without exposing room IDs", async () => {
    const { db } = fakeIdentityDb();

    await expect(listManagedMcpAgentSeats(db, "owner-a")).resolves.toEqual([
      expect.objectContaining({
        id: "agent-a",
        codename: "SwiftAnchor",
        hasRoomHistory: true,
        isActive: true,
      }),
      expect.objectContaining({
        id: "agent-b",
        codename: "CalmSpinningHarbor",
        hasRoomHistory: false,
        isActive: false,
      }),
    ]);
  });

  it("reclaims an old identity that never entered a room when the account is full", async () => {
    const { db, seats } = fakeIdentityCapDb(["agent-31"]);

    const created = await createMcpAgentSeat(db, "owner-a");

    expect(created.ownerUserId).toBe("owner-a");
    expect(seats.size).toBe(32);
    expect(seats.has("agent-31")).toBe(false);
    expect(seats.has(created.id)).toBe(true);
  });

  it("keeps the identity cap when every stored identity has entered a room", async () => {
    const { db, seats } = fakeIdentityCapDb([]);

    await expect(createMcpAgentSeat(db, "owner-a")).rejects.toMatchObject({
      code: "MCP_AGENT_IDENTITY_LIMIT",
    });
    expect(seats.size).toBe(32);
  });

  it("allows reconnecting to the same room but rejects another live room", async () => {
    const { db } = fakeIdentityDb();

    await expect(
      requireMcpAgentAvailable(db, "owner-a", "agent-a", "connect4-ABC234"),
    ).resolves.toBeUndefined();

    await expect(
      requireMcpAgentAvailable(db, "owner-a", "agent-a", "reversi-XYZ789"),
    ).rejects.toMatchObject({
      code: "MCP_AGENT_ALREADY_ACTIVE",
    });
  });

  it("refuses to delete a live identity", async () => {
    const { db, seats } = fakeIdentityDb();

    await expect(deleteOwnedMcpAgentSeat(db, "owner-a", "agent-a")).resolves.toMatchObject({
      deleted: false,
      reason: "active_room",
      roomId: "connect4-ABC234",
    });
    expect(seats.has("agent-a")).toBe(true);
  });

  it("deletes an owned identity after its room is no longer active", async () => {
    const { db, seats, sqlite } = fakeIdentityDb();
    sqlite.exec("DELETE FROM active_rooms");

    await expect(deleteOwnedMcpAgentSeat(db, "owner-a", "agent-a")).resolves.toMatchObject({
      deleted: true,
      seat: { codename: "SwiftAnchor" },
    });
    expect(seats.has("agent-a")).toBe(false);
  });

  it("deletes by public codename for the owner management UI", async () => {
    const { db, seats } = fakeIdentityDb();

    await expect(
      deleteOwnedMcpAgentSeatByCodename(db, "owner-a", "CalmSpinningHarbor"),
    ).resolves.toMatchObject({
      deleted: true,
      seat: { id: "agent-b" },
    });
    expect(seats.has("agent-b")).toBe(false);
  });

  it("deletes all non-live identities and preserves live identities", async () => {
    const { db, seats } = fakeIdentityDb();

    await expect(deleteAllOwnedMcpAgentSeats(db, "owner-a")).resolves.toEqual({
      deletedCount: 1,
      preservedActiveCount: 1,
    });
    expect([...seats.keys()]).toEqual(["agent-a"]);
  });

  it("never deletes an identity owned by another account", async () => {
    const { db, seats } = fakeIdentityDb();

    await expect(deleteOwnedMcpAgentSeat(db, "owner-b", "agent-b")).resolves.toEqual({
      deleted: false,
      reason: "not_found",
    });
    expect(seats.has("agent-b")).toBe(true);
  });
});
