import { z } from "zod";
import { wireValueSchema } from "@llmgames/game-catalog";

export const playerSchema = z.object({ id: z.string(), name: z.string().optional() }).passthrough();

export const projectedStateSchema = z
  .object({
    players: z.array(playerSchema),
    status: z.string(),
    turnState: z
      .object({
        currentPlayerId: z.string().nullable(),
        turnNumber: z.number(),
        phase: z.string(),
        turnTimeRemaining: z.number(),
      })
      .passthrough(),
    you: z
      .object({
        playerId: z.string().optional(),
        isHost: z.boolean().optional(),
        isSpectator: z.boolean().optional(),
        isYourTurn: z.boolean().optional(),
        legalActions: z.array(z.string()),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const actionErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    category: z.string(),
    message: z.string(),
    actionType: z.string(),
    recovery: z.string(),
  }),
  state: projectedStateSchema.nullable(),
  legalActions: z.array(z.string()),
});

export const socketMessageSchema = z
  .object({
    type: z.string(),
    payload: z
      .object({
        requestId: z.string().optional(),
        ok: z.boolean().optional(),
        state: wireValueSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const rewatchSchema = z.object({
  version: z.literal(1),
  visibility: z.literal("full_reveal"),
  gameType: z.string(),
  truncated: z.boolean(),
  frames: z.array(
    z.object({ index: z.number(), at: z.number(), label: z.string(), state: wireValueSchema }),
  ),
});
