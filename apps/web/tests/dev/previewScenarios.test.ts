import { contextoProgressSchema, wordBoardSchema } from "../../src/domain/view-contracts";

import { describe, expect, it } from "vitest";
import { previewScreens, previewStates } from "../../src/dev/previewCatalog";
import { fixture } from "../../src/dev/previewFixtures";
import { applyPreviewScenario } from "../../src/dev/previewScenarios";

describe("published preview scenarios", () => {
  for (const { id } of previewScreens.filter((s) => s.id !== "library")) {
    for (const scenario of previewStates(id)) {
      it(`${id}: ${scenario} is an independent serializable fixture`, () => {
        const base = fixture(id === "setup" ? "connect4" : id);
        const original = JSON.stringify(base);
        const state = applyPreviewScenario(base, id, scenario);
        expect(JSON.stringify(base)).toBe(original);
        expect(JSON.parse(JSON.stringify(state))).toHaveProperty("turnState.phase");
        expect(state.players?.length).toBeGreaterThan(0);

        if (["waiting", "spectator", "spectator-ended", "lobby-spectator"].includes(scenario)) {
          expect(state.you?.isYourTurn).toBe(false);
          expect(state.you?.legalActions).toEqual([]);
        }
      });
    }
  }

  it("only the spymaster fixture contains the unrevealed key", () => {
    const base = fixture("codenames");
    const operative = applyPreviewScenario(base, "codenames", "playing");
    const spy = applyPreviewScenario(base, "codenames", "clue");
    expect(
      wordBoardSchema
        .parse(operative.board)
        .filter((c) => !c.revealed)
        .every((c) => c.affiliation === null),
    ).toBe(true);
    expect(wordBoardSchema.parse(spy.board).every((c) => c.affiliation)).toBe(true);
    expect(spy.you?.legalActions).toEqual(["give_clue"]);
  });
  it("forced replacement has switches but no attacks", () => {
    const state = applyPreviewScenario(fixture("pokemon"), "pokemon", "forced-switch");
    expect(state.decision).toMatchObject({ forceSwitch: true, moves: [] });
    expect(state.you?.legalActions).toEqual(["pokemon_switch"]);
  });
  it("spectating poker masks every player's hole cards", () => {
    const state = applyPreviewScenario(fixture("poker"), "poker", "spectator");

    if (!Array.isArray(state.seats)) throw new Error("Expected poker seats");
    expect(state.seats).toHaveLength(6);

    for (const seat of state.seats) {
      expect(seat.hole).toHaveLength(2);
      expect(seat.hole?.every((card) => card.hidden === true && card.rank === "?")).toBe(true);
    }
  });

  it("spectating a naval match contains only public boards", () => {
    const state = applyPreviewScenario(fixture("battleship"), "battleship", "spectator");
    expect(state.yourBoard).toBeNull();
    expect(state.spectatorBoards).toHaveLength(2);
    expect(JSON.stringify(state.spectatorBoards)).not.toContain("cells");
    expect(state.you?.isHost).toBe(false);
  });

  it("masks every Contexto entry for spectators", () => {
    const state = applyPreviewScenario(fixture("contexto"), "contexto", "spectator");
    const serialized = JSON.stringify(state.progress);
    expect(serialized).not.toContain("water");

    for (const entry of Object.values(contextoProgressSchema.parse(state.progress))) {
      expect(entry.guesses.every((guess) => !("word" in guess) && guess.masked === true)).toBe(
        true,
      );
    }
  });

  it("reveals Contexto entries only in the public broadcast fixture", () => {
    const spectator = applyPreviewScenario(fixture("contexto"), "contexto", "spectator");
    const broadcast = applyPreviewScenario(spectator, "contexto", "broadcast");
    expect(broadcast.broadcastPublic).toBe(true);
    expect(JSON.stringify(broadcast.progress)).toContain('"word"');
  });

  it("shows the final available guess in the Contexto near-limit preview", () => {
    const state = applyPreviewScenario(fixture("contexto"), "contexto", "near-limit");

    const own = contextoProgressSchema.parse(state.progress)[state.you!.playerId!];

    expect(own).toMatchObject({ guessCount: 49, guessesRemaining: 1, exhausted: false });
  });

  it("includes inline alias and rejected-word feedback states", () => {
    const aliased = applyPreviewScenario(fixture("contexto"), "contexto", "aliased-guess");
    const rejected = applyPreviewScenario(fixture("contexto"), "contexto", "not-in-pool");
    const playerId = aliased.you!.playerId!;
    expect(contextoProgressSchema.parse(aliased.progress)[playerId]?.lastAttempt).toEqual({
      submittedWord: "examination",
      canonicalWord: "exam",
      status: "aliased",
      rank: 42,
    });
    expect(contextoProgressSchema.parse(rejected.progress)[playerId]?.lastAttempt).toEqual({
      submittedWord: "neighborhood",
      status: "not_in_pool",
    });
  });
});
