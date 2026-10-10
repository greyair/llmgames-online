import { z } from "zod";
import { clientViewSchema, type ClientView } from "@/domain/game-state";

export type RewatchFrame = {
  index: number;
  at: number;
  label: string;
  state: ClientView;
};

export type RewatchPayload = {
  version: 1;
  visibility: "full_reveal";
  gameType: string;
  truncated?: boolean;
  frames: RewatchFrame[];
};

export { isClientView } from "@/domain/game-state";

const rewatchSchema = z.object({
  version: z.literal(1),
  visibility: z.literal("full_reveal"),
  gameType: z.string(),
  truncated: z.boolean().optional(),
  frames: z
    .array(
      z.object({
        index: z.number(),
        at: z.number(),
        label: z.string().min(1),
        state: clientViewSchema,
      }),
    )
    .min(1),
});

export function parseRewatch<T>(value: T, gameType: string): RewatchPayload | null {
  const payload = rewatchSchema.safeParse(value).data;

  if (!payload || payload.gameType !== gameType) return null;

  return { ...payload, truncated: payload.truncated === true };
}

export function readOnlyReplayState(state: ClientView): ClientView {
  const replayPerspectivePlayerId = state.replayPerspectivePlayerId ?? state.you?.playerId;

  const replay: ClientView = {
    ...state,
    replayReadOnly: true,
    you: state.you
      ? {
          isHost: false,
          isYourTurn: false,
          isSpectator: false,
          phase: state.you.phase,
          legalActions: [],
        }
      : state.you,
  };

  if (replayPerspectivePlayerId) replay.replayPerspectivePlayerId = replayPerspectivePlayerId;

  return replay;
}
