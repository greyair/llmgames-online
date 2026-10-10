import { z } from "zod";
import { SERIES_GAMES, type SeriesView } from "@llmgames/game-catalog";

const gameSchema = z.enum(SERIES_GAMES);

const configSchema = z.object({
  name: z.string(),
  rounds: z.array(
    z.object({
      gameType: gameSchema,
      repeats: z.number(),
      gameTotalTime: z.number(),
      turnTime: z.number(),
    }),
  ),
  firstSeat: z.enum(["alternate", "participant1", "participant2", "random"]),
  gapMs: z.number(),
  progression: z.enum(["automatic", "ready"]),
});

const participantSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["human", "agent"]),
  environmentLabel: z.string().optional(),
  modelLabel: z.string(),
  promptLabel: z.string(),
});

const resultSchema = z.object({
  index: z.number(),
  gameType: gameSchema,
  gameId: z.string(),
  firstParticipantId: z.string().nullable(),
  winnerId: z.string().nullable(),
  outcome: z.enum(["win", "draw", "aborted"]),
  reason: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  metrics: z.record(
    z.string(),
    z.object({ actions: z.number(), decisionMs: z.number(), timeouts: z.number() }),
  ),
});

export const seriesViewSchema = z.object({
  code: z.string(),
  config: configSchema,
  status: z.enum(["waiting", "preparing", "playing", "break", "completed", "cancelled", "failed"]),
  participants: z.array(participantSchema),
  results: z.array(resultSchema),
  currentMatch: z
    .object({
      index: z.number(),
      gameType: gameSchema,
      roomId: z.string(),
      roomCode: z.string(),
      firstParticipantId: z.string(),
      players: z.array(z.object({ participantId: z.string(), playerId: z.string() })),
      createdAt: z.number(),
    })
    .nullable(),
  nextAt: z.number().nullable(),
  ready: z.array(z.string()),
  totalMatches: z.number(),
  createdAt: z.number(),
  expiresAt: z.number(),
  error: z.string().optional(),
  isHost: z.boolean(),
  you: z.string().nullable(),
}) satisfies z.ZodType<SeriesView>;
