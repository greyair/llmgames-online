import { z } from "zod";

import { describe, expect, it, vi } from "vitest";

import { createGameRoomFixture } from "../../fixtures/game-room";
import { ReversiRoom } from "../../../durable-objects/ReversiRoom";
import type { ReversiCell, ReversiGameState } from "../../../durable-objects/types";
import {
  REVERSI_GOLDEN,
  type ReversiTranscript,
  type ReversiTranscriptRejection,
  type ReversiTranscriptStep,
} from "./reversi.golden";

/**
 * M3.3 equivalence: the plugin-driven Reversi room must reproduce the
 * pre-migration transcript exactly — board, disc counts, turn order, legal
 * moves, forced passes, the scoring finish, the match-clock result, per-seat
 * role and every refusal message.
 */

const youSchema = z.object({
  role: z.string().nullable(),
  color: z.string().nullable().optional(),
  legalActions: z.array(z.string()),
});

const rejectionSchema = z.object({
  ok: z.boolean().optional(),
  error: z
    .object({
      message: z.string(),
      code: z.string().optional(),
      category: z.string().optional(),
      actionType: z.string().optional(),
      recovery: z.string().optional(),
    })
    .optional(),
});

type Fixture = Awaited<ReturnType<typeof createGameRoomFixture<ReversiGameState>>>;

function boardFrom(rows: readonly string[]): ReversiCell[][] {
  return rows.map((row) =>
    [...row].map((cell): ReversiCell => (cell === "1" ? 1 : cell === "2" ? 2 : 0)),
  );
}

function seatOf(state: ReversiGameState, playerId: string | null): number | null {
  return playerId ? (state.seats[playerId] ?? null) : null;
}

async function captureStep(
  fixture: Fixture,
  label: string,
  note: ReversiTranscriptStep["note"],
): Promise<ReversiTranscriptStep> {
  const state = fixture.state();
  const views: Array<{ role: string | null; color: string | null; legalActions: readonly string[] }> = [];

  for (const playerId of fixture.ids) {
    const view = youSchema.parse(
      z.object({ you: youSchema }).parse(await fixture.view(playerId)).you,
    );

    views.push({ role: view.role, color: view.color ?? null, legalActions: view.legalActions });
  }

  views.sort((left, right) => String(left.role).localeCompare(String(right.role)));

  return {
    label,
    note,
    board: state.board.map((row) => row.join("")),
    scores: state.scores,
    status: state.status,
    phase: state.turnState.phase,
    turnNumber: state.turnState.turnNumber,
    currentSeat: seatOf(state, state.turnState.currentPlayerId),
    winner: state.winner === "draw" ? "draw" : seatOf(state, state.winner),
    legalMoves: state.legalMoves,
    lastMove: state.lastMove,
    lastPass: state.lastPass ? { seat: state.lastPass.seat, turn: state.lastPass.turn } : null,
    views,
  };
}

async function postProbe(
  fixture: Fixture,
  label: string,
  playerId: string,
  actionType: string,
  data: Record<string, number>,
): Promise<ReversiTranscriptRejection> {
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

describe("Reversi plugin equivalence", () => {
  it("reproduces the pre-plugin transcript", async () => {
    // Seat order is a CSPRNG decision; zeros make the first player index 0,
    // matching the capture, so seat 1's board is compared with seat 1's board.
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
      const fixture = await createGameRoomFixture(ReversiRoom, "rev", 2);
      const transcript: ReversiTranscript = { steps: [], rejections: [] };

      transcript.steps.push(await captureStep(fixture, "start", undefined));

      for (const index of [0, 1, 2, 3, 4, 5]) {
        const current = fixture.state().turnState.currentPlayerId!;
        const move = fixture.state().legalMoves[0]!;

        await fixture.action(current, "place_disc", { row: move.row, col: move.col });
        transcript.steps.push(
          await captureStep(fixture, `natural:${index}:seat${seatOf(fixture.state(), current)}`, {
            row: move.row,
            col: move.col,
          }),
        );
      }

      const current = fixture.state().turnState.currentPlayerId!;
      const other = fixture.ids.find((id) => id !== current)!;

      transcript.rejections.push(
        await postProbe(fixture, "out-of-turn", other, "place_disc", { row: 2, col: 3 }),
        await postProbe(fixture, "off-board", current, "place_disc", { row: 8, col: 0 }),
        await postProbe(fixture, "negative", current, "place_disc", { row: -1, col: 0 }),
        await postProbe(fixture, "fraction", current, "place_disc", { row: 2.5, col: 3 }),
        await postProbe(fixture, "missing", current, "place_disc", {}),
        await postProbe(fixture, "occupied", current, "place_disc", { row: 3, col: 3 }),
        await postProbe(fixture, "not-bracketing", current, "place_disc", { row: 0, col: 0 }),
        await postProbe(fixture, "unknown-action", current, "teleport", {}),
      );

      // Forced pass, then a scoring finish, on a crafted board.
      fixture.state().board = boardFrom([
        "02111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111120",
      ]);
      fixture.state().legalMoves = [{ row: 0, col: 0, flipCount: 1 }];
      fixture.state().turnState.phase = "play";

      const first = fixture.state().turnState.currentPlayerId!;

      await fixture.action(first, "place_disc", { row: 0, col: 0 });
      transcript.steps.push(
        await captureStep(fixture, "crafted:pass", { playedBy: seatOf(fixture.state(), first) }),
      );

      await fixture.action(first, "place_disc", { row: 7, col: 7 });
      transcript.steps.push(
        await captureStep(fixture, "crafted:finish", { playedBy: seatOf(fixture.state(), first) }),
      );

      // Match-clock expiry decides by disc count.
      const timed = await createGameRoomFixture(ReversiRoom, "revt", 2);
      const clock = Date.now();

      timed.state().board = boardFrom([
        "11111111",
        "11111111",
        "11111112",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
      ]);
      timed.state().gameTimeRemaining = 1;

      const now = vi.spyOn(Date, "now").mockReturnValue(clock + 120_000);

      try {
        await timed.room.alarm();
      } finally {
        now.mockRestore();
      }

      const timedState = timed.state();

      const timedSeat = (playerId: string | null) =>
        playerId ? (timedState.seats[playerId] ?? null) : null;

      transcript.steps.push({
        label: "match-timeout",
        note: null,
        board: timedState.board.map((row) => row.join("")),
        scores: timedState.scores,
        status: timedState.status,
        phase: timedState.turnState.phase,
        turnNumber: timedState.turnState.turnNumber,
        currentSeat: null,
        winner: timedState.winner === "draw" ? "draw" : timedSeat(timedState.winner),
        legalMoves: timedState.legalMoves,
        lastMove: timedState.lastMove,
        lastPass: null,
        views: [],
      });

      expect(transcript).toEqual(REVERSI_GOLDEN);
    } finally {
      random.mockRestore();
    }
  });
});
