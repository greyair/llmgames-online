import { describe, expect, it } from "vitest";
import { clientViewSchema } from "../../src/domain/game-state";
import { parseRewatch } from "../../src/features/replay/rewatchPayload";

function archive<T>(gameType: string, state: T) {
  return {
    version: 1,
    visibility: "full_reveal",
    gameType,
    frames: [{ index: 0, at: 1234, label: "turn", state }],
  };
}

describe("projected state contracts", () => {
  it("retains every server-assigned player role and rejects unsupported roles", () => {
    const roles = [
      ["connect4", "player1"],
      ["connect4", "player2"],
      ["reversi", "black"],
      ["reversi", "white"],
      ["poker", "player"],
      ["battleship", "captain"],
      ["codenames", "spymaster"],
      ["codenames", "operative"],
      ["checkers", "spectator"],
      ["connect4", null],
    ];

    for (const [type, role] of roles) {
      const projection = { type, status: "playing", you: { role } };
      expect(clientViewSchema.parse(projection)).toBe(projection);
    }

    expect(clientViewSchema.safeParse({ you: { role: "administrator" } }).success).toBe(false);
  });

  it("retains the source square and capture coordinates of a checker decision", () => {
    const move = { fromRow: 5, fromCol: 0, row: 3, col: 2, capture: { row: 4, col: 1 } };

    const projection = {
      type: "checkers",
      status: "playing",
      legalMoves: [move],
      forcedPiece: { row: 3, col: 2 },
    };

    const view = clientViewSchema.parse(projection);

    expect(view.legalMoves).toEqual([move]);
    expect(view.forcedPiece).toEqual(projection.forcedPiece);
    expect(
      parseRewatch(archive("checkers", projection), "checkers")?.frames[0]?.state.legalMoves,
    ).toEqual([move]);
  });

  it("accepts a Battleship spectator projection with null private boards and announcement", () => {
    const projection = {
      type: "battleship",
      status: "playing",
      yourBoard: null,
      opponent: null,
      lastAnnouncement: null,
    };

    expect(clientViewSchema.parse(projection)).toEqual(projection);
    expect(parseRewatch(archive("battleship", projection), "battleship")?.frames[0]?.state).toEqual(
      projection,
    );
  });

  it("accepts and retains HP in the original-generation Pokemon stat table", () => {
    const projection = {
      type: "pokemon",
      status: "playing",
      sides: [
        {
          seat: "p1",
          pokemon: [
            {
              name: "Charizard",
              stats: { hp: 300, atk: 210, def: 190, spa: 240, spd: 240, spe: 250 },
            },
          ],
        },
      ],
    };

    expect(clientViewSchema.parse(projection).sides).toEqual(projection.sides);
    expect(parseRewatch(archive("pokemon", projection), "pokemon")?.frames[0]?.state.sides).toEqual(
      projection.sides,
    );
  });

  it("keeps new public fields at every depth in a validated replay frame", () => {
    const projection = {
      type: "pokemon",
      status: "playing",
      publicRound: { number: 3 },
      sides: [
        {
          seat: "p1",
          pokemon: [
            {
              name: "Charizard",
              publicLabel: { text: "Captain", color: "red" },
            },
          ],
        },
      ],
    };

    expect(clientViewSchema.parse(projection)).toBe(projection);
    expect(parseRewatch(archive("pokemon", projection), "pokemon")?.frames[0]?.state).toEqual(
      projection,
    );
    expect(clientViewSchema.safeParse({ ...projection, unsafePublicValue: () => {} }).success).toBe(
      false,
    );
  });
});
