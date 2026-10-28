import { z } from "zod";
import { wireValueSchema } from "./value-contracts.js";

/**
 * Wire contract for the archived game log stored in R2.
 *
 * The writer (`buildCompletedGameArchive`) and the reader (web history detail)
 * both validate against this file, so a field rename cannot silently break
 * replay for records that are already archived.
 */

/** Player identity inside an archived document. IDs are replaced by `p1`, `p2` … */
export const archiveParticipantSchema = z.object({
  ref: z.string().min(1),
  name: z.string(),
  isAgent: z.boolean(),
  codename: z.string().nullish(),
  environmentLabel: z.string().nullish(),
  ownerGamertag: z.string().nullish(),
});

export const archivedGameEventSchema = z.object({
  seq: z.number(),
  at: z.number(),
  type: z.string(),
  summary: wireValueSchema.optional(),
});

export const archivedRewatchSchema = z
  .object({
    frames: z.array(wireValueSchema),
  })
  .passthrough();

export const gameLogDocumentSchema = z.object({
  version: z.literal(1),
  gameId: z.string().min(1),
  gameType: z.string().min(1),
  startedAt: z.number(),
  endedAt: z.number(),
  endReason: z.string(),
  winner: z.string().nullable(),
  participants: z.array(archiveParticipantSchema),
  events: z.array(archivedGameEventSchema),
  rewatch: archivedRewatchSchema,
});

export type ArchiveParticipant = z.infer<typeof archiveParticipantSchema>;

export type ArchiveEvent = z.infer<typeof archivedGameEventSchema>;

export type GameLogDocument = z.infer<typeof gameLogDocumentSchema>;

/** Cheap guard for the fragile part: participant fields the reader depends on. */
export function archivedParticipantsAreReadable(value: readonly unknown[]): boolean {
  return value.every((participant) => archiveParticipantSchema.safeParse(participant).success);
}
