import { roomTestEnv } from "../fixtures/room-env";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CodenamesGameRoom } from "../../durable-objects/CodenamesGameRoom";
import { ContextoRoom } from "../../durable-objects/ContextoRoom";
import type { CodenamesGameState, ContextoGameState } from "../../durable-objects/types";

/**
 * One place that proves hidden information stays hidden for a viewer who is not
 * entitled to it. Games without hidden information are intentionally absent.
 */
describe("private state projections", () => {
  class CodenamesProjector extends CodenamesGameRoom {
    protected restoreSessions(): void {}

    build(): CodenamesGameState {
      return this.createDefaultState({ hostId: "host", hostName: "Host" }, "ABC234");
    }

    /** Same projection a client receives, typed for the assertions below. */
    project(playerId: string, state: CodenamesGameState) {
      return z
        .object({
          board: z
            .array(z.object({ affiliation: z.string().nullable() }).passthrough())
            .readonly(),
        })
        .passthrough()
        .parse(this.projectStateFor(playerId, state));
    }
  }

  class ContextoRoomProbe extends ContextoRoom {
    protected restoreSessions(): void {}
  }

  it("keeps the Codenames key away from operatives and spectators", () => {
    const projector = new CodenamesProjector(new MemoryRoomRuntime(), roomTestEnv());
    const state = projector.build();

    state.status = "playing";
    state.players = [
      { id: "spy", name: "Spy" },
      { id: "op", name: "Operative" },
    ];
    state.assignments = { spy: { team: "red", role: "spymaster" }, op: { team: "blue", role: "operative" } };
    state.board = [
      { index: 0, word: "apple", affiliation: "red", revealed: false, revealedBy: null },
      { index: 1, word: "banana", affiliation: "assassin", revealed: false, revealedBy: null },
    ];

    const operative = projector.project("op", state).board;
    const spectator = projector.project("watcher", state).board;
    const spymaster = projector.project("spy", state).board;

    expect(operative.map((card) => card.affiliation)).toEqual([null, null]);
    expect(spectator.map((card) => card.affiliation)).toEqual([null, null]);
    // The key is still readable by the role that owns it, and never by others.
    expect(spymaster.map((card) => card.affiliation)).toEqual(["red", "assassin"]);
  });

  it("never projects the Contexto secret while the round is running", async () => {
    const storage = new Map<string, unknown>();
    const runtime = new MemoryRoomRuntime(storage, () => undefined);
    const room = new ContextoRoomProbe(runtime, roomTestEnv());

    await runtime.initialized;
    await room.fetch(
      new Request("https://room.test/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostId: "host", hostName: "Host", roomCode: "ABC234" }),
      }),
    );
    await room.fetch(
      new Request("https://room.test/agent/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: "guest", assignedCodename: "SwiftAnchor" }),
      }),
    );
    await room.fetch(
      new Request("https://room.test/agent/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: "host" }),
      }),
    );

    const viewer = await room.fetch(new Request("https://room.test/agent/view?playerId=guest"));
    const payload = await viewer.json<{ state?: ContextoGameState }>();
    const state = payload.state;

    expect(state).toMatchObject({ status: "playing" });
    expect(state?.secret).toBeUndefined();
    // The server-only rank table is never part of any projection.
    expect(JSON.stringify(state)).not.toContain("rankTable");
  });
});
