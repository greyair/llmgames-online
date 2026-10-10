import { wireValueSchema, wireObjectSchema } from "@llmgames/game-catalog";
import type { WireObject } from "@llmgames/game-catalog";

import { z } from "zod";
import { describe, expect, it } from "vitest";
import { compactAgentDecisionState } from "@llmgames/game-catalog";

type StateFixture = WireObject & {
  turnState: WireObject;
  you: WireObject;
};

const common = (type: string, extra: WireObject): StateFixture => ({
  type,
  status: "playing",
  players: [{ id: "p1", name: "Repeated Display Name" }],
  roomMembers: [{ playerId: "p1", environmentLabel: "Codex" }],
  gameTimeRemaining: 50_000,
  turnState: {
    currentPlayerId: "p1",
    turnNumber: 4,
    phase: "play",
    turnTimeRemaining: 20_000,
  },
  you: {
    playerId: "p1",
    isHost: true,
    isYourTurn: true,
    legalActions: ["leave", "end_game", "drop_disc"],
  },
  ...extra,
});

describe("MCP decision state", () => {
  it("encodes Connect 4 without roster or host controls", () => {
    const decision = compactAgentDecisionState(
      common("connect4", {
        board: [
          [0, 0, 0],
          [1, 2, 0],
        ],
        seats: { p1: 1, p2: 2 },
        lastMove: { row: 1, col: 1, seat: 2 },
      }),
    );

    expect(decision).toMatchObject({
      board: ["000", "120"],
      yourSeat: 1,
      currentSeat: 1,
      legalColumns: [0, 1, 2],
      legalActions: ["drop_disc"],
    });
    expect(decision).not.toHaveProperty("players");
    expect(decision).not.toHaveProperty("roomMembers");
  });

  it("keeps Reversi legal moves and score", () => {
    const state = common("reversi", {
      board: [
        [0, 1],
        [2, 0],
      ],
      seats: { p1: 1, p2: 2 },
      scores: { 1: 2, 2: 1 },
      legalMoves: [{ row: 1, col: 1, flipCount: 1 }],
    });

    state.you = { playerId: "p1", legalActions: ["leave", "place_disc"] };
    const decision = compactAgentDecisionState(state);

    expect(decision).toMatchObject({
      board: ["01", "20"],
      scores: { 1: 2, 2: 1 },
      legalMoves: [{ row: 1, col: 1, flipCount: 1 }],
    });
  });

  it("uses tuple cards for Codenames", () => {
    const state = common("codenames", {
      board: [
        { index: 0, word: "ANCHOR", revealed: false, affiliation: "red" },
        { index: 1, word: "MOON", revealed: false, affiliation: null },
      ],
      activeTeam: "red",
      clue: { word: "sea", count: 1, givenBy: "p2", at: 123 },
      guessesRemaining: 2,
      guessesMade: 0,
      remaining: { red: 8, blue: 7 },
    });

    state.turnState.phase = "guess";
    state.you = {
      playerId: "p1",
      team: "red",
      role: "operative",
      legalActions: ["leave", "guess_word", "end_turn"],
    };

    expect(compactAgentDecisionState(state)).toMatchObject({
      yourTeam: "red",
      yourRole: "operative",
      cards: [
        [0, "ANCHOR", false, "red"],
        [1, "MOON", false, null],
      ],
      clue: { word: "sea", count: 1 },
      legalActions: ["guess_word", "end_turn"],
    });
  });

  it("encodes Battleship target knowledge as a grid", () => {
    const state = common("battleship", {
      boardSize: 4,
      munitionEconomy: { yourPoints: 5, cannonReward: 1, costs: { bomb: 5 } },
      yourBoard: { ready: true, munitionPoints: 5 },
      opponent: {
        hits: [{ row: 0, col: 1 }],
        misses: [{ row: 2, col: 3 }],
        radarScans: [{ row: 1, col: 2, shipCells: 2 }],
        shipsRemaining: 4,
      },
    });

    state.turnState.phase = "battle";
    state.you = { playerId: "p1", legalActions: ["leave", "cannon", "bomb"] };

    expect(compactAgentDecisionState(state)).toMatchObject({
      targetGrid: [".x..", "....", "...o", "...."],
      radarScans: [{ row: 1, col: 2, shipCells: 2 }],
      munitionPoints: 5,
      weaponCosts: { bomb: 5 },
      legalActions: ["cannon", "bomb"],
    });
  });

  it("keeps Poker table math while bounding action history", () => {
    const actions = Array.from({ length: 30 }, (_, index) => ({
      playerId: index % 2 ? "p1" : "p2",
      action: "check",
      street: "flop",
    }));

    const state = common("poker", {
      seats: [
        { playerId: "p1", stack: 900, streetBet: 20, hole: [{ rank: "A", suit: "S" }] },
        { playerId: "p2", stack: 850, streetBet: 20, hole: [{ rank: "?", suit: "?" }] },
      ],
      community: [{ rank: "K", suit: "H" }],
      pot: 40,
      currentBet: 20,
      minRaise: 20,
      toCall: 0,
      canCheck: true,
      actionLog: actions,
    });

    state.turnState.phase = "flop";
    state.you = { playerId: "p1", legalActions: ["leave", "check", "bet"] };
    const decision = compactAgentDecisionState(state)!;

    const history = z
      .object({ entries: z.array(wireValueSchema), omitted: z.number() })
      .passthrough()
      .parse(decision.actionHistory);

    expect(decision).toMatchObject({ pot: 40, toCall: 0, legalActions: ["check", "bet"] });
    expect(history.entries).toHaveLength(24);
    expect(history.omitted).toBe(6);
    expect(z.array(wireObjectSchema).parse(decision.seats)[1]).not.toHaveProperty("hole");
  });
});
