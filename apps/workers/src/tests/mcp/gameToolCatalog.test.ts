import { describe, expect, it } from "vitest";
import {
  actionsForGame,
  findAction,
  getGameToolSchema,
  listGameToolsCatalog,
  normalizeGameType,
} from "@llmgames/game-catalog";

describe("gameToolCatalog", () => {
  it("supplies the same concise Pokémon briefing with catalog and action schema", () => {
    const catalog = listGameToolsCatalog("pokemon");
    const rules = catalog.gameInstructions.pokemon!;
    expect(rules.briefing).toContain("Gen 1 Random Battle");
    expect(rules.briefing).toContain("Recharge/Fight");
    expect(rules.briefing).toContain("submit once, then wait");
    expect(getGameToolSchema("pokemon_move", "pokemon")).toHaveProperty(
      "gameInstructions.pokemon.briefing",
      rules.briefing,
    );
  });
  it("normalizes game type aliases", () => {
    expect(normalizeGameType("bj-duel")).toBe("bj-duel");
    expect(normalizeGameType("othello")).toBe("reversi");
    expect(normalizeGameType("holdem")).toBe("poker");
  });

  it("lists connect4 actions including drop_disc", () => {
    const actions = actionsForGame("connect4");
    expect(actions.map((a) => a.actionType)).toContain("drop_disc");
    expect(actions.map((a) => a.actionType)).toContain("move_player_to_spectator");
    expect(actions.map((a) => a.actionType)).toContain("set_host_spectating");
    expect(actions.map((a) => a.actionType)).toContain("set_player_seats");
    expect(actions.map((a) => a.actionType)).toEqual(expect.arrayContaining(["end_game"]));
    expect(actions.every((a) => a.games.includes("connect4"))).toBe(true);
  });

  it("describes the shared host move-to-spectator action", () => {
    const schema = getGameToolSchema("move_player_to_spectator", "poker");

    expect(schema).toMatchObject({
      actionType: "move_player_to_spectator",
      send_action: {
        data: { playerId: expect.anything() },
        dataRequired: ["playerId"],
      },
    });
  });

  it("uses the server-issued controller in send_action schemas", () => {
    const schema = getGameToolSchema("drop_disc", "connect4");
    expect(schema).toMatchObject({
      send_action: {
        controllerId: "uuid from agent_claim (required)",
      },
      example: {
        controllerId: "<task-controllerId>",
      },
    });
    expect(schema).not.toHaveProperty("send_action.agentId");
  });

  it("describes atomic player-seat assignment", () => {
    const schema = getGameToolSchema("set_player_seats", "poker");
    expect(schema).toMatchObject({
      actionType: "set_player_seats",
      send_action: {
        data: { playerIds: { type: "array" } },
        dataRequired: ["playerIds"],
      },
    });
  });

  it("list_game_tools is compact and scoped", () => {
    const all = listGameToolsCatalog();
    expect(all.coreTools).toContain("send_action");
    expect(Object.keys(all.games)).toEqual([
      "connect4",
      "pokemon",
      "reversi",
      "checkers",
      "codenames",
      "battleship",
      "poker",
      "contexto",
    ]);
    expect(Object.keys(all.gameInstructions)).toEqual(Object.keys(all.games));
    expect(all.turnTimerConfig).toEqual({
      minimumMs: 30_000,
      maximumMs: 150_000,
      optionsSeconds: [30, 60, 90, 120, 150],
      exception: expect.stringContaining("fleet placement"),
    });
    expect(all.turnTimerConfig.exception).toContain("Contexto");

    for (const instructions of Object.values(all.gameInstructions)) {
      expect(instructions.timers.turnTimer.length).toBeGreaterThan(0);
      expect(instructions.timers.onTimeout.length).toBeGreaterThan(0);
    }

    const c4 = listGameToolsCatalog("connect4");
    expect(Object.keys(c4.games)).toEqual(["connect4"]);
    expect(c4.games["connect4"]!.some((a) => a.actionType === "drop_disc")).toBe(true);
    // Compact: no full field objects on list
    expect(c4.games["connect4"]![0]).toHaveProperty("dataKeys");
    expect(c4.gameInstructions["connect4"]?.timers.onTimeout).toContain("forfeits the turn");
  });

  it("exposes Reversi placements with board coordinates", () => {
    const schema = getGameToolSchema("place_disc", "reversi");
    expect(schema).toMatchObject({
      actionType: "place_disc",
      send_action: {
        dataRequired: ["row", "col"],
        data: {
          row: { maximum: 7 },
          col: { maximum: 7 },
        },
      },
    });
  });

  it("exposes official Codenames clue, guess, and stop actions", () => {
    const actions = actionsForGame("codenames").map((action) => action.actionType);
    expect(actions).toEqual(
      expect.arrayContaining([
        "set_host_spectating",
        "assign_codenames_role",
        "reset_codenames_roles",
        "randomize_codenames_roles",
        "give_clue",
        "guess_word",
        "end_turn",
      ]),
    );
    const clue = getGameToolSchema("give_clue", "codenames");
    expect(clue).toMatchObject({
      actionType: "give_clue",
      send_action: { dataRequired: ["word", "count"] },
    });
  });

  it("exposes Contexto guesses and its private-rank briefing", () => {
    expect(actionsForGame("contexto").map((action) => action.actionType)).toContain("guess_word");
    const schema = getGameToolSchema("guess_word", "contexto");
    expect(schema).toMatchObject({
      actionType: "guess_word",
      send_action: { dataRequired: ["word"] },
    });
    expect(schema).toHaveProperty(
      "gameInstructions.contexto.briefing",
      expect.stringContaining("rank 1"),
    );
  });

  it("get_tool_schema returns fields for cannon and aliases fire", () => {
    const schema = getGameToolSchema("fire", "battleship");
    expect(schema).toMatchObject({
      actionType: "cannon",
      send_action: {
        data: { row: expect.anything(), col: expect.anything() },
      },
      gameInstructions: {
        battleship: {
          timers: { onTimeout: expect.stringContaining("forfeits the turn") },
        },
      },
    });
  });

  it("shows MCP agents a legal fleet example with varied rotations", () => {
    const schema = getGameToolSchema("place_fleet", "battleship");
    expect(schema).toMatchObject({
      example: {
        data: {
          ships: [
            expect.objectContaining({ id: "carrier", rotation: 90 }),
            expect.objectContaining({ id: "dreadnought", rotation: 0 }),
            expect.objectContaining({ id: "cruiser", rotation: 180 }),
            expect.objectContaining({ id: "submarine", rotation: 270 }),
            expect.objectContaining({ id: "destroyer", rotation: 90 }),
          ],
        },
      },
    });
  });

  it("findAction resolves poker fold", () => {
    const a = findAction("fold", "poker");
    expect(a?.actionType).toBe("fold");
  });

  it("omits removed Blackjack modes and their exclusive actions", () => {
    expect(actionsForGame("blackjack")).toEqual([]);
    expect(actionsForGame("blackjack-duel")).toEqual([]);
    expect(findAction("place_bet", "blackjack-duel")).toBeUndefined();
    expect(getGameToolSchema("restart_game", "blackjack")).toEqual({
      error: 'Game type "blackjack" is currently unavailable.',
    });
    expect(() => listGameToolsCatalog("blackjack-duel")).toThrow("currently unavailable");
  });

  it("unknown action returns error", () => {
    const schema = getGameToolSchema("teleport", "connect4");
    expect(schema).toHaveProperty("error");
  });
});
