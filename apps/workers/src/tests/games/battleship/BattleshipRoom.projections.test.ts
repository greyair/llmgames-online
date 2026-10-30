import { wireObjectSchema } from "@llmgames/game-catalog";
import { describe, expect, it } from "vitest";

import { BattleshipRoom } from "../../../durable-objects/BattleshipRoom";
import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";
import { roomTestEnv } from "../../fixtures/room-env";
import { fleetFor, post, transcriptRoom, withSeededRandom } from "./battleshipTranscript";

/**
 * Battleship is the first migrated game where a wrong projection is a cheat, not
 * a cosmetic bug: seeing the enemy fleet turns every shot into a sure hit.
 *
 * These assertions are about absence — the shapes that must never appear in a
 * seat's view before the match ends, and the one place the fleet is revealed.
 */

async function placedRoom() {
  const room = transcriptRoom(BattleshipRoom, new MemoryRoomRuntime(new Map()), roomTestEnv());

  await post(room, "/create", {
    hostId: "p1",
    hostName: "Player One",
    roomCode: "BS3345",
    turnTime: 60_000,
    gameTotalTime: 1_800_000,
  });
  await post(room, "/agent/join", { playerId: "p2", assignedCodename: "SwiftAnchor" });
  await post(room, "/agent/start", { playerId: "p1" });
  await post(room, "/agent/action", { playerId: "p1", actionType: "place_fleet", data: { ships: fleetFor(0) } });
  await post(room, "/agent/action", { playerId: "p2", actionType: "place_fleet", data: { ships: fleetFor(1) } });

  return room;
}

describe("Battleship fog of war", () => {
  it("never shows a captain the enemy fleet while the match is running", async () => {
    await withSeededRandom(async () => {
      const room = await placedRoom();

      for (const seat of ["p1", "p2"]) {
        const view = wireObjectSchema.parse(room.viewFor(seat));
        const opponent = wireObjectSchema.parse(view.opponent);

        // Own fleet is fully readable.
        expect(wireObjectSchema.parse(view.yourBoard).ships).toHaveLength(5);

        // Enemy placement is not: no cells, no ships, no reveal, no coordinates
        // in the public per-ship status.
        expect(opponent).not.toHaveProperty("cells");
        expect(opponent).not.toHaveProperty("ships");
        expect(opponent).not.toHaveProperty("revealedShips");
        expect(opponent).not.toHaveProperty("revealedMines");

        const fleetStatus = Array.isArray(opponent.fleetStatus) ? opponent.fleetStatus : [];

        expect(fleetStatus).toHaveLength(5);

        for (const ship of fleetStatus)
          expect(wireObjectSchema.parse(ship)).not.toHaveProperty("row");

        // And the raw authoritative boards never reach a client at all.
        expect(view).not.toHaveProperty("boards");
        expect(view).not.toHaveProperty("shots");
      }
    });
  });

  it("keeps both fleets hidden from a watcher", async () => {
    await withSeededRandom(async () => {
      const room = await placedRoom();
      const view = wireObjectSchema.parse(room.viewFor("watcher"));
      const boards = Array.isArray(view.spectatorBoards) ? view.spectatorBoards : [];

      expect(view.yourBoard).toBeNull();
      expect(boards).toHaveLength(2);

      for (const board of boards) {
        expect(wireObjectSchema.parse(board)).not.toHaveProperty("cells");
        expect(wireObjectSchema.parse(board)).not.toHaveProperty("ships");
      }
    });
  });

  it("reveals the enemy fleet in the replay document and nowhere else", async () => {
    await withSeededRandom(async () => {
      const room = await placedRoom();

      // The replay is a full reveal by design. It is only ever delivered with
      // `game_ended` or the archive, which is why the live views above are the
      // security boundary and this artifact may carry the fleet.
      const replay = wireObjectSchema.parse(room.replayView());
      const opponent = wireObjectSchema.parse(replay.opponent);

      expect(opponent.revealedShips).toHaveLength(5);
      expect(opponent.revealedMines).toEqual([]);
      expect(replay.replayPerspectivePlayerId).toBe("p1");

      // Same instant, same room: no live view carries those positions.
      for (const seat of ["p1", "p2", "watcher"]) {
        const live = JSON.stringify(room.viewFor(seat));

        expect(live).not.toContain("revealedShips");
        expect(live).not.toContain("revealedMines");
      }
    });
  });
});
