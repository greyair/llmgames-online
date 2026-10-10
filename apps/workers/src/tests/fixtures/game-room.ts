import { roomTestEnv } from "../fixtures/room-env";

import type { WireValue } from "@llmgames/game-catalog";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import type { RoomRuntime } from "../../durable-objects/runtime";
import type { Env } from "../../types";
import type { BaseGameState } from "../../durable-objects/types";
import type { BaseGameRoom } from "../../durable-objects/BaseGameRoom";

/** Local room with real action and projection handlers, without sockets or alarm delivery. */
export async function createGameRoomFixture<T extends BaseGameState>(
  Room: new (state: RoomRuntime, env: Env) => BaseGameRoom<T>,
  prefix: string,
  players = 2,
  environment = roomTestEnv(),
) {
  const storage = new Map<string, unknown>();

  const durableState = new MemoryRoomRuntime(storage);

  abstract class FixtureRoom extends Room {
    snapshot() {
      if (!this.gameState) throw new Error("Room fixture has no game state");

      return this.gameState;
    }
    browser(playerId: string) {
      return this.buildClientView(playerId);
    }
  }

  // SAFETY: Room's concrete constructor contract guarantees its inherited abstract game methods are implemented. The subclass adds only test accessors.
  const ConcreteFixtureRoom = FixtureRoom as new (state: RoomRuntime, env: Env) => FixtureRoom;
  const room = new ConcreteFixtureRoom(durableState, environment);
  await durableState.initialized;

  const post = async <T>(path: string, body: T) => {
    const response = await room.fetch(
      new Request(`https://fixture.invalid${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    if (!response.ok) throw new Error(`Fixture ${prefix} ${path}: ${await response.text()}`);

    return response;
  };

  const ids = Array.from({ length: players }, (_, index) => `${prefix}-player-${index + 1}`);
  await post("/create", {
    hostId: ids[0],
    hostName: "Example captain",
    roomCode: "ABC234",
    maxPlayers: players,
    gameTotalTime: 900000,
    turnTime: 150000,
  });

  for (const id of ids.slice(1))
    await post("/agent/join", { playerId: id, assignedCodename: "SwiftAnchor" });
  await post("/agent/start", { playerId: ids[0] });
  const state = () => room.snapshot();

  const view = async (playerId = ids[0]!) => {
    const response = await room.fetch(
      new Request(`https://fixture.invalid/agent/view?playerId=${encodeURIComponent(playerId)}`),
    );

    const result = await response.json<{ state: object }>();

    return result.state;
  };

  return {
    room,
    state,
    ids,
    post,
    view,
    action: (playerId: string, actionType: string, data: WireValue = {}) =>
      post("/agent/action", { playerId, actionType, data }),
  };
}
