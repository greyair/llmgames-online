import { testEnv } from "../fixtures/env";
import { parseJevView } from "../../agents/jev";
import { wireObjectSchema } from "@llmgames/game-catalog";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jevDecision, chooseJev } from "../../agents/jev";
import { generateJevFleets } from "../../agents/jevBattleship";
import { BATTLESHIP_FLEET, cellsForShipSilhouette } from "../../durable-objects/types";

function battle() {
  return {
    gameType: "battleship",
    status: "playing",
    phase: "battle",
    fleetReady: true,
    legalActions: ["cannon", "bomb", "radar", "mine", "torpedo"],
    munitionPoints: 7,
    targetGrid: Array<string>(10).fill(".........."),
    ownGrid: Array.from({ length: 10 }, (_, row): string =>
      row === 5 ? ".....m...." : row === 6 ? "......o..." : row === 4 ? "....x....." : "..........",
    ),
    gameTimeRemaining: 600000,
    turnTimeRemaining: 30000,
    radarScans: [{ row: 2, col: 2, shipCells: 3 }],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Jev Battleship candidates", () => {
  it("generates six complete, non-overlapping fleets and preserves their choices across reads", () => {
    const fleets = generateJevFleets();
    expect(fleets).toHaveLength(6);

    for (const fleet of fleets) {
      expect(fleet.map((s) => s.id)).toEqual(BATTLESHIP_FLEET.map((s) => s.id));
      const occupied = new Set<string>();

      for (const ship of fleet)
        for (const c of cellsForShipSilhouette(
          ship.row,
          ship.col,
          BATTLESHIP_FLEET.find((s) => s.id === ship.id)!.shape,
          ship.rotation,
        )) {
          expect(c.row).toBeGreaterThanOrEqual(0);
          expect(c.row).toBeLessThan(10);
          expect(c.col).toBeGreaterThanOrEqual(0);
          expect(c.col).toBeLessThan(10);
          expect(occupied.has(`${c.row},${c.col}`)).toBe(false);
          occupied.add(`${c.row},${c.col}`);
        }

      expect(occupied.size).toBe(22);
    }

    const input = {
      ...battle(),
      phase: "placement",
      fleetReady: false,
      legalActions: ["place_fleet"],
    };

    expect(jevDecision(parseJevView(input), fleets)).toEqual(
      jevDecision(parseJevView(input), structuredClone(fleets)),
    );
    expect(Object.keys(jevDecision(parseJevView(input), fleets)!.options)).toHaveLength(6);
    expect(jevDecision(parseJevView(input), fleets)!.options.fleet_1!.description).toEqual({
      ships: fleets[0],
    });
    expect(jevDecision(parseJevView({ ...input, fleetReady: true }), fleets)).toBeNull();
  });

  it("excludes attacked cells, spent bomb zones, blocked torpedo rays and invalid mines", () => {
    const input = battle();
    input.targetGrid[0] = "xx........";
    input.targetGrid[1] = "oo........";
    input.ownGrid[0] = "s.........";
    const options = jevDecision(parseJevView(input))!.options;
    expect(options).not.toHaveProperty("cannon_0_0");
    expect(options).not.toHaveProperty("bomb_0_0");
    expect(options).not.toHaveProperty("bomb_9_9");
    expect(options).not.toHaveProperty("torpedo_0_0_s");
    expect(options).not.toHaveProperty("torpedo_0_0_e");

    for (const id of ["mine_0_0", "mine_5_5", "mine_6_6", "mine_4_4"])
      expect(options).not.toHaveProperty(id);
    expect(options).toHaveProperty("bomb_0_1");
    expect(options).toHaveProperty("torpedo_9_0_n");
    expect(options).toHaveProperty("radar_0_0");
    expect(options).toHaveProperty("mine_9_9");
    const cheap = jevDecision(parseJevView({ ...input, munitionPoints: 0 }))!.options;
    expect(Object.values(cheap).every((o) => o.action.actionType === "cannon")).toBe(true);
    expect(jevDecision(parseJevView({ ...input, legalActions: ["leave"] }))).toBeNull();
  });

  it("fits every weapon target in the existing request limit and maps responses exactly", async () => {
    const input = battle();
    const decision = jevDecision(parseJevView(input))!;
    expect(Object.keys(decision.options).length).toBeGreaterThan(400);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        expect(new TextEncoder().encode(String(init.body)).length).toBeLessThan(30000);
        const body = JSON.parse(String(init.body));
        expect(body.state).toMatchObject({
          ownGrid: input.ownGrid,
          gameTimeRemaining: 600000,
          turnTimeRemaining: 30000,
          radarScans: input.radarScans,
        });
        expect(body.state.fleet[0]).not.toHaveProperty("name");

        for (const q of Object.values(body.questions))
          expect(
            Object.keys(z.object({ criteria: wireObjectSchema }).passthrough().parse(q).criteria)
              .length,
          ).toBeLessThanOrEqual(255);

        return Response.json({
          answers: {
            move: { type: "choice", choice: "torpedo" },
            target_torpedo: { type: "choice", choice: "torpedo_9_9_w" },
          },
        });
      }),
    );
    expect(await chooseJev(testEnv({ TYPESAFE_API_KEY: "test-key" }), decision)).toEqual({
      actionType: "torpedo",
      data: { row: 9, col: 9, direction: "w" },
    });
  });
});
