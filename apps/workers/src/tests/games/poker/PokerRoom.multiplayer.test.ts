import { roomTestEnv } from "../../fixtures/room-env";
import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { describe, expect, it } from "vitest";
import { PokerRoom } from "../../../durable-objects/PokerRoom";
import type { Player, PokerGameState, PokerSeat } from "../../../durable-objects/types";

class MultiplayerPokerRoom extends PokerRoom {
  setState(state: PokerGameState) {
    this.gameState = state;
  }
  public startNewHand() {
    return super.startNewHand();
  }
  public actCall(player: Player) {
    return super.actCall(player);
  }
  public actCheck(player: Player) {
    return super.actCheck(player);
  }
  public settleSidePots(scores: Map<string, number>) {
    return super.settleSidePots(scores);
  }
}

function player(id: string): Player {
  return {
    id,
    name: id.toUpperCase(),
    socket: null,
    isConnected: true,
    joinedAt: 0,
  };
}

function seat(id: string, stack = 1000): PokerSeat {
  return {
    playerId: id,
    name: id.toUpperCase(),
    stack,
    hole: [],
    streetBet: 0,
    handContributed: 0,
    folded: false,
    allIn: false,
    sittingOut: false,
  };
}

function sixSeatState(): PokerGameState {
  const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];

  return {
    id: "poker-test",
    roomCode: "ABC234",
    type: "poker",
    status: "playing",
    players: ids.map((id) => ({ id, name: id.toUpperCase() })),
    hostId: "p1",
    maxPlayers: 6,
    timerConfig: { gameTotalTime: 60_000, turnTime: 15_000 },
    gameTimeRemaining: 60_000,
    turnState: {
      currentPlayerId: null,
      turnNumber: 0,
      phase: "preflop",
      startedAt: 0,
      turnTimeRemaining: 15_000,
    },
    createdAt: 0,
    updatedAt: 0,
    expiresAt: 45 * 60 * 1000,
    seats: ids.map((id) => seat(id)),
    buttonIndex: 0,
    smallBlind: 5,
    bigBlind: 10,
    pot: 0,
    community: [],
    currentBet: 0,
    minRaise: 10,
    deck: [],
    deckCommitHash: null,
    handNumber: 0,
    actionPlayerId: null,
    lastAggressorId: null,
    actorsThisStreet: [],
    lastHandResult: null,
    winner: null,
    actionLog: [],
    startingStack: 1000,
  };
}

async function roomWith(state: PokerGameState) {
  const runtime = new MemoryRoomRuntime();
  const room = new MultiplayerPokerRoom(runtime, roomTestEnv());
  await runtime.initialized;
  room.setState(state);

  return room;
}

describe("multiplayer poker", async () => {
  it("posts multiway blinds and moves preflop/postflop action clockwise", async () => {
    const state = sixSeatState();
    const room = await roomWith(state);

    room.startNewHand();

    expect(state.seats[1]!.streetBet).toBe(5);
    expect(state.seats[2]!.streetBet).toBe(10);
    expect(state.actionPlayerId).toBe("p4");
    expect(state.seats.every((entry) => entry.hole.length === 2)).toBe(true);

    for (const id of ["p4", "p5", "p6", "p1", "p2"]) {
      expect(room.actCall(player(id))).toBeUndefined();
    }

    expect(room.actCheck(player("p3"))).toBeUndefined();

    expect(state.pot).toBe(60);
    expect(state.turnState.phase).toBe("flop");
    expect(state.actionPlayerId).toBe("p2");
    expect(state.community).toHaveLength(3);
  });

  it("awards a main pot and side pot to different hands", async () => {
    const state = sixSeatState();
    state.seats = [seat("p1", 0), seat("p2", 0), seat("p3", 0)];
    state.seats[0]!.handContributed = 100;
    state.seats[1]!.handContributed = 200;
    state.seats[2]!.handContributed = 200;
    state.pot = 500;
    const room = await roomWith(state);

    const result = room.settleSidePots(
      new Map([
        ["p1", 500],
        ["p2", 400],
        ["p3", 300],
      ]),
    );

    expect(result.sidePots).toEqual([
      {
        amount: 300,
        eligiblePlayerIds: ["p1", "p2", "p3"],
        winnerIds: ["p1"],
      },
      {
        amount: 200,
        eligiblePlayerIds: ["p2", "p3"],
        winnerIds: ["p2"],
      },
    ]);
    expect(result.payouts).toEqual([
      { playerId: "p2", amount: 200 },
      { playerId: "p1", amount: 300 },
    ]);
    expect(state.seats.map((entry) => entry.stack)).toEqual([300, 200, 0]);
    expect(state.pot).toBe(0);
  });

  it("returns an uncalled excess without naming the refund as a hand win", async () => {
    const state = sixSeatState();
    state.seats = [seat("p1", 0), seat("p2", 0), seat("p3", 0)];
    state.seats[0]!.handContributed = 50;
    state.seats[1]!.handContributed = 100;
    state.seats[2]!.handContributed = 200;
    state.pot = 350;
    const room = await roomWith(state);

    const result = room.settleSidePots(
      new Map([
        ["p1", 300],
        ["p2", 500],
        ["p3", 400],
      ]),
    );

    expect(result.winnerIds).toEqual(["p2"]);
    expect(result.sidePots.at(-1)).toEqual({
      amount: 100,
      eligiblePlayerIds: ["p3"],
      winnerIds: ["p3"],
      refunded: true,
    });
    expect(state.seats.map((entry) => entry.stack)).toEqual([0, 250, 100]);
  });
});
