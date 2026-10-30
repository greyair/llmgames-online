import { z } from "zod";

import { describe, expect, it, vi } from "vitest";

import { createGameRoomFixture } from "../../fixtures/game-room";
import { CheckersRoom, getCheckersLegalMoves } from "../../../durable-objects/CheckersRoom";
import type { CheckersCell, CheckersGameState } from "../../../durable-objects/types";
import {
  CHECKERS_GOLDEN,
  type CheckersTranscript,
  type CheckersTranscriptRejection,
  type CheckersTranscriptStep,
} from "./checkers.golden";

/**
 * M3.4 equivalence: the plugin-driven Checkers room must reproduce the
 * pre-migration transcript — opening, natural play, a forced jump chain,
 * crowning, a no-move finish, both draw rules, the timeout forfeit and the
 * match-clock draw, plus every refusal.
 */

const agentYouSchema = z.object({
  legalActions: z.array(z.string()),
});

const browserYouSchema = z.object({
  seat: z.number().nullable().optional(),
  color: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
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

type Fixture = Awaited<ReturnType<typeof createGameRoomFixture<CheckersGameState>>>;

function emptyBoard(): CheckersCell[][] {
  return Array.from({ length: 8 }, () => Array.from({ length: 8 }, (): CheckersCell => 0));
}

function seatOf(state: CheckersGameState, playerId: string | null): number | null {
  return playerId ? (state.seats[playerId] ?? null) : null;
}

async function captureStep(
  fixture: Fixture,
  label: string,
  note?: CheckersTranscriptStep["note"],
): Promise<CheckersTranscriptStep> {
  const state = fixture.state();
  const views: Array<CheckersTranscriptStep["views"][number]> = [];

  for (const playerId of fixture.ids) {
    const agent = agentYouSchema.parse(
      z.object({ you: agentYouSchema }).parse(await fixture.view(playerId)).you,
    );

    const browser = z.object({ you: browserYouSchema }).parse(fixture.room.browser(playerId)).you;

    views.push({
      seat: browser.seat ?? null,
      color: browser.color ?? null,
      role: browser.role ?? null,
      legalActions: agent.legalActions,
    });
  }

  views.sort((left, right) => String(left.seat).localeCompare(String(right.seat)));

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
    forcedPiece: state.forcedPiece,
    lastMove: state.lastMove,
    quietTurns: state.quietTurns,
    views,
  };
}

/** Replace the board and put seat 1 on move, like a resumed mid-game board. */
function begin(fixture: Fixture, board: CheckersCell[][], quietTurns = 0): void {
  const state = fixture.state();
  const scores: Record<1 | 2, number> = { 1: 0, 2: 0 };

  for (const row of board)
    for (const piece of row) {
      const seat = piece === 1 || piece === 3 ? 1 : piece === 2 || piece === 4 ? 2 : 0;

      if (seat) scores[seat]++;
    }

  state.board = board;
  state.scores = scores;
  state.legalMoves = getCheckersLegalMoves(board, 1);
  state.forcedPiece = null;
  state.quietTurns = quietTurns;
  state.lastMove = null;
  state.turnState.phase = "play";
  state.turnState.currentPlayerId = state.players.find((p) => state.seats[p.id] === 1)?.id ?? null;
}

async function postProbe(
  fixture: Fixture,
  label: string,
  playerId: string,
  actionType: string,
  data: Record<string, number>,
): Promise<CheckersTranscriptRejection> {
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

describe("Checkers plugin equivalence", () => {
  it("reproduces the pre-plugin transcript", async () => {
    // Seat order is a CSPRNG decision; zeros make seat 1 the host, as captured.
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
      const transcript: CheckersTranscript = { steps: [], rejections: [] };

      // A. natural play and refusals
      const natural = await createGameRoomFixture(CheckersRoom, "chk", 2);

      transcript.steps.push(await captureStep(natural, "start"));

      for (const index of [0, 1, 2, 3, 4, 5]) {
        const current = natural.state().turnState.currentPlayerId!;
        const move = natural.state().legalMoves[0]!;

        await natural.action(current, "move_checker", {
          fromRow: move.fromRow,
          fromCol: move.fromCol,
          row: move.row,
          col: move.col,
        });
        transcript.steps.push(
          await captureStep(natural, `natural:${index}`, {
            from: [move.fromRow, move.fromCol],
            to: [move.row, move.col],
          }),
        );
      }

      const current = natural.state().turnState.currentPlayerId!;
      const other = natural.ids.find((id) => id !== current)!;

      transcript.rejections.push(
        await postProbe(natural, "out-of-turn", other, "move_checker", {
          fromRow: 2,
          fromCol: 1,
          row: 3,
          col: 0,
        }),
        await postProbe(natural, "off-board", current, "move_checker", {
          fromRow: 8,
          fromCol: 1,
          row: 3,
          col: 0,
        }),
        await postProbe(natural, "negative", current, "move_checker", {
          fromRow: -1,
          fromCol: 1,
          row: 3,
          col: 0,
        }),
        await postProbe(natural, "fraction", current, "move_checker", {
          fromRow: 2.5,
          fromCol: 1,
          row: 3,
          col: 0,
        }),
        await postProbe(natural, "missing", current, "move_checker", {}),
        await postProbe(natural, "not-legal", current, "move_checker", {
          fromRow: 0,
          fromCol: 1,
          row: 1,
          col: 0,
        }),
        await postProbe(natural, "unknown-action", current, "teleport", {}),
      );

      // B. forced two-jump chain
      const chain = await createGameRoomFixture(CheckersRoom, "chk", 2);
      const chainBoard = emptyBoard();

      chainBoard[5]![2] = 1;
      chainBoard[4]![3] = 2;
      chainBoard[2]![3] = 2;
      chainBoard[0]![7] = 2;
      begin(chain, chainBoard);

      transcript.steps.push(await captureStep(chain, "chain:start"));
      await chain.action("chk-player-1", "move_checker", { fromRow: 5, fromCol: 2, row: 3, col: 4 });
      transcript.steps.push(await captureStep(chain, "chain:first-jump"));
      await chain.action("chk-player-1", "move_checker", { fromRow: 3, fromCol: 4, row: 1, col: 2 });
      transcript.steps.push(await captureStep(chain, "chain:second-jump"));

      // C. crowning ends the turn
      const crown = await createGameRoomFixture(CheckersRoom, "chk", 2);
      const crownBoard = emptyBoard();

      crownBoard[1]![2] = 1;
      crownBoard[0]![7] = 2;
      begin(crown, crownBoard);

      transcript.steps.push(await captureStep(crown, "crown:start"));
      await crown.action("chk-player-1", "move_checker", { fromRow: 1, fromCol: 2, row: 0, col: 1 });
      transcript.steps.push(await captureStep(crown, "crown:promoted"));

      // D. no legal move ends the match
      const stuck = await createGameRoomFixture(CheckersRoom, "chk", 2);
      const stuckBoard = emptyBoard();

      stuckBoard[3]![3] = 1;
      begin(stuck, stuckBoard);

      transcript.steps.push(await captureStep(stuck, "stuck:start"));
      await stuck.action("chk-player-1", "move_checker", { fromRow: 3, fromCol: 3, row: 2, col: 2 });
      transcript.steps.push(await captureStep(stuck, "stuck:ended"));

      // E. 80 king moves without progress
      const quiet = await createGameRoomFixture(CheckersRoom, "chk", 2);
      const quietBoard = emptyBoard();

      quietBoard[3]![3] = 3;
      quietBoard[0]![7] = 4;
      begin(quiet, quietBoard, 79);

      transcript.steps.push(await captureStep(quiet, "quiet:start"));
      await quiet.action("chk-player-1", "move_checker", { fromRow: 3, fromCol: 3, row: 4, col: 4 });
      transcript.steps.push(await captureStep(quiet, "quiet:draw"));

      // F. threefold repetition
      const repeat = await createGameRoomFixture(CheckersRoom, "chk", 2);
      const repeatBoard = emptyBoard();

      repeatBoard[5]![0] = 1;
      repeatBoard[0]![7] = 4;

      const afterMove = repeatBoard.map((row) => [...row]);

      afterMove[5]![0] = 0;
      afterMove[4]![1] = 1;
      begin(repeat, repeatBoard);
      repeat.state().positionCounts = { [`2:${afterMove.flat().join("")}`]: 2 };

      transcript.steps.push(await captureStep(repeat, "repeat:start"));
      await repeat.action("chk-player-1", "move_checker", { fromRow: 5, fromCol: 0, row: 4, col: 1 });
      transcript.steps.push(await captureStep(repeat, "repeat:draw"));

      // G. turn timeout forfeits the match
      const turnTimeout = await createGameRoomFixture(CheckersRoom, "chk", 2);
      const clock = Date.now();
      const now = vi.spyOn(Date, "now").mockReturnValue(clock + 152_000);

      try {
        await turnTimeout.room.alarm();
      } finally {
        now.mockRestore();
      }

      transcript.steps.push(await captureStep(turnTimeout, "turn-timeout"));

      // H. match clock expiry is a draw
      const matchTimeout = await createGameRoomFixture(CheckersRoom, "chk", 2);
      const matchClock = Date.now();

      matchTimeout.state().gameTimeRemaining = 1;

      const matchNow = vi.spyOn(Date, "now").mockReturnValue(matchClock + 120_000);

      try {
        await matchTimeout.room.alarm();
      } finally {
        matchNow.mockRestore();
      }

      transcript.steps.push(await captureStep(matchTimeout, "match-timeout"));

      expect(transcript).toEqual(CHECKERS_GOLDEN);
    } finally {
      random.mockRestore();
    }
  });
});
