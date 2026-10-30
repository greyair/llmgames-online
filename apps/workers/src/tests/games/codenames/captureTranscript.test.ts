import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CodenamesGameRoom } from "../../../durable-objects/CodenamesGameRoom";
import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";
import { roomTestEnv } from "../../fixtures/room-env";
import { buildTranscript } from "./codenamesScenario";
import { withSeededRandom } from "./codenamesTranscript";

/**
 * Regenerates `codenames.golden.ts`.
 *
 * Run on demand — `CODENAMES_CAPTURE=1 pnpm --filter @llmgames/workers test` —
 * after an intentional rule change. The committed golden came from the legacy
 * room, so regenerating it against the plugin room is only correct once the
 * change is deliberate and reviewed.
 */
const enabled = process.env.CODENAMES_CAPTURE === "1";

describe.skipIf(!enabled)("Codenames transcript capture", () => {
  it("writes the current transcript to the golden fixture", async () => {
    const transcript = await withSeededRandom(() =>
      buildTranscript({
        Room: CodenamesGameRoom,
        runtime: () => new MemoryRoomRuntime(new Map()),
        env: roomTestEnv(),
      }),
    );

    expect(transcript.steps.length).toBeGreaterThan(5);

    // Relative to the package root, which is vitest's working directory.
    writeFileSync(
      "src/tests/games/codenames/codenames.golden.json",
      JSON.stringify(transcript, null, 2),
    );
  });
});
