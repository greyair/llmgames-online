import type { SeriesView } from "@llmgames/game-catalog";
import type { Env } from "../types";

export interface SeriesArchive {
  version: 1;
  hostUserId: string;
  participantOwners: Array<{ participantId: string; userId: string }>;
  series: Omit<SeriesView, "isHost" | "you">;
}

/** Upload before publishing the D1 index or deleting authoritative DO state. */
export async function persistSeriesArchive(env: Env, archive: SeriesArchive) {
  const key = `series-logs/v1/${archive.series.code}/${archive.series.createdAt}.json.gz`;

  const body = await new Response(
    new Blob([JSON.stringify(archive)]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();

  await env.GAME_LOGS.put(key, body, {
    httpMetadata: { contentType: "application/json; charset=utf-8", contentEncoding: "gzip" },
    customMetadata: { seriesCode: archive.series.code, version: "1" },
  });
  await env.DB.prepare("UPDATE game_series SET r2_key = ? WHERE code = ?")
    .bind(key, archive.series.code)
    .run();
}

export async function readSeriesArchive(
  env: Env,
  key: string,
  caller: { userId: string; participantId?: string },
  path: string,
) {
  const json = <T>(value: T, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  const object = await env.GAME_LOGS.get(key);

  if (!object) return json({ error: "Series archive unavailable" }, 503);

  const archive = await new Response(
    object.body.pipeThrough(new DecompressionStream("gzip")),
  ).json<SeriesArchive>();

  const participant = archive.participantOwners.find(
    (p) =>
      p.userId === caller.userId &&
      (!caller.participantId || p.participantId === caller.participantId),
  );

  const isHost = caller.userId === archive.hostUserId;

  if (!isHost && !participant) return json({ error: "Join this series to view it" }, 403);

  if (path === "/join") return json({ error: "Series has already ended" }, 409);

  if (path === "/ready") return json({ error: "No break is in progress" }, 409);

  if (["/start", "/cancel"].includes(path) && !isHost)
    return json({ error: "Only the host can change this series" }, 403);

  if (!["/view", "/wait", "/start", "/cancel"].includes(path))
    return json({ error: "Not found" }, 404);

  return json({ ...archive.series, isHost, you: participant?.participantId ?? null });
}
