import { z } from "zod";
import { wireValueSchema } from "@llmgames/game-catalog";
import { compactState } from "../../../games/agent-decision";
import { roomTestEnv } from "../../fixtures/room-env";

import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { afterEach, describe, expect, it } from "vitest";
import { Battle, Teams, toID } from "@pkmn/sim";
import { PokemonRoom } from "../../../durable-objects/PokemonRoom";

import { battleView, createBattle, decision } from "../../../games/pokemon/engine";
import { compactAgentDecisionState } from "@llmgames/game-catalog";

type View = ReturnType<typeof battleView> & {
  you: { isYourTurn: boolean; legalActions: string[] };
  winner: string;
  status: string;
  type: string;
};

class TestRoom extends PokemonRoom {
  stop() {
    this.stopTimers();
  }
  timeout() {
    return this.onTurnTimeout();
  }
  timeUp() {
    this.onGameTimeout();
  }
  spectator() {
    return this.projectStateFor("", this.gameState!);
  }
  replay() {
    return this.buildRewatchView();
  }
  snapshot() {
    return this.gameState!;
  }
}

const rooms: TestRoom[] = [];

const testPokemon = (species: string, moves: string[]) =>
  Teams.import(`${species}\n${moves.map((move) => `- ${move}`).join("\n")}`)![0]!;

afterEach(() => {
  for (const room of rooms) room.stop();
  rooms.length = 0;
});

function harness(storage = new Map<string, unknown>()) {
  let ready: Promise<unknown> = Promise.resolve();

  const state = new MemoryRoomRuntime(storage, undefined, [], true);

  const room = new TestRoom(state, roomTestEnv());
  ready = state.initialized;
  rooms.push(room);

  return { room, storage, ready };
}

