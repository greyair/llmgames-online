import { describe, expect, it } from "vitest";

import { BattleshipRoom } from "../../../durable-objects/BattleshipRoom";
import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";
import { roomTestEnv } from "../../fixtures/room-env";
import { BATTLESHIP_GOLDEN } from "./battleship.golden";
import { buildTranscript } from "./battleshipScenario";
import { withSeededRandom } from "./battleshipTranscript";

/**
 * M3.5 — the migrated room must answer exactly like the pre-plugin one.
 *
 * The golden transcript was captured from the legacy implementation, so this
 * compares rules, refusals, audit events, per-seat fog and the replay document
 * in one shot. A difference here is a behaviour change, not a formatting one.
 */

describe("Battleship plugin equivalence", () => {
  it("reproduces the pre-plugin transcript", async () => {
    const transcript = await withSeededRandom(() =>
      buildTranscript({
        Room: BattleshipRoom,
        runtime: () => new MemoryRoomRuntime(new Map()),
        env: roomTestEnv(),
      }),
    );

    expect(transcript).toEqual(BATTLESHIP_GOLDEN);
  });
});
