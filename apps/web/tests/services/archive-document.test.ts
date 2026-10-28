import { describe, expect, it } from "vitest";
import { gameLogDocumentSchema } from "@llmgames/game-catalog";

const rewatch = {
  version: 1,
  visibility: "full_reveal",
  gameType: "reversi",
  truncated: false,
  frames: [{ index: 0, at: 4_000, label: "game_ended", state: { board: [] } }],
};

/** Shape produced by buildCompletedGameArchive: `name` plus optional agent fields. */
const archivedDocument = {
  version: 1 as const,
  gameId: "game-123",
  gameType: "reversi",
  startedAt: 1_000,
  endedAt: 4_000,
  endReason: "reversi",
  winner: "p1",
  participants: [
    { ref: "p1", name: "SlyAnvil", isAgent: true, codename: "SlyAnvil" },
    { ref: "p2", name: "Mika", isAgent: false },
  ],
  events: [
    { seq: 1, at: 1_000, type: "game_started" },
    { seq: 2, at: 4_000, type: "game_ended", summary: { reason: "reversi" } },
  ],
  rewatch,
};

describe("archived game log document", () => {
  it("accepts the document the archive writer produces", () => {
    const parsed = gameLogDocumentSchema.safeParse(archivedDocument);

    expect(parsed.success).toBe(true);
  });

  it("accepts older archives that spell the optional fields as null", () => {
    const parsed = gameLogDocumentSchema.safeParse({
      ...archivedDocument,
      participants: [
        {
          ref: "p1",
          name: "SlyAnvil",
          isAgent: false,
          codename: null,
          environmentLabel: null,
          ownerGamertag: null,
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("keeps the summary contract and the archive contract separate", () => {
    // D1 summary rows use displayName; an archive document never does.
    const d1SummaryDocument = {
      ...archivedDocument,
      participants: [
        {
          ref: "p1",
          isAgent: false,
          codename: null,
          environmentLabel: null,
          displayName: "SlyAnvil",
          ownerGamertag: null,
        },
      ],
    };

    expect(gameLogDocumentSchema.safeParse(d1SummaryDocument).success).toBe(false);
  });
});
