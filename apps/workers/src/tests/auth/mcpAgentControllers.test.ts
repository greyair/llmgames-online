import { testDatabase } from "../fixtures/auth";

import { describe, expect, it } from "vitest";
import {
  acquireMcpAgentController,
  acquireMcpAgentWaitLease,
  releaseMcpAgentWaitLease,
  resolveMcpAgentController,
} from "../../auth/mcpAgentControllers";

function fakeControllerDb() {
  const { sqlite, db } = testDatabase();
  sqlite.exec("INSERT INTO users (id,email) VALUES ('owner-a','owner-a@example.test')");
  sqlite.exec(
    "INSERT INTO mcp_agent_seats (id,owner_user_id,codename,client_id,environment_label,created_at,last_used_at) VALUES ('agent-a','owner-a','SwiftAnchor','codex-client','Codex',1,1),('agent-b','owner-a','CalmSpinningHarbor','codex-client','Codex',2,2)",
  );

  return { db, sqlite };
}

describe("server-assigned MCP agent controllers", () => {
  it("assigns different stored identities to concurrent task controllers", async () => {
    const { db } = fakeControllerDb();

    const first = await acquireMcpAgentController(db, "owner-a", "codex-client");
    const second = await acquireMcpAgentController(db, "owner-a", "codex-client");

    expect(first.controller.id).not.toBe(second.controller.id);
    expect(first.controller.seat.id).toBe("agent-a");
    expect(second.controller.seat.id).toBe("agent-b");
    expect(first.identityCreated).toBe(false);
    expect(second.identityCreated).toBe(false);
  });

  it("recycles an expired idle controller instead of creating another identity", async () => {
    const { db, sqlite } = fakeControllerDb();
    const first = await acquireMcpAgentController(db, "owner-a", "codex-client");
    sqlite
      .prepare("UPDATE mcp_agent_controllers SET expires_at=0 WHERE controller_id=?")
      .run(first.controller.id);

    const replacement = await acquireMcpAgentController(db, "owner-a", "codex-client");

    expect(replacement.controller.id).not.toBe(first.controller.id);
    expect(replacement.controller.seat.id).toBe("agent-a");
    expect(replacement.identityCreated).toBe(false);
  });

  it("renews an active controller and rejects an expired idle one", async () => {
    const { db, sqlite } = fakeControllerDb();
    const acquired = await acquireMcpAgentController(db, "owner-a", "codex-client");
    sqlite
      .prepare("UPDATE mcp_agent_controllers SET expires_at=0 WHERE controller_id=?")
      .run(acquired.controller.id);

    await expect(
      resolveMcpAgentController(db, "owner-a", acquired.controller.id),
    ).rejects.toMatchObject({ code: "MCP_AGENT_CONTROLLER_NOT_FOUND" });

    sqlite
      .prepare("INSERT INTO mcp_room_players (room_id,agent_id,player_id) VALUES (?,?,?)")
      .run("connect4-ABC234", acquired.controller.seat.id, "player-active");
    sqlite
      .prepare(
        "INSERT INTO active_rooms (room_code,game_type,room_id,status,expires_at,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run("ABC234", "connect4", "connect4-ABC234", "active", Date.now() + 60_000, Date.now());
    await expect(
      resolveMcpAgentController(db, "owner-a", acquired.controller.id),
    ).resolves.toMatchObject({
      id: acquired.controller.id,
      seat: { id: acquired.controller.seat.id },
    });
  });

  it("rejects a second concurrent wait that copied the same controller", async () => {
    const { db } = fakeControllerDb();
    const acquired = await acquireMcpAgentController(db, "owner-a", "codex-client");

    const waitToken = await acquireMcpAgentWaitLease(db, "owner-a", acquired.controller.id);

    await expect(
      acquireMcpAgentWaitLease(db, "owner-a", acquired.controller.id),
    ).rejects.toMatchObject({ code: "MCP_AGENT_CONTROLLER_IN_USE" });

    await releaseMcpAgentWaitLease(db, "owner-a", acquired.controller.id, waitToken);
    await expect(acquireMcpAgentWaitLease(db, "owner-a", acquired.controller.id)).resolves.toEqual(
      expect.any(String),
    );
  });
});
