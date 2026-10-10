import { z } from "zod";
import {
  isGameEnabled,
  SERIES_DEFAULT_MATCH_TIME,
  SERIES_DEFAULT_TURN_TIME,
  SERIES_GAMES,
} from "@llmgames/game-catalog";
import type { Env } from "../types";
import { ROOM_CODE_PATTERN } from "./roomRouting";
import { readSeriesArchive } from "./seriesArchives";

export const seriesConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    rounds: z
      .array(
        z
          .object({
            gameType: z.enum(SERIES_GAMES).refine(isGameEnabled, "Game is unavailable"),
            repeats: z.number().int().min(1).max(50),
            gameTotalTime: z.literal(SERIES_DEFAULT_MATCH_TIME).default(SERIES_DEFAULT_MATCH_TIME),
            turnTime: z.literal(SERIES_DEFAULT_TURN_TIME).default(SERIES_DEFAULT_TURN_TIME),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    firstSeat: z.enum(["alternate", "participant1", "participant2", "random"]),
    gapMs: z.number().int().min(0).max(600_000),
    progression: z.enum(["automatic", "ready"]),
  })
  .strict()
  .superRefine((config, ctx) => {
    const count = config.rounds.reduce((sum, round) => sum + round.repeats, 0);

    if (count > 100) ctx.addIssue({ code: "custom", message: "Choose at most 100 matches" });

    if (
      config.rounds.some(
        (round) => round.gameType === "battleship" && round.gameTotalTime > 2_400_000,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Battleship allows up to 40 minutes plus fleet placement",
      });

    if (
      config.rounds.reduce(
        (sum, round) =>
          sum +
          round.repeats *
            (round.gameTotalTime + (round.gameType === "battleship" ? 300_000 : 0) + config.gapMs),
        0,
      ) > 82_800_000
    )
      ctx.addIssue({ code: "custom", message: "The planned series must fit within 23 hours" });
  });

export const seriesLabelsSchema = z.object({
  modelLabel: z.string().trim().max(100).default(""),
  promptLabel: z.string().trim().max(100).default(""),
});

export function seriesStub(env: Env, code: string) {
  if (!ROOM_CODE_PATTERN.test(code)) throw new Error("Invalid series code");

  return env.GAME_SERIES.get(env.GAME_SERIES.idFromName(`series-${code}`));
}

/** Only authenticated Worker handlers can forward a caller identity to this DO. */
export async function seriesRequest<T extends { userId: string; participantId?: string }>(
  env: Env,
  code: string,
  path: string,
  body: T,
) {
  if (!ROOM_CODE_PATTERN.test(code)) throw new Error("Invalid series code");

  if (path !== "/create") {
    const row = await env.DB.prepare("SELECT r2_key FROM game_series WHERE code = ?")
      .bind(code)
      .first<{ r2_key: string | null }>();

    if (row?.r2_key) return readSeriesArchive(env, row.r2_key, body, path);
  }

  return seriesStub(env, code).fetch(`https://series.internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
