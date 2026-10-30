import { wireObjectSchema } from "@llmgames/game-catalog";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CodenamesGameRoom } from "../../../durable-objects/CodenamesGameRoom";
import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";
import { roomTestEnv } from "../../fixtures/room-env";
import { post, transcriptRoom, withSeededRandom } from "./codenamesTranscript";

/**
 * Codenames is a privacy rule as much as a game: the key decides the whole
 * match. These checks cover the two places a role can change hands — the lobby
 * and a move to the spectator list — and the MCP view, which must mask the board
 * exactly like the browser does.
 */

const SEATS = ["p1", "p2", "p3", "p4"] as const;

const CODENAMES = ["CalmAnvil", "BoldBarrel", "BraveArrow"] as const;

const ROLES = [
  ["p1", "red", "spymaster"],
  ["p2", "blue", "spymaster"],
  ["p3", "red", "operative"],
  ["p4", "blue", "operative"],
] as const;

async function lobby() {
  const room = transcriptRoom(CodenamesGameRoom, new MemoryRoomRuntime(new Map()), roomTestEnv());

  await post(room, "/create", {
    hostId: "p1",
    hostName: "Host",
    roomCode: "CN3345",
    maxPlayers: 8,
    turnTime: 60_000,
  });

  for (const [index, playerId] of SEATS.slice(1).entries())
    await post(room, "/agent/join", { playerId, assignedCodename: CODENAMES[index]! });

  for (const [playerId, team, role] of ROLES)
    await post(room, "/agent/action", {
      playerId: "p1",
      actionType: "assign_codenames_role",
      data: { playerId, team, role },
    });

  return room;
}

const cards = z.array(wireObjectSchema);

function boardOf(room: ReturnType<typeof transcriptRoom>, playerId: string) {
  return cards.parse(room.viewFor(playerId).board);
}

function affiliations(room: ReturnType<typeof transcriptRoom>, playerId: string) {
  return boardOf(room, playerId).map((card) => card.affiliation ?? null);
}

describe("Codenames roles", () => {
  it("tells each seat its own team and whether it may read the key", async () => {
    await withSeededRandom(async () => {
      const room = await lobby();

      const expected = {
        p1: { team: "red", role: "spymaster", canSeeKey: true },
        p2: { team: "blue", role: "spymaster", canSeeKey: true },
        p3: { team: "red", role: "operative", canSeeKey: false },
        p4: { team: "blue", role: "operative", canSeeKey: false },
      } as const;

      for (const playerId of SEATS) {
        const you = wireObjectSchema.parse(room.viewFor(playerId).you);

        expect(you.team).toBe(expected[playerId].team);
        expect(you.role).toBe(expected[playerId].role);
        expect(you.canSeeKey).toBe(expected[playerId].canSeeKey);

        // Only the host may rearrange the whole table.
        const legal = z.array(z.string()).parse(you.legalActions);

        expect(legal).toContain("assign_codenames_role");
        expect(legal.includes("randomize_codenames_roles")).toBe(playerId === "p1");
      }
    });
  });

  it("masks the key for operatives in both the browser and the MCP view", async () => {
    await withSeededRandom(async () => {
      const room = await lobby();

      await post(room, "/agent/start", { playerId: "p1" });

      for (const playerId of ["p1", "p2"]) {
        expect(affiliations(room, playerId).filter((value) => value !== null)).toHaveLength(25);

        const agentBoard = cards.parse(room.agentViewFor(playerId).board);

        expect(agentBoard).toHaveLength(25);
        expect(agentBoard.filter((card) => card.affiliation !== null)).toHaveLength(25);
      }

      for (const playerId of ["p3", "p4"]) {
        // Nothing but revealed cards may carry an affiliation for an operative.
        expect(affiliations(room, playerId).filter((value) => value !== null)).toHaveLength(0);

        const agentCards = cards.parse(room.agentViewFor(playerId).board);

        expect(agentCards).toHaveLength(25);
        expect(agentCards.filter((card) => card.affiliation !== null)).toHaveLength(0);

        expect(wireObjectSchema.parse(room.viewFor(playerId).you).canSeeKey).toBe(false);
      }
    });
  });

  it("drops a role when its holder moves to the spectator list", async () => {
    await withSeededRandom(async () => {
      const room = await lobby();

      expect(room.snapshot().assignments).toHaveProperty("p3");

      // Seats can only change in the lobby, which is exactly when a stale role
      // would otherwise be saved and could later claim the key.
      const moved = await post(room, "/agent/action", {
        playerId: "p1",
        actionType: "move_player_to_spectator",
        data: { playerId: "p3" },
      });

      expect(moved.status).toBe(200);
      expect(room.snapshot().assignments).not.toHaveProperty("p3");

      const watcher = wireObjectSchema.parse(room.viewFor("p3").you);

      expect(watcher.role).toBe("spectator");
      expect(watcher.team).toBeNull();
      expect(watcher.canSeeKey).toBe(false);
    });
  });

  it("refuses to start a lobby where one team has two spymasters", async () => {
    await withSeededRandom(async () => {
      const room = await lobby();

      await post(room, "/agent/action", {
        playerId: "p1",
        actionType: "assign_codenames_role",
        data: { playerId: "p2", team: "red", role: "operative" },
      });

      const refused = await post(room, "/agent/start", { playerId: "p1" });
      const body = wireObjectSchema.parse(await refused.json());
      const error = wireObjectSchema.parse(body.error ?? {});

      expect(refused.status).toBe(400);
      expect(error.code).toBe("CODENAMES_SPYMASTER_COUNT");
      expect(room.snapshot().status).toBe("waiting");
    });
  });
});
