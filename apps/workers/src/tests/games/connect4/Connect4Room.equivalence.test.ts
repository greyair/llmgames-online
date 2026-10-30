import { z } from "zod";

import { describe, expect, it, vi } from "vitest";

import { createGameRoomFixture } from "../../fixtures/game-room";
import { Connect4Room } from "../../../durable-objects/Connect4Room";
import type { Connect4GameState } from "../../../durable-objects/types";
import {
  CONNECT4_GOLDEN,
  type Connect4Transcript,
  type Connect4TranscriptRejection,
  type Connect4TranscriptStep,
} from "./connect4.golden";

/**
 * M3.2 equivalence: the plugin-driven room must reproduce the pre-plugin
 * transcript exactly — board, turn order, current seat, result, per-seat legal
 * actions and every refusal message — for the same intent sequence.
 *
 * `connect4.golden.ts` was captured from the M2 implementation before the
 * migration, so this test fails if the plugin changes any observable rule.
 */

const youSchema = z.object({
  role: z.string().nullable(),
  legalActions: z.array(z.string()),
});

const rejectionSchema = z.object({
  ok: z.boolean().optional(),
  error: z
    .object({
      message: z.string(),
      code: z.string().optional(),
      actionType: z.string().optional(),
      category: z.string().optional(),
      recovery: z.string().optional(),
    })
    .optional(),
});

type Fixture = Awaited<ReturnType<typeof createGameRoomFixture<Connect4GameState>>>;

function seatOf(state: Connect4GameState, playerId: string | null): number | null {
  return playerId ? (state.seats[playerId] ?? null) : null;
}

/** Room-scoped player id that holds a seat; rooms assign seats from the CSPRNG. */
function playerInSeat(fixture: Fixture, seat: number): string | null {
  const { seats } = fixture.state();

  return fixture.ids.find((id) => seats[id] === seat) ?? null;
}

async function captureStep(fixture: Fixture, label: string): Promise<Connect4TranscriptStep> {
  const state = fixture.state();
  const views: Array<{ role: string | null; legalActions: readonly string[] }> = [];

  for (const playerId of fixture.ids) {
    const view = youSchema.parse(
      z.object({ you: youSchema }).parse(await fixture.view(playerId)).you,
    );

    views.push({ role: view.role, legalActions: view.legalActions });
  }

  // Seat order is a platform CSPRNG decision; the transcript compares each
  // seat's own view, so order the two views by seat role instead of join order.
  views.sort((left, right) => String(left.role).localeCompare(String(right.role)));

  return {
    label,
    board: state.board.map((row) => row.join("")),
    status: state.status,
    phase: state.turnState.phase,
    turnNumber: state.turnState.turnNumber,
    currentSeat: seatOf(state, state.turnState.currentPlayerId),
    winner: state.winner === "draw" ? "draw" : seatOf(state, state.winner),
    lastMove: state.lastMove,
    views,
  };
}

async function postProbe(
  fixture: Fixture,
  label: string,
  playerId: string,
  actionType: string,
  data: Record<string, string | number>,
): Promise<Connect4TranscriptRejection> {
  const response = await fixture.room.fetch(
    new Request("https://fixture.invalid/agent/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId, actionType, data }),
    }),
  );

  const parsed = rejectionSchema.parse(await response.json());

  return { label, status: response.status, ok: parsed.ok, error: parsed.error };
}

describe("Connect 4 plugin equivalence", () => {
  it("reproduces the pre-plugin transcript for the same intents", async () => {
    // Seat order comes from the CSPRNG. Zero-filled entropy makes the first
    // player index 0, which is what the golden capture saw, so seat 1's board is
    // compared against seat 1's board instead of a random coin flip.
    const random = vi.spyOn(crypto, "getRandomValues");

    random.mockImplementation(
      // SAFETY: the room only asks for a Uint32Array and reads it back; zeros are
      // a valid getRandomValues result, so returning the same buffer keeps the
      // platform contract and only removes randomness from this comparison.
      ((buffer: Uint32Array) => {
        buffer.fill(0);

        return buffer;
      }) as typeof crypto.getRandomValues,
    );

    try {
      const fixture = await createGameRoomFixture(Connect4Room, "c4", 2);

      const transcript: Connect4Transcript = { steps: [], rejections: [] };

      transcript.steps.push(await captureStep(fixture, "start"));

      const sequence: ReadonlyArray<readonly [number, number]> = [
        [1, 0],
        [2, 0],
        [1, 1],
        [2, 1],
        [1, 2],
        [2, 2],
        [1, 3],
      ];

      for (const [seat, col] of sequence) {
        const playerId = playerInSeat(fixture, seat);

        expect(playerId).not.toBeNull();
        await fixture.action(playerId!, "drop_disc", { col });
        transcript.steps.push(await captureStep(fixture, `seat${seat}:col${col}`));
      }

      transcript.rejections.push(
        await postProbe(fixture, "ended:extra-move", fixture.ids[0]!, "drop_disc", { col: 4 }),
      );

      const second = await createGameRoomFixture(Connect4Room, "c4b", 2);

      transcript.rejections.push(
        await postProbe(second, "legacy:out-of-turn", playerInSeat(second, 2)!, "drop_disc", { col: 0 }),
        await postProbe(second, "legacy:column-7", playerInSeat(second, 1)!, "drop_disc", { col: 7 }),
        await postProbe(second, "legacy:column-99", playerInSeat(second, 1)!, "drop_disc", { col: 99 }),
        await postProbe(second, "legacy:float", playerInSeat(second, 1)!, "drop_disc", { col: 1.5 }),
        await postProbe(second, "legacy:missing-data", playerInSeat(second, 1)!, "drop_disc", {}),
        await postProbe(second, "legacy:unknown-action", playerInSeat(second, 1)!, "teleport", {}),
        await postProbe(second, "legacy:alias-drop", playerInSeat(second, 1)!, "drop", { col: 0 }),
        await postProbe(second, "legacy:alias-column", playerInSeat(second, 1)!, "drop_disc", {
          column: 1,
        }),
      );

      for (;;) {
        const current = second.state().turnState.currentPlayerId!;

        const response = await second.room.fetch(
          new Request("https://fixture.invalid/agent/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ playerId: current, actionType: "drop_disc", data: { col: 0 } }),
          }),
        );

        if (!response.ok) break;
      }

      transcript.rejections.push(
        await postProbe(second, "legacy:full-column", playerInSeat(second, 1)!, "drop_disc", { col: 0 }),
      );

      expect(transcript).toEqual(CONNECT4_GOLDEN);
    } finally {
      random.mockRestore();
    }
  });
});
