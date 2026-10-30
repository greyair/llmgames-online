import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BattleshipRoom } from "../../../durable-objects/BattleshipRoom";
import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";
import { roomTestEnv } from "../../fixtures/room-env";
import { buildTranscript } from "./battleshipScenario";
import { withSeededRandom } from "./battleshipTranscript";

/**
 * Regenerates `battleship.golden.ts`.
 *
 * Run on demand — `BATTLESHIP_CAPTURE=1 pnpm --filter @llmgames/workers test` —
 * after an intentional rule change. The committed golden came from the legacy
 * room, so regenerating it against the plugin room is only correct once the
 * change is deliberate and reviewed.
 *
 * It writes the file rather than comparing anything; the assertion below is just
 * a guard against an empty capture.
 */
const enabled = process.env.BATTLESHIP_CAPTURE === "1";

describe.skipIf(!enabled)("Battleship transcript capture", () => {
  it("writes the current transcript to the golden fixture", async () => {
    const transcript = await withSeededRandom(() =>
      buildTranscript({
        Room: BattleshipRoom,
        runtime: () => new MemoryRoomRuntime(new Map()),
        env: roomTestEnv(),
      }),
    );

    expect(transcript.steps.length).toBeGreaterThan(5);

    // Relative to the package root, which is vitest's working directory.
    writeFileSync(
      "src/tests/games/battleship/battleship.golden.json",
      JSON.stringify(transcript, null, 2),
    );
  });
});
