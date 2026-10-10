import { z } from "zod";
import { isString } from "@llmgames/game-catalog";

import type { Env } from "../types";

type Feature = {
  game_log_id: string;
  stream_id: string;
  broadcaster_id: string;
  channel_login: string;
  offset_seconds: number;
  vod_id: string | null;
  checked_at: number;
};

let tokenCache: { client: string; token: string; until: number } | undefined;

const videoSchema = z.object({ stream_id: z.string(), id: z.string(), viewable: z.string() });

const streamSchema = z.object({
  id: z.string(),
  user_login: z.string(),
  started_at: z.string(),
  type: z.string(),
});

async function twitch<T>(
  env: Env,
  path: string,
  entrySchema: z.ZodType<T>,
  signal = AbortSignal.timeout(8000),
) {
  const client = env.TWITCH_CLIENT_ID;

  if (!client || !env.TWITCH_CLIENT_SECRET) throw new Error("Twitch is not configured");

  if (!tokenCache || tokenCache.client !== client || tokenCache.until <= Date.now()) {
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: client,
        client_secret: env.TWITCH_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
      signal,
    });

    if (!response.ok) throw new Error("Twitch token request failed");

    const data = z
      .object({ access_token: z.string().optional(), expires_in: z.number().optional() })
      .parse(await response.json());

    if (!data.access_token || !data.expires_in) throw new Error("Invalid Twitch token response");
    tokenCache = {
      client,
      token: data.access_token,
      until: Date.now() + (data.expires_in - 60) * 1000,
    };
  }

  const response = await fetch(`https://api.twitch.tv/helix/${path}`, {
    headers: { "Client-Id": client, Authorization: `Bearer ${tokenCache.token}` },
    signal,
  });

  if (!response.ok) {
    if (response.status === 401) tokenCache = undefined;
    throw new Error("Twitch lookup failed");
  }

  const data = z
    .object({
      data: z.array(entrySchema),
      pagination: z.object({ cursor: z.string().optional() }).optional(),
    })
    .parse(await response.json());

  if (!Array.isArray(data.data)) throw new Error("Invalid Twitch response");

  return { data: data.data, pagination: data.pagination };
}

export function streamWatchUrl(feature: {
  channel_login: string;
  vod_id: string | null;
  offset_seconds: number;
}): string {
  return feature.vod_id && /^\d+$/.test(feature.vod_id)
    ? `https://www.twitch.tv/videos/${feature.vod_id}?t=${Math.max(0, Math.floor(feature.offset_seconds))}s`
    : `https://www.twitch.tv/${encodeURIComponent(feature.channel_login)}`;
}

async function resolveVods(env: Env, features: Feature[]) {
  const resolved = new Map<string, string>();
  const broadcasters = new Map<string, Feature[]>();

  for (const feature of features) {
    const group = broadcasters.get(feature.broadcaster_id) ?? [];
    group.push(feature);
    broadcasters.set(feature.broadcaster_id, group);
  }

  // One budget for the entire refresh, including token acquisition and pagination.
  const signal = AbortSignal.timeout(8000);

  for (const [broadcaster, group] of broadcasters) {
    const pending = new Set(group.map((feature) => feature.stream_id));

    try {
      for (const stream of pending) {
        await env.DB.prepare(
          "UPDATE game_broadcast_features SET checked_at = ? WHERE broadcaster_id = ? AND stream_id = ? AND vod_id IS NULL",
        )
          .bind(Date.now(), broadcaster, stream)
          .run();
      }

      let cursor: string | undefined;
      const seen = new Set<string>();

      do {
        signal.throwIfAborted();

        const page = await twitch(
          env,
          `videos?user_id=${encodeURIComponent(broadcaster)}&type=archive&first=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,
          videoSchema,
          signal,
        );

        for (const value of page.data) {
          const stream = value.stream_id;
          const id = value.id;

          if (
            !pending.has(stream) ||
            value.viewable !== "public" ||
            !isString(id) ||
            !/^\d+$/.test(id)
          )
            continue;
          // A stream can contain many games, including games on other History pages.
          await env.DB.prepare(
            "UPDATE game_broadcast_features SET vod_id = ? WHERE broadcaster_id = ? AND stream_id = ? AND vod_id IS NULL",
          )
            .bind(id, broadcaster, stream)
            .run();

          for (const feature of group)
            if (feature.stream_id === stream) resolved.set(feature.game_log_id, id);
          pending.delete(stream);
        }

        cursor = page.pagination?.cursor;

        if (!cursor || seen.has(cursor)) break;
        seen.add(cursor);
      } while (pending.size);
    } catch {
      // Missing archives and transient failures remain eligible for later retries.
      console.error("Could not refresh stream recordings");
    }
  }

  return resolved;
}

async function resolveVod(env: Env, feature: Feature) {
  if (feature.vod_id || feature.checked_at > Date.now() - 60000) return;
  await resolveVods(env, [feature]);
}

export async function recordFeaturedGame(env: Env, broadcastId: string, appearedAt: number) {
  if (!env.TWITCH_BROADCASTER_ID || !env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) return;

  const room = await env.DB.prepare(
    "SELECT game_log_id FROM eligible_broadcast_rooms WHERE id = ? AND expires_at > ?",
  )
    .bind(broadcastId, Date.now())
    .first<{ game_log_id: string | null }>();

  if (!room?.game_log_id) return;

  const existing = await env.DB.prepare(
    "SELECT * FROM game_broadcast_features WHERE game_log_id = ?",
  )
    .bind(room.game_log_id)
    .first<Feature>();

  if (existing) {
    await resolveVod(env, existing);

    return;
  }

  const { data: streams } = await twitch(
    env,
    `streams?user_id=${encodeURIComponent(env.TWITCH_BROADCASTER_ID)}`,
    streamSchema,
  );

  const stream = streams[0];

  if (
    stream?.type !== "live" ||
    !stream.id ||
    !stream.user_login ||
    !/^[a-zA-Z0-9_]+$/.test(stream.user_login)
  )
    return;
  const started = Date.parse(stream.started_at || "");

  if (!Number.isFinite(started) || started > appearedAt) return;
  const offset = Math.max(0, Math.floor((appearedAt - started) / 1000) - 10);
  await env.DB.prepare(
    `INSERT INTO game_broadcast_features (game_log_id, stream_id, channel_login, broadcaster_id, featured_at, offset_seconds) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(game_log_id) DO NOTHING`,
  )
    .bind(
      room.game_log_id,
      stream.id,
      stream.user_login,
      env.TWITCH_BROADCASTER_ID,
      appearedAt,
      offset,
    )
    .run();
  await resolveVod(env, {
    game_log_id: room.game_log_id,
    stream_id: stream.id,
    channel_login: stream.user_login,
    broadcaster_id: env.TWITCH_BROADCASTER_ID,
    offset_seconds: offset,
    vod_id: null,
    checked_at: 0,
  });
}

export async function refreshFeaturedVods(env: Env, gameIds: string[]) {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET || !gameIds.length)
    return new Map<string, string>();

  const rows = await env.DB.prepare(
    `SELECT * FROM game_broadcast_features WHERE game_log_id IN (${gameIds.map(() => "?").join(",")}) AND vod_id IS NULL AND checked_at <= ? ORDER BY checked_at, game_log_id`,
  )
    .bind(...gameIds, Date.now() - 60000)
    .all<Feature>();

  return resolveVods(env, rows.results);
}
