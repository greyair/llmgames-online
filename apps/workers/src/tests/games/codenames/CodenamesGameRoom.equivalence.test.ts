import { describe, expect, it } from "vitest";

import { CodenamesGameRoom } from "../../../durable-objects/CodenamesGameRoom";
import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";
import { roomTestEnv } from "../../fixtures/room-env";
import { CODENAMES_GOLDEN } from "./codenames.golden";
import { buildTranscript } from "./codenamesScenario";
import { withSeededRandom } from "./codenamesTranscript";

/**
 * M3.6 — the migrated room must answer exactly like the pre-plugin one.
 *
 * The golden transcript came from the legacy implementation, so this compares
 * rules, refusals, audit events, the per-seat key visibility and the replay in
 * one shot. A difference here is a behaviour change, not a formatting one.
 */

describe("Codenames plugin equivalence", () => {
  it("reproduces the pre-plugin transcript", async () => {
    const transcript = await withSeededRandom(() =>
      buildTranscript({
        Room: CodenamesGameRoom,
        runtime: () => new MemoryRoomRuntime(new Map()),
        env: roomTestEnv(),
      }),
    );

    expect(transcript).toEqual(CODENAMES_GOLDEN);
  });
});