function post<T>(room: TestRoom, path: string, body: T) {
  return room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function view(room: TestRoom, id = "one"): Promise<View> {
  const response = await room.fetch(new Request(`https://room.test/agent/view?playerId=${id}`));

  return (await response.json<{ state: View }>()).state;
}

async function start() {
  const h = harness();
  await post(h.room, "/create", {
    hostId: "one",
    hostName: "One",
    roomCode: "PKM234",
  });
  await post(h.room, "/agent/join", {
    playerId: "two",
    assignedCodename: "SwiftAnchor",
  });
  const started = await post(h.room, "/agent/start", { playerId: "one" });
  expect(started.status, await started.text()).toBe(200);

  return h;
}

function choose(room: TestRoom, playerId: string, slot: number, actionType = "pokemon_move") {
  return post(room, "/agent/action", { playerId, actionType, data: { slot } });
}

describe("Gen 1 Pokémon room", () => {
  it("generates six distinct original-generation Pokémon with no abilities or items", () => {
    const b = createBattle();

    for (const side of b.sides) {
      expect(side.pokemon).toHaveLength(6);
      expect(new Set(side.pokemon.map((p) => p.baseSpecies.id)).size).toBe(6);

      for (const p of side.pokemon) {
        expect(p.baseSpecies.num).toBeGreaterThan(0);
        expect(p.baseSpecies.num).toBeLessThanOrEqual(151);
        expect(p.item).toBe("");
        expect(p.ability).toBe("noability");
      }
    }
  });
  it("hides teams, exact opponent HP, choices, RNG and snapshots from agents and spectators", async () => {
    const { room } = await start();
    const initial = await view(room);
    expect(initial.sides[0]!.pokemon.every((p) => !("hidden" in p))).toBe(true);
    expect(initial.sides[1]!.pokemon.filter((p) => "hidden" in p)).toHaveLength(5);
    expect(initial.sides[1]!.pokemon.find((p) => "active" in p && p.active)).toMatchObject({
      condition: "100/100",
    });
    const enemyBefore = await view(room, "two");
    const spectatorBefore = room.spectator();
    const slot = initial.decision!.moves.find((m) => !m.disabled)!.slot;
    expect((await choose(room, "one", slot)).status).toBe(200);
    const enemyAfter = await view(room, "two");

    for (const key of ["sides", "decision", "battleLog"] as const)
      expect(enemyAfter[key]).toEqual(enemyBefore[key]);
    expect(z.object({ sides: wireValueSchema }).parse(room.spectator()).sides).toEqual(
      z.object({ sides: wireValueSchema }).parse(spectatorBefore).sides,
    );
    const sealed = await view(room);
    expect(sealed.decision).toBeNull();
    expect(sealed.you.isYourTurn).toBe(false);
    expect((await choose(room, "one", slot)).status).toBe(422);

    for (const result of [
      initial,
      spectatorBefore,
      room.replay(),
      compactState(initial),
    ]) {
      const text = JSON.stringify(result);
      expect(text).not.toContain("battleSnapshot");
      expect(text).not.toContain("prng");
      expect(text).not.toContain("inputLog");
      expect(text).not.toContain("choice");
    }

    expect(compactState(initial)).toMatchObject({
      gameType: "pokemon",
      decision: initial.decision,
    });
  });
  it("keeps log cursors stable across clipping and projects HP for each audience", () => {
    const battle = createBattle();
    const own = battleView(battle, "p1");
    const spectator = battleView(battle, null);
    const player = battle.p1.active[0]!;

    const initial = own.battleLog.find((line) => line.startsWith("|switch|p1a:"))!;

    expect(initial.split("|")[4]).toBe(player.getHealth().secret);
    expect(spectator.battleLog.find((line) => line.startsWith("|switch|p1a:"))!.split("|")[4]).toBe(
      player.getHealth().shared,
    );
    expect(own.battleLog.find((line) => line.startsWith("|switch|p2a:"))!.split("|")[4]).toBe(
      battle.p2.active[0]!.getHealth().shared,
    );
    const cursor = own.battleLogOffset + own.battleLog.length;

    for (let i = 0; i < 70; i++) battle.add("message", `Event ${i}`);
    const next = battleView(battle, "p1");
    expect(next.battleLog).toHaveLength(60);
    expect(next.battleLogOffset + next.battleLog.length).toBe(cursor + 70);
    expect(next.battleLog.at(-1)).toBe("|message|Event 69");
  });
  it("retains public effects after log clipping and restore without exposing counters", () => {
    const battle = new Battle({
      formatid: toID("gen1customgame"),
      seed: "1,2,3,4",
    });

    battle.setPlayer("p1", {
      team: [testPokemon("Alakazam", ["substitute", "reflect"])],
    });
    battle.setPlayer("p2", { team: [testPokemon("Chansey", ["splash"])] });
    battle.choose("p1", "move 1");
    battle.choose("p2", "move 1");
    battle.choose("p1", "move 2");
    battle.choose("p2", "move 1");

    for (let i = 0; i < 70; i++) battle.add("message", `Event ${i}`);
    const restored = Battle.fromJSON(JSON.stringify(battle.toJSON()));

    for (const viewer of ["p1", "p2", null] as const) {
      const projected = battleView(restored, viewer);
      const monster = projected.sides[0]!.pokemon[0]!;
      expect(monster).toMatchObject({ effects: ["substitute", "reflect"] });
      expect(monster).not.toHaveProperty("volatiles");
      expect(JSON.stringify(projected.battleLog)).not.toContain("Substitute");
    }

    const compact = compactState({
      type: "pokemon",
      ...battleView(restored, "p1"),
    });

    expect(compact).toHaveProperty("format", "gen1randombattle");
    expect(compact).toHaveProperty("sides.0.pokemon.0.effects", ["substitute", "reflect"]);
  });
  it("describes Recharge and Fight without fake move values and preserves executable slots", () => {
    const battle = new Battle({
      formatid: toID("gen1customgame"),
      seed: "1,2,3,4",
    });

    battle.setPlayer("p1", {
      team: [testPokemon("Tauros", ["hyperbeam"]), testPokemon("Pikachu", ["thunderbolt"])],
    });
    battle.setPlayer("p2", { team: [testPokemon("Chansey", ["splash"])] });
    const active = battle.p1.active[0]!;
    active.addVolatile("mustrecharge");
    battle.makeRequest("move");
    const recharge = decision(battle, "p1")!;
    expect(recharge.switches).toEqual([]);
    expect(recharge.moves[0]).toMatchObject({
      id: "recharge",
      slot: 1,
      disabled: false,
    });
    expect(recharge.moves[0]!.description).toContain("recharging");
    expect(recharge.moves[0]).not.toHaveProperty("power");
    expect(battle.choose("p1", "move 1")).toBe(true);
    expect(battle.choose("p2", "move 1")).toBe(true);
    active.setStatus("slp");
    battle.makeRequest("move");
    const fight = decision(battle, "p1")!;
    expect(fight.moves[0]).toMatchObject({ id: "fight", slot: 1 });
    expect(fight.moves[0]!.description).toContain("asleep");
    expect(fight.switches).toHaveLength(1);
    expect(battle.choose("p1", "move 1")).toBe(true);
  });
  it("rejects invalid choices and resumes a sealed turn after storage reload", async () => {
    const { room, storage } = await start();
    expect((await choose(room, "one", 99)).status).toBe(422);
    expect((await choose(room, "one", 1, "pokemon_switch")).status).toBe(422);
    const initial = await view(room);
    await choose(room, "one", initial.decision!.moves.find((m) => !m.disabled)!.slot);
    room.stop();
    const restoredHarness = harness(storage);
    await restoredHarness.ready;
    const restored = restoredHarness.room;
    expect((await view(restored)).you.isYourTurn).toBe(false);
    const other = await view(restored, "two");
    expect(
      (await choose(restored, "two", other.decision!.moves.find((m) => !m.disabled)!.slot)).status,
    ).toBe(200);
    expect((await view(restored)).battleLog.some((line) => line.startsWith("|move|"))).toBe(true);
    expect(restored.snapshot().battleSnapshot).not.toBeNull();
  });
  it("auto-selects legal choices for players who miss the decision timer", async () => {
    const { room } = await start();
    const initial = await view(room);
    await choose(room, "one", initial.decision!.moves.find((m) => !m.disabled)!.slot);
    await room.timeout();
    expect(room.snapshot()).toMatchObject({ winner: null, status: "playing" });
    expect((await view(room)).battleLog.some((line) => line.startsWith("|move|"))).toBe(true);
    const second = (await start()).room;
    await second.timeout();
    expect(second.snapshot()).toMatchObject({
      winner: null,
      status: "playing",
    });
    // A faster attack can prevent the second move (sleep, flinch or fainting).
    // Verify both timeout choices were submitted, not how many moves executed.
    const resolved = Battle.fromJSON(second.snapshot().battleSnapshot!);
    expect(resolved.inputLog.some((line) => line.startsWith(">p1 move "))).toBe(true);
    expect(resolved.inputLog.some((line) => line.startsWith(">p2 move "))).toBe(true);
  });
  it("runs real engine battles through forced switches to a terminal result with serializable state", () => {
    let battle = createBattle();

    // Engine regression simulation only. This is not an MCP game-playing agent.
    for (let step = 0; step < 1500 && !battle.ended; step++) {
      for (const seat of ["p1", "p2"] as const) {
        const next = decision(battle, seat);

        if (!next) continue;
        const move = next.moves.find((m) => !m.disabled);

        const choice = move ? `move ${move.slot}` : `switch ${next.switches[0]!.slot}`;

        expect(battle.choose(seat, choice)).toBe(true);
      }

      battle = Battle.fromJSON(JSON.stringify(battle.toJSON()));
    }

    expect(battle.ended).toBe(true);
    expect(battleView(battle, null).decision).toBeNull();
  });
  it.each(["one", "two"])(
    "preserves engine seats across reload and %s leaving",
    async (departing) => {
      const { room, storage } = await start();
      const remaining = departing === "one" ? "two" : "one";
      const before = await view(room, remaining);
      room.stop();
      const restored = harness(storage);
      await restored.ready;

      const response = await post(restored.room, "/agent/action", {
        playerId: departing,
        actionType: "leave",
        data: {},
      });

      expect(response.status).toBe(200);
      const after = await view(restored.room, remaining);
      expect(after.status).toBe("ended");
      expect(after.yourSeat).toBe(before.yourSeat);
      expect(after.sides).toEqual(before.sides);
    },
  );
  it.each(["one", "two", null])(
    "keeps both seat projections live when %s submits before timeout",
    async (submitted) => {
      const { room } = await start();

      if (submitted) {
        const initial = await view(room, submitted);
        await choose(room, submitted, initial.decision!.moves.find((m) => !m.disabled)!.slot);
      }

      await room.timeout();

      for (const player of ["one", "two"]) {
        expect(await view(room, player)).toMatchObject({
          yourSeat: player === "one" ? "p1" : "p2",
          winnerSeat: null,
          winner: null,
          status: "playing",
        });
      }
    },
  );
});

describe("Gen 1 move guidance", () => {
  function matchup(attacker: string, moves: string[], defender: string) {
    const battle = new Battle({ formatid: toID("gen1customgame"), seed: "1,2,3,4" });
    battle.setPlayer("p1", { team: [testPokemon(attacker, moves)] });
    battle.setPlayer("p2", { team: [testPokemon(defender, ["splash"])] });

    return { battle, moves: decision(battle, "p1")!.moves };
  }

  it("uses Gen 1 types for bonuses, resistance and immunity", () => {
    const fire = matchup("Charizard", ["flamethrower", "earthquake", "swordsdance"], "Blastoise");
    expect(fire.moves[0]).toMatchObject({
      category: "Special",
      power: 95,
      sameTypeBonus: true,
      typeMatchup: 0.5,
      matchupTarget: "Blastoise",
    });
    expect(fire.moves[1]).toMatchObject({
      category: "Physical",
      sameTypeBonus: false,
      typeMatchup: 1,
    });
    expect(fire.moves[2]).not.toHaveProperty("typeMatchup");
    const ghost = matchup("Gengar", ["lick", "nightshade"], "Alakazam");
    expect(ghost.moves[0]).toMatchObject({ category: "Physical", typeMatchup: 0 });
    expect(ghost.moves[1]).not.toHaveProperty("typeMatchup");
    const ground = matchup("Rhydon", ["earthquake", "fissure"], "Charizard");
    expect(ground.moves[0]).toMatchObject({ typeMatchup: 0 });
    expect(ground.moves[1]).not.toHaveProperty("typeMatchup");
    expect(matchup("Jolteon", ["thunderbolt"], "Gyarados").moves[0]).toMatchObject({
      typeMatchup: 4,
    });
  });
  it("does not turn type guidance into a hidden-team projection", () => {
    const { battle } = matchup("Charizard", ["flamethrower"], "Blastoise");
    const opponent = battleView(battle, "p1").sides[1]!.pokemon[0]!;
    expect(opponent).not.toHaveProperty("stats");
    expect(opponent).not.toHaveProperty("moves");
    expect(battleView(battle, null).decision).toBeNull();
  });
});
