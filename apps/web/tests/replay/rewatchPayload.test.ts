import { describe, expect, it } from "vitest";
import { parseRewatch, readOnlyReplayState } from "../../src/features/replay/rewatchPayload";

function validPayload() {
  return {
    version: 1,
    visibility: "full_reveal",
    gameType: "reversi",
    truncated: true,
    frames: [
      {
        index: 0,
        at: 1_234,
        label: "game_started",
        state: {
          status: "playing",
          players: [{ id: "p1", name: "Agent One" }],
          you: {
            playerId: "p1",
            isHost: true,
            isYourTurn: true,
            isSpectator: true,
            legalActions: ["place_disc"],
          },
        },
      },
    ],
  };
}

describe("Rewatch payload parsing", () => {
  it("accepts a matching full-reveal archive", () => {
    const parsed = parseRewatch(validPayload(), "reversi");

    expect(parsed?.gameType).toBe("reversi");
    expect(parsed?.frames).toHaveLength(1);
    expect(parsed?.truncated).toBe(true);
    expect(parsed?.frames[0]?.state.status).toBe("playing");
  });

  it("rejects mismatched games, empty archives, and malformed frames", () => {
    expect(parseRewatch(validPayload(), "poker")).toBeNull();
    expect(parseRewatch({ ...validPayload(), frames: [] }, "reversi")).toBeNull();
    expect(
      parseRewatch(
        {
          ...validPayload(),
          frames: [{ index: 0, at: Number.NaN, label: "turn", state: {} }],
        },
        "reversi",
      ),
    ).toBeNull();
    expect(
      parseRewatch(
        {
          ...validPayload(),
          frames: [{ index: 0, at: 1, label: "turn", state: { players: {} } }],
        },
        "reversi",
      ),
    ).toBeNull();
  });

  it("makes archived frames non-interactive without mutating the archive", () => {
    const parsed = parseRewatch(validPayload(), "reversi");
    const original = parsed?.frames[0]?.state;
    expect(original).toBeDefined();

    const readOnly = readOnlyReplayState(original!);

    expect(readOnly.replayReadOnly).toBe(true);
    expect(readOnly.you).toMatchObject({
      isHost: false,
      isYourTurn: false,
      isSpectator: false,
      legalActions: [],
    });
    expect(readOnly.you).not.toHaveProperty("playerId");
    expect(readOnly.replayPerspectivePlayerId).toBe("p1");
    expect(original?.you).toMatchObject({
      isHost: true,
      isYourTurn: true,
      isSpectator: true,
      legalActions: ["place_disc"],
    });
  });
});
