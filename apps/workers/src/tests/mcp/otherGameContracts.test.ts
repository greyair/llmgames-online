import { wireValueSchema } from "@llmgames/game-catalog";
import { parseJevView } from "../../agents/jev";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { compactAgentDecisionState, getGameToolSchema } from "@llmgames/game-catalog";
import { otherGameExamples } from "../fixtures/game-spec";
import { createGameRoomFixture } from "../fixtures/game-room";
import { PokerRoom } from "../../durable-objects/PokerRoom";
import { jevDecision } from "../../agents/jev";

describe("MCP game context and examples", () => {
  it("exports deterministic real projections with complete legal moves and private-seat data", async () => {
    const first = await otherGameExamples(),
      second = await otherGameExamples();

    for (const game of [
      "connect4",
      "checkers",
      "reversi",
      "pokemon",
      "codenames",
      "poker",
      "contexto",
    ] as const) {
      expect(compactAgentDecisionState(first[game]), game).toEqual(
        compactAgentDecisionState(second[game]),
      );
    }

    const checkers = compactAgentDecisionState(first.checkers)!;
    expect(checkers.legalMoves).toHaveLength(7);
    expect(compactAgentDecisionState(first.reversi)!.legalMoves).toHaveLength(4);

    const pokemon = z
      .object({
        sides: z.array(
          z
            .object({
              pokemon: z.array(z.object({ hidden: z.boolean().optional() }).passthrough()),
            })
            .passthrough(),
        ),
        decision: z.object({ moves: z.array(wireValueSchema) }).passthrough(),
      })
      .parse(compactAgentDecisionState(first.pokemon));

    expect(pokemon.sides[0]!.pokemon).toHaveLength(6);
    expect(pokemon.sides[1]!.pokemon.filter((p) => p.hidden)).toHaveLength(5);
    expect(pokemon.decision.moves).toHaveLength(4);
    expect(pokemon.decision.moves[0]).toHaveProperty("type");
    expect(JSON.stringify(pokemon)).not.toMatch(/battleSnapshot|"prng"|inputLog/);

    const code = z
      .object({ cards: z.array(z.array(wireValueSchema)) })
      .parse(compactAgentDecisionState(first.codenames));

    expect(code.cards.every((card) => card[3] === null)).toBe(true);

    const poker = z
      .object({ seats: z.array(z.object({ isYou: z.boolean().optional() }).passthrough()) })
      .passthrough()
      .parse(compactAgentDecisionState(first.poker));

    expect(poker.seats.find((seat) => !seat.isYou)).not.toHaveProperty("hole");
    expect(poker).not.toHaveProperty("deck");

    const contexto = z
      .object({ phase: z.string(), yourProgress: z.object({ guesses: z.array(wireValueSchema) }) })
      .passthrough()
      .parse(compactAgentDecisionState(first.contexto));

    expect(contexto.phase).toBe("guessing");
    expect(contexto).not.toHaveProperty("secret");
    expect(contexto).not.toHaveProperty("rankTable");
    expect(contexto.yourProgress.guesses).toHaveLength(3);
  });

  it("gives usable mutually exclusive and union-valued action examples", () => {
    expect(getGameToolSchema("guess_word")).toEqual({
      error: expect.stringContaining("Pass gameType:"),
    });
    expect(getGameToolSchema("guess_word", "contexto")).toMatchObject({
      example: { data: { word: "ocean" } },
    });
    expect(getGameToolSchema("guess_word", "codenames")).toMatchObject({
      example: { data: { index: 0 } },
    });
    expect(getGameToolSchema("give_clue", "codenames")).toMatchObject({
      example: { data: { word: "ocean", count: 1 } },
    });
    expect(getGameToolSchema("raise", "poker")).toMatchObject({
      example: { data: { raiseTo: 20 } },
    });
    expect(getGameToolSchema("bet", "poker")).toMatchObject({ example: { data: { amount: 10 } } });
  });

  it("offers a legal positive bet to the big blind after a call", async () => {
    const game = await createGameRoomFixture(PokerRoom, "bb-contract");
    await game.action(game.state().actionPlayerId!, "call");
    const player = game.state().actionPlayerId!;
    const decision = jevDecision(parseJevView(compactAgentDecisionState(await game.view(player))))!;

    const bets = Object.values(decision.options).filter(
      (option) => option.action.actionType === "bet",
    );

    expect(bets.length).toBeGreaterThan(0);
    const firstBet = bets[0]!.action;
    expect(z.object({ amount: z.number() }).parse(firstBet.data).amount).toBeGreaterThan(0);
    const before = game.state().currentBet;
    await game.action(player, firstBet.actionType, firstBet.data);
    expect(game.state().currentBet).toBeGreaterThan(before);
  });

  it("holds MCP wait_for_turn until next_hand can actually be accepted", async () => {
    vi.useFakeTimers();

    try {
      const game = await createGameRoomFixture(PokerRoom, "hold-contract");
      await game.action(game.state().actionPlayerId!, "fold");
      const player = game.ids[0]!;

      // Browser keeps its countdown control; only the agent must wait for readiness.
      const browser = z
        .object({ you: z.object({ legalActions: z.array(z.string()) }) })
        .parse(game.room.browser(player));

      expect(browser.you.legalActions).toContain("next_hand");
      expect(compactAgentDecisionState(await game.view(player))!.legalActions).not.toContain(
        "next_hand",
      );
      let resolved = false;

      const waiting = game
        .post("/agent/wait-turn", { playerId: player, timeoutMs: 10000 })
        .then(async (response) => {
          resolved = true;

          return response.json();
        });

      await vi.advanceTimersByTimeAsync(4999);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await waiting).toMatchObject({
        timedOut: false,
        reason: "your_turn",
        state: { legalActions: ["next_hand"] },
      });
      await game.action(player, "next_hand");
      expect(game.state().handNumber).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
