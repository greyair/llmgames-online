import { roomTestEnv } from "../fixtures/room-env";

import type { WireValue } from "@llmgames/game-catalog";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
/** Fictional room exercised entirely in memory, through the real room actions and projection. */

import { BattleshipRoom } from "../../durable-objects/BattleshipRoom";
import { BATTLESHIP_FALLBACK_FLEET } from "../../durable-objects/types";

import type { JevFleet } from "../../agents/jevBattleship";

export const documentationFleets: JevFleet[] = ([0, 90, 180, 270] as const).map((rotation) =>
  BATTLESHIP_FALLBACK_FLEET.map((ship) => ({
    id: ship.id,
    row:
      rotation === 90
        ? ship.col
        : rotation === 180
          ? 9 - ship.row
          : rotation === 270
            ? 9 - ship.col
            : ship.row,
    col:
      rotation === 90
        ? 9 - ship.row
        : rotation === 180
          ? 9 - ship.col
          : rotation === 270
            ? ship.row
            : ship.col,
    rotation,
  })),
);

for (const offset of [1, 2])
  documentationFleets.push(
    BATTLESHIP_FALLBACK_FLEET.map((ship) => ({ ...ship, col: ship.col + offset })),
  );

class ExampleRoom extends BattleshipRoom {
  snapshot() {
    if (!this.gameState) throw new Error("Room fixture has no game state");

    return this.gameState;
  }

  projected(playerId: string) {
    return this.buildAgentView(playerId);
  }
}

export async function createBattleshipTestRoom(suffix = "", turnTime = 60000) {
  const storage = new Map<string, unknown>();

  const durableState = new MemoryRoomRuntime(storage);

  const room = new ExampleRoom(durableState, roomTestEnv());

  const post = async <T>(path: string, data: T) => {
    const response = await room.fetch(
      new Request(`https://offline.invalid${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      }),
    );

    if (!response.ok)
      throw new Error(`Battleship documentation action failed: ${await response.text()}`);
  };

  const action = (playerId: string, actionType: string, data: WireValue) =>
    post("/agent/action", { playerId, actionType, data });

  const p1 = `example-player-1${suffix}`,
    p2 = `example-player-2${suffix}`;

  await post("/create", {
    hostId: p1,
    hostName: "Example captain",
    roomCode: "ABC234",
    gameTotalTime: 900000,
    turnTime,
  });
  await post("/agent/join", { playerId: p2, assignedCodename: "SwiftAnchor" });
  await post("/agent/start", { playerId: p1 });

  return { room, action, p1, p2, state: () => room.snapshot() };
}

export async function battleshipExamples() {
  const originalNow = Date.now;
  Date.now = () => 1_800_000_000_000;

  try {
    const { room, action, p1, p2, state: readState } = await createBattleshipTestRoom();
    const placement = room.projected(p1);

    for (const id of [p1, p2]) await action(id, "place_fleet", { ships: documentationFleets[0] });
    const captain = readState().turnState.currentPlayerId!;

    // Five normal turn exchanges earn enough energy to illustrate every weapon.
    for (let turn = 0; turn < 10; turn++) {
      const state = readState();
      const playerId = state.turnState.currentPlayerId!;
      const opponent = state.boards.find((board) => board.playerId !== playerId)!;

      const water = opponent.cells.flatMap((line, row) =>
        line.flatMap((cell, col) =>
          cell === null &&
          !state.shots.some(
            (shot) => shot.byPlayerId === playerId && shot.row === row && shot.col === col,
          )
            ? [{ row, col }]
            : [],
        ),
      )[0]!;

      await action(playerId, "cannon", water);
    }

    await action(captain, "mine", { row: 9, col: 9 });
    await action(captain, "radar", { row: 3, col: 3 });
    await action(captain, "cannon", { row: 0, col: 0 });

    return { placement, battle: room.projected(captain) };
  } finally {
    Date.now = originalNow;
  }
}
