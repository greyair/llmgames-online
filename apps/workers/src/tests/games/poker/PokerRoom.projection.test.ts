import { roomTestEnv } from "../../fixtures/room-env";
import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { broadcastProjection } from "../../../lib/broadcastProjection";
import { describe, expect, it } from "vitest";
import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";
import { pokerPlugin } from "../../../games/poker/plugin";
import type { PokerGameState, PokerSeat } from "../../../durable-objects/types";

function seat(playerId: string, hole: PokerSeat["hole"]): PokerSeat {
  return {
    playerId,
    name: playerId,
    stack: 990,
    hole,
    streetBet: 10,
    handContributed: 10,
    folded: false,
    allIn: false,
    sittingOut: false,
  };
}

function gameState(): PokerGameState {
  return {
    id: "poker-duel",
    roomCode: "POK234",
    type: "poker",
    status: "playing",
    players: [
      { id: "p1", name: "Player One" },
      { id: "p2", name: "Player Two" },
    ],
    hostId: "p1",
    maxPlayers: 2,
    timerConfig: { gameTotalTime: 60_000, turnTime: 30_000 },
    gameTimeRemaining: 60_000,
    turnState: {
      currentPlayerId: "p1",
      turnNumber: 1,
      phase: "preflop",
      startedAt: 0,
      turnTimeRemaining: 30_000,
    },
    createdAt: 0,
    updatedAt: 0,
    expiresAt: ROOM_LIFETIME_MS,
    seats: [
      seat("p1", [
        { rank: "A", suit: "S" },
        { rank: "A", suit: "H" },
      ]),
      seat("p2", [
        { rank: "K", suit: "D" },
        { rank: "Q", suit: "D" },
      ]),
    ],
    buttonIndex: 0,
    smallBlind: 5,
    bigBlind: 10,
    pot: 20,
    community: [],
    currentBet: 10,
    minRaise: 10,
    deck: [
      { rank: "J", suit: "D" },
      { rank: "10", suit: "D" },
    ],
    deckCommitHash: "commit",
    handNumber: 1,
    actionPlayerId: "p1",
    lastAggressorId: null,
    actorsThisStreet: [],
    lastHandResult: null,
    winner: null,
    actionLog: [],
    startingStack: 1000,
  };
}

type ProjectedSeat = {
  playerId: string;
  hole: Array<{ rank: string; suit: string; hidden?: boolean }>;
  holeCount: number;
};

describe("PokerRoom projection", () => {
  // The projection moved to the plugin in M3.9; the assertions are unchanged.
  class ProjectionPokerRoom {
    project(playerId: string, state: PokerGameState) {
      // SAFETY: the poker projection always carries `seats`; the plugin's return
      // type is the generic `object` the contract publishes.
      const view = pokerPlugin.projectState?.(state, playerId) as {
        seats: ProjectedSeat[];
        deck?: unknown;
        deckRemaining?: unknown;
      };

      return view;
    }
  }

  const projector = new ProjectionPokerRoom();

  it("keeps the other player's hole cards and the deck private during a duel", () => {
    const projected = projector.project("p1", gameState());
    const mine = projected.seats[0]!;
    const opponent = projected.seats[1]!;

    expect(mine.hole).toEqual([
      { rank: "A", suit: "S" },
      { rank: "A", suit: "H" },
    ]);
    expect(opponent).toMatchObject({
      hole: [
        { rank: "?", suit: "?", hidden: true },
        { rank: "?", suit: "?", hidden: true },
      ],
      holeCount: 2,
    });
    expect(projected.deck).toBeUndefined();
    expect(JSON.stringify(projected)).not.toContain('"rank":"K","suit":"D"');
    expect(JSON.stringify(projected)).not.toContain('"rank":"J","suit":"D"');
  });

  it("does not reveal a folded opponent's cards when the hand ends", () => {
    const state = gameState();
    state.turnState.phase = "hand_over";
    state.seats[1]!.folded = true;
    state.lastHandResult = {
      winners: ["p1"],
      pot: 20,
      showdown: false,
      reason: "fold",
      payouts: [{ playerId: "p1", amount: 20 }],
    };

    const opponent = projector.project("p1", state).seats[1]!;
    expect(opponent.hole).toEqual([
      { rank: "?", suit: "?", hidden: true },
      { rank: "?", suit: "?", hidden: true },
    ]);
  });

  it("reveals showdown cards after the hand is decided", () => {
    const state = gameState();
    state.turnState.phase = "hand_over";
    state.lastHandResult = {
      winners: ["p1"],
      pot: 20,
      showdown: true,
      reason: "showdown",
      hands: [
        {
          playerId: "p1",
          hole: state.seats[0]!.hole,
          category: "pair",
          label: "Pair of Aces",
        },
        {
          playerId: "p2",
          hole: state.seats[1]!.hole,
          category: "high_card",
          label: "King high",
        },
      ],
      payouts: [{ playerId: "p1", amount: 20 }],
    };

    const opponent = projector.project("p1", state).seats[1]!;
    expect(opponent.hole).toEqual([
      { rank: "K", suit: "D" },
      { rank: "Q", suit: "D" },
    ]);
  });

  it("hides every hole card from a spectator seat", () => {
    const state = gameState();
    const view = projector.project("watcher", state);

    const hidden = [
      { rank: "?", suit: "?", hidden: true },
      { rank: "?", suit: "?", hidden: true },
    ];

    for (const seat of view.seats) expect(seat.hole).toEqual(hidden);

    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain('"rank":"A"');
    expect(serialized).not.toContain('"rank":"K"');
    expect(view.deck).toBeUndefined();
  });
});

it("broadcast strips private data after applying the anonymous spectator projection", () => {
  const state = gameState();

  // The empty viewer id is the public broadcast path, as before the migration.
  const view = broadcastProjection(pokerPlugin.projectState?.(state, "") ?? {}, state.players);
  const serialized = JSON.stringify(view);

  for (const field of [
    "shoe",
    "residual",
    "dealtLog",
    "deck",
    "rankedOwners",
    "hostId",
    "agentId",
    "controllerId",
    "actionLog",
  ]) {
    expect(Object.keys(view)).not.toContain(field);
  }

  for (const p of state.players) expect(serialized).not.toContain(`"${p.id}"`);
});
