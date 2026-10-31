import { parseJevView } from "../../agents/jev";
import { describe, expect, it } from "vitest";
import { compactAgentDecisionState } from "@llmgames/game-catalog";
import { compactState } from "../../games/agent-decision";
import { battleshipExamples, documentationFleets } from "../fixtures/battleship";
import { BATTLESHIP_FLEET, cellsForShipSilhouette } from "../../durable-objects/types";
import { jevDecision } from "../../agents/jev";

describe("Battleship documentation contract", () => {
  it("exports deterministic real projections with every affordable weapon and radar history", async () => {
    const first = await battleshipExamples();
    const second = await battleshipExamples();
    const battle = compactState(first.battle)!;
    expect(battle).toEqual(compactState(second.battle));
    expect(battle).toMatchObject({
      munitionPoints: 7,
      radarScans: [{ row: 3, col: 3, shipCells: 2 }],
    });
    const decision = jevDecision(parseJevView(battle))!;
    expect(decision.state.ownGrid?.[9]?.[9]).toBe("m");
    expect(decision.state.radarScans).toEqual(battle.radarScans);
    expect(
      new Set(Object.values(decision.options).map((option) => option.action.actionType)),
    ).toEqual(new Set(["cannon", "mine", "radar", "bomb", "torpedo"]));
    expect(
      jevDecision(parseJevView(compactState(first.placement)), documentationFleets),
    ).not.toBeNull();
  });

  it("offers six distinct valid structured placement examples", () => {
    expect(new Set(documentationFleets.map((fleet) => JSON.stringify(fleet))).size).toBe(6);

    for (const fleet of documentationFleets) {
      const cells = fleet.flatMap((ship) =>
        cellsForShipSilhouette(
          ship.row,
          ship.col,
          BATTLESHIP_FLEET.find((spec) => spec.id === ship.id)!.shape,
          ship.rotation,
        ),
      );

      expect(cells).toHaveLength(22);
      expect(new Set(cells.map((cell) => `${cell.row},${cell.col}`)).size).toBe(22);
      expect(
        cells.every((cell) => cell.row >= 0 && cell.row < 10 && cell.col >= 0 && cell.col < 10),
      ).toBe(true);
    }
  });
});
