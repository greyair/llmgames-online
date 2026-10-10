import { z } from "zod";
import { wireObjectSchema, jsonValueSchema } from "@llmgames/game-catalog";

export const providerRequestSchema = z.object({
  model: z.literal("jev-latest"),
  state: wireObjectSchema,
  questions: z.record(
    z.string(),
    z.object({
      type: z.literal("choice"),
      instructions: z.string(),
      criteria: z.record(z.string(), jsonValueSchema),
    }),
  ),
});

export type ProviderRequest = z.output<typeof providerRequestSchema>;
