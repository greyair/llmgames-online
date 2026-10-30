import { z } from "zod";

import { describe, expect, it } from "vitest";

import { roomTestEnv } from "../fixtures/room-env";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { MinimalGameRoom } from "../fixtures/minimal-game/room";
import { minimalGamePlugin } from "../fixtures/minimal-game/plugin";

/**
 * M3.2.1 — `agentFields` may add decision data but cannot widen a projection.
 *
 * The plugin receives the recipient's own projection, and platform-owned keys
 * are ignored on the way back, so even a careless (or hostile) plugin cannot
 * publish an opponent's hidden state or rewrite identity.
 */

/** A plugin that forwards everything it receives and tries to own platform keys. */
class LeakyRoom extends MinimalGameRoom {
  protected gameRules() {
    return {
      ...minimalGamePlugin,
      agentFields: (projection: Parameters<NonNullable<typeof minimalGamePlugin.agentFields>>[0]) => ({
        ...projection,
        type: "spoofed",
        status: "ended",
        players: [],
        winner: "attacker",
        you: { playerId: "attacker", legalActions: ["stake"] },
      }),
    };
  }
}

const agentViewSchema = z
  .object({
    type: z.string(),
    status: z.string(),
    winner: z.string().nullable(),
    players: z.array(z.object({ id: z.string() })),
    you: z.object({ playerId: z.string(), legalActions: z.array(z.string()) }),
    secrets: z.record(z.string(), z.number().nullable()).optional(),
  })
  .loose();

async function startedLeakyRoom() {
  const runtime = new MemoryRoomRuntime(new Map());
  const room = new LeakyRoom(runtime, roomTestEnv());

  await runtime.initialized;

  const post = (path: string, body: Record<string, string | number | undefined>) =>
    room.fetch(
      new Request(`https://minimal.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  await post("/create", { hostId: "host", hostName: "Host", roomCode: "MNB234", turnTime: 30_000 });
  await post("/agent/join", { playerId: "guest", assignedCodename: "SwiftAnchor" });
  expect((await post("/agent/start", { playerId: "host" })).status).toBe(200);

  const view = async (playerId: string) => {
    const response = await room.fetch(
      new Request(`https://minimal.test/agent/view?playerId=${encodeURIComponent(playerId)}`),
    );

    return agentViewSchema.parse((await response.json<{ state: object }>()).state);
  };

  return { room, view };
}

describe("plugin agent fields boundary", () => {
  it("keeps the platform projection when a plugin spreads everything it sees", async () => {
    const { room, view } = await startedLeakyRoom();

    try {
      const authoritative = room.snapshot().secrets;
      const host = await view("host");
      const guest = await view("guest");

      // Platform-owned fields are not replaceable.
      expect(host.type).toBe("minimal");
      expect(host.status).toBe("playing");
      expect(host.winner).toBeNull();
      expect(host.players.map((player) => player.id).sort()).toEqual(["guest", "host"]);
      expect(host.you.playerId).toBe("host");
      // The plugin's spoofed list was `["stake"]`; the platform list always
      // carries the shared lobby actions, so the platform view survived.
      expect(host.you.legalActions).toContain("leave");

      // Only the viewer's own hidden number can survive the projection.
      expect(host.secrets).toEqual({ host: authoritative.host });
      expect(guest.secrets).toEqual({ guest: authoritative.guest });
      expect(Object.hasOwn(host.secrets ?? {}, "guest")).toBe(false);
      expect(Object.hasOwn(guest.secrets ?? {}, "host")).toBe(false);

      const serialized = JSON.stringify(host);

      expect(serialized).not.toContain('"spoofed"');
      expect(serialized).not.toContain("attacker");
    } finally {
      room.stopForTest();
    }
  });
});
