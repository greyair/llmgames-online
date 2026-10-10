import { wireObjectSchema } from "@llmgames/game-catalog";

import { z } from "zod";
import { describe, it, expect } from "vitest";
import { broadcastProjection } from "../../lib/broadcastProjection";

describe("sunken fleet broadcast projection", () => {
  it("preserves confirmed wrecks and fleet status while removing hidden positions and damage", () => {
    const spec = {
      id: "cruiser",
      name: "Cruiser",
      length: 5,
      "shape": [
        { dr: 0, dc: 0 },
        { dr: 0, dc: 1 },
      ],
    };

    const output = broadcastProjection(
      {
        type: "battleship",
        fleet: [spec],
        spectatorBoards: [
          {
            playerId: "account",
            shipsRemaining: 4,
            ships: [{ id: "carrier", row: 8, col: 1 }],
            cells: [["carrier"]],
            mines: [{ row: 0, col: 0 }],
            fleetStatus: [
              { ...spec, sunk: true },
              { id: "carrier", sunk: false, row: 8, col: 1, hits: 3 },
            ],
            sunkShips: [{ ...spec, row: 4, col: 3, rotation: 90, privateNote: "secret" }],
          },
        ],
      },
      [{ id: "account", name: "Alex" }],
    );

    expect(output).toMatchObject({
      fleet: [spec],
      spectatorBoards: [
        {
          playerId: "seat-1",
          shipsRemaining: 4,
          fleetStatus: [
            { id: "cruiser", sunk: true },
            { id: "carrier", sunk: false },
          ],
          sunkShips: [{ ...spec, row: 4, col: 3, rotation: 90 }],
        },
      ],
    });

    const board = z
      .object({ spectatorBoards: z.array(wireObjectSchema) })
      .passthrough()
      .parse(output).spectatorBoards[0]!;

    expect(board).not.toHaveProperty("ships");
    expect(board).not.toHaveProperty("cells");
    expect(board).not.toHaveProperty("mines");
    expect(z.array(wireObjectSchema).parse(board.fleetStatus)[1]).toEqual({
      id: "carrier",
      sunk: false,
    });
    expect(JSON.stringify(output)).not.toMatch(/account|secret|privateNote/);
  });
});
