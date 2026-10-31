import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";
import { roomTestEnv } from "../../fixtures/room-env";
import { PokemonRoom } from "../../../durable-objects/PokemonRoom";
import { pokemonPlugin } from "../../../games/pokemon/plugin";
import type { PokemonGameState } from "../../../games/pokemon/state";

/**
 * The battle snapshot cache must never hand back a battle that was mutated
 * after the snapshot it is keyed by.
 *
 * A Durable Object write can fail; the platform then reloads the last stored
 * state, which is the snapshot from *before* the action. If the cache still
 * answers for that older snapshot with the mutated battle, the rolled-back room
 * would project an action that was never persisted.
 */

const viewSchema = z
  .object({
    decision: z.unknown().optional(),
    battleTurn: z.number().optional(),
    sides: z.array(z.unknown()).optional(),
  })
  .loose();

/** Project through the plugin without trusting the contract's generic `object`. */
function project(state: PokemonGameState, playerId: string) {
  return viewSchema.parse(pokemonPlugin.projectState?.(state, playerId));
}

const decisionSchema = z
  .object({ moves: z.array(z.object({ slot: z.number(), disabled: z.boolean().optional() }).loose()).optional() })
  .loose()
  .nullish();

function startedGame(): PokemonGameState {
  const state = pokemonPlugin.createInitialState(
    { hostId: "p1", hostName: "One", maxPlayers: 2 },
    "PKM999",
    0,
  );

  state.players = [
    { id: "p1", name: "One" },
    { id: "p2", name: "Two" },
  ];
  state.status = "playing";

  pokemonPlugin.start(state, { firstPlayerIndex: 0, now: 0 });

  return state;
}

function firstLegalMove(state: PokemonGameState, playerId: string): number {
  const decision = decisionSchema.parse(project(state, playerId).decision);
  const move = decision?.moves?.find((candidate) => !candidate.disabled);

  expect(move, "the seat should have a move on turn one").toBeTruthy();

  return move!.slot;
}

describe("Pokémon battle snapshot cache", () => {
  it("re-parses a snapshot that was rolled back after a mutated action", () => {
    const state = startedGame();
    const snapshotBefore = state.battleSnapshot;

    expect(snapshotBefore).toBeTruthy();

    const before = project(state, "p1");
    const slot = firstLegalMove(state, "p1");

    const result = pokemonPlugin.applyAction(
      state,
      "p1",
      { actionType: "pokemon_move", data: { slot } },
      Date.now(),
    );

    expect(result.ok).toBe(true);
    expect(state.battleSnapshot).not.toBe(snapshotBefore);

    // The platform rolled the write back: the live state is the older snapshot
    // again, but it is a fresh object read from storage.
    const rolledBack: PokemonGameState = {
      ...state,
      battleSnapshot: snapshotBefore,
      turnState: { ...state.turnState, turnNumber: 0 },
    };

    const view = project(rolledBack, "p1");

    // The rolled-back seat must be asked again, at the turn it was asked at
    // before the action: its choice never reached disk.
    expect(decisionSchema.parse(view.decision)).not.toBeNull();
    expect(view.battleTurn).toBe(before.battleTurn);
  });

  it("keeps two different snapshots apart", () => {
    const first = startedGame();
    const second = startedGame();

    const firstView = project(first, "p1");
    const secondView = project(second, "p1");

    expect(first.battleSnapshot).not.toBe(second.battleSnapshot);
    expect(firstView.sides).toHaveLength(2);
    expect(secondView.sides).toHaveLength(2);
  });
});

describe("Pokémon room after a failed write", () => {
  class Room extends PokemonRoom {
    stop() {
      this.stopTimers();
    }
  }

  function post<T>(room: Room, path: string, body: T) {
    return room.fetch(
      new Request(`https://room.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  async function view(room: Room, id = "one") {
    const response = await room.fetch(new Request(`https://room.test/agent/view?playerId=${id}`));

    return (await response.json<{ state: { decision?: unknown } }>()).state;
  }

  it("projects the stored turn again when the action write fails", async () => {
    const runtime = new MemoryRoomRuntime(new Map(), undefined, [], true);
    const room = new Room(runtime, roomTestEnv());

    try {
      await post(room, "/create", { hostId: "one", hostName: "One", roomCode: "PKM777" });
      await post(room, "/agent/join", { playerId: "two", assignedCodename: "SwiftAnchor" });
      await post(room, "/agent/start", { playerId: "one" });

      const before = await view(room);

      const move = decisionSchema.parse(before.decision)?.moves?.find(
        (candidate) => !candidate.disabled,
      );

      expect(move).toBeTruthy();

      // Every accepted action persists the state together with its receipt.
      runtime.storage.failWriteContaining = "ackedActionRecords";

      const rejected = await post(room, "/agent/action", {
        playerId: "one",
        actionType: "pokemon_move",
        data: { slot: move!.slot },
      });

      expect(rejected.ok).toBe(false);

      runtime.storage.failWriteContaining = null;

      const after = await view(room);

      // The choice never reached disk, so the seat must be asked again.
      expect(decisionSchema.parse(after.decision)).not.toBeNull();
    } finally {
      room.stop();
    }
  });
});
