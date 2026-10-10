import { roomTestEnv } from "../fixtures/room-env";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";

import { wireValueSchema, wireObjectSchema } from "@llmgames/game-catalog";
import { z } from "zod";

import { describe, expect, it } from "vitest";
import { BattleshipRoom } from "../../durable-objects/BattleshipRoom";
import { PokerRoom } from "../../durable-objects/PokerRoom";
import type {
  BaseGameState,
  BattleshipGameState,
  PokerCardPublic,
  PokerGameState,
} from "../../durable-objects/types";

type ReplayConfig = { hostId: string; hostName: string };

class ReplayPokerRoom extends PokerRoom {
  defaultState(config: ReplayConfig, code: string) {
    return this.createDefaultState(config, code);
  }
  setState(state: PokerGameState) {
    this.gameState = state;
  }
  visibleJson() {
    return wireObjectSchema.parse(
      JSON.parse(JSON.stringify(this.finalizeRewatchView(this.buildRewatchView()))),
    );
  }
}

class ReplayBattleshipRoom extends BattleshipRoom {
  defaultState(config: ReplayConfig, code: string) {
    return this.createDefaultState(config, code);
  }
  setState(state: BattleshipGameState) {
    this.gameState = state;
  }
  visibleJson() {
    return wireObjectSchema.parse(
      JSON.parse(JSON.stringify(this.finalizeRewatchView(this.buildRewatchView()))),
    );
  }
}

function ended<T extends BaseGameState>(state: T): T {
  state.status = "ended";
  state.turnState.phase = "ended";
  state.turnState.currentPlayerId = null;

  return state;
}

const card = (rank: PokerCardPublic["rank"], suit: PokerCardPublic["suit"]): PokerCardPublic => ({
  rank,
  suit,
});

describe("sanitized full-reveal rewatch projections", async () => {
  it("reveals folded poker hole cards but not undealt deck cards", async () => {
    const runtime = new MemoryRoomRuntime();
    const room = new ReplayPokerRoom(runtime, roomTestEnv());
    await runtime.initialized;

    const state = ended(room.defaultState({ hostId: "p1", hostName: "Player One" }, "POK234"));

    state.players.push({ id: "p2", name: "Player Two" });
    state.community = [card("A", "S"), card("K", "S"), card("Q", "S")];
    state.deck = [card("J", "S"), card("10", "S")];
    state.seats = [
      {
        playerId: "p1",
        name: "Player One",
        stack: 990,
        hole: [card("2", "D"), card("3", "D")],
        streetBet: 0,
        handContributed: 10,
        folded: false,
        allIn: false,
        sittingOut: false,
      },
      {
        playerId: "p2",
        name: "Player Two",
        stack: 995,
        hole: [card("4", "C"), card("5", "C")],
        streetBet: 0,
        handContributed: 5,
        folded: true,
        allIn: false,
        sittingOut: false,
      },
    ];
    room.setState(state);

    const replay = room.visibleJson();
    const seats = z.array(z.object({ hole: wireValueSchema }).passthrough()).parse(replay.seats);
    expect(seats[1]?.hole).toEqual(state.seats[1]?.hole);
    expect(replay.community).toHaveLength(3);
    expect(replay).not.toHaveProperty("deck");
    expect(replay).not.toHaveProperty("deckRemaining");
  });

  it("reveals the opponent Battleship fleet cells for the read-only board", async () => {
    const runtime = new MemoryRoomRuntime();
    const room = new ReplayBattleshipRoom(runtime, roomTestEnv());
    await runtime.initialized;

    const state = ended(room.defaultState({ hostId: "p1", hostName: "Player One" }, "SEA234"));

    state.players.push({ id: "p2", name: "Player Two" });
    const emptyCells = () => Array.from({ length: 10 }, () => Array(10).fill(null));
    const opponentCells = emptyCells();
    opponentCells[2]![3] = "destroyer";
    opponentCells[2]![4] = "destroyer";
    opponentCells[3]![4] = "destroyer";
    state.boards.push({
      playerId: "p2",
      ships: [
        {
          id: "destroyer",
          row: 2,
          col: 3,
          rotation: 0,
          orientation: "h",
          hits: 0,
          sunk: false,
        },
      ],
      cells: opponentCells,
      ready: true,
      mines: [{ row: 8, col: 8 }],
      munitionPoints: 0,
      weapons: { mine: 0, radar: 0, bomb: 0, torpedo: 0 },
      shotsFired: 0,
      hitsScored: 0,
    });
    room.setState(state);

    const replay = room.visibleJson();
    const opponent = wireObjectSchema.parse(replay.opponent);
    expect(opponent.revealedShips).toMatchObject([
      {
        id: "destroyer",
        cells: [
          { row: 2, col: 3 },
          { row: 2, col: 4 },
          { row: 3, col: 4 },
        ],
      },
    ]);
    expect(opponent.revealedMines).toEqual([{ row: 8, col: 8 }]);
    expect(replay.replayPerspectivePlayerId).toBe("p1");
    expect(replay).not.toHaveProperty("spectators");
  });
});
