import { Hono } from "hono";
import { z } from "zod";
import type { GameTypeId } from "@llmgames/game-catalog";
import type { Env, Variables } from "../types";
import { generateSecureRoomCode, getRoomNamespace, ROOM_CODE_PATTERN } from "../lib/roomRouting";
import { seriesConfigSchema, seriesLabelsSchema, seriesRequest, seriesStub } from "../lib/series";
import type { RoomChatSendResult } from "../durable-objects/chat/chatTypes";

export const seriesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

seriesRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT code, name, status, created_at FROM game_series WHERE host_user_id = ? ORDER BY created_at DESC LIMIT 50",
  )
    .bind(c.get("user")!.id)
    .all();

  return c.json({ series: rows.results });
});

seriesRoutes.post("/create", async (c) => {
  const parsed = z
    .object({ config: seriesConfigSchema, playing: z.boolean(), ...seriesLabelsSchema.shape })
    .strict()
    .safeParse(await c.req.json().catch(() => null));

  if (!parsed.success)
    return c.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid series configuration" },
      400,
    );
  const user = c.get("user")!;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateSecureRoomCode();

    const response = await seriesRequest(c.env, code, "/create", {
      code,
      config: parsed.data.config,
      userId: user.id,
      hostName: user.gamertag || "Player",
      participant: parsed.data.playing
        ? {
            id: `participant_${crypto.randomUUID()}`,
            browserId: user.id,
            name: user.gamertag || "Player",
            kind: "human",
            modelLabel: parsed.data.modelLabel,
            promptLabel: parsed.data.promptLabel,
          }
        : undefined,
    });

    if (response.status === 409) continue;

    return response;
  }

  return c.json({ error: "Could not allocate a series code" }, 503);
});

/**
 * Series chat. One conversation for the whole series, so these handlers talk
 * straight to the series DO rather than to the current match room.
 *
 * The strict schema is a security boundary: a browser must never be able to
 * supply `author` or `roomProxy`, which are reserved for internal room calls.
 */
const chatBodySchema = z
  .object({
    text: z.string().min(1).max(400),
    mentions: z.array(z.string()).max(8).optional(),
    requestId: z.string().max(100).optional(),
  })
  .strict();

interface SeriesChatReadBody {
  userId: string;
  mode: "recent" | "cursor";
  sinceSeq?: number;
  limit?: number;
}

interface SeriesCurrentMatch {
  currentMatch: { gameType: GameTypeId; roomId: string } | null;
}

seriesRoutes.get("/:code/chat", async (c) => {
  const code = c.req.param("code").toUpperCase();

  if (!ROOM_CODE_PATTERN.test(code)) return c.json({ error: "Invalid series code" }, 400);

  const sinceSeq = c.req.query("sinceSeq");

  const limit = c.req.query("limit");

  const body: SeriesChatReadBody = {
    userId: c.get("user")!.id,
    mode: sinceSeq === undefined ? "recent" : "cursor",
  };

  if (sinceSeq !== undefined) body.sinceSeq = Number(sinceSeq);

  if (limit !== undefined) body.limit = Number(limit);

  return seriesStub(c.env, code).fetch("https://series.internal/chat/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
});

seriesRoutes.post("/:code/chat", async (c) => {
  const code = c.req.param("code").toUpperCase();

  if (!ROOM_CODE_PATTERN.test(code)) return c.json({ error: "Invalid series code" }, 400);

  const parsed = chatBodySchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) return c.json({ error: "Invalid chat message" }, 400);

  const userId = c.get("user")!.id;

  const stub = seriesStub(c.env, code);

  const appended = await stub.fetch("https://series.internal/chat/append", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, ...parsed.data }),
  });

  const result = await appended.json<RoomChatSendResult>();

  if (!appended.ok || !result.ok)
    return c.json(result, appended.status === 403 ? 403 : 400);

  // A line written here must also reach the sockets inside the live match.
  // Fire-and-forget is deliberate: the room may be waiting on this same series
  // conversation, so awaiting its broadcast could deadlock both Durable Objects.
  const view = await stub.fetch("https://series.internal/view", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });

  const state = view.ok
    ? await view.json<SeriesCurrentMatch>().catch(() => null)
    : null;

  if (state?.currentMatch) {
    const namespace = getRoomNamespace(c.env, state.currentMatch.gameType);

    const notify = namespace
      .get(namespace.idFromName(state.currentMatch.roomId))
      .fetch("https://do.internal/series/chat/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, entry: result.message }),
      })
      .catch(() => {});

    try {
      c.executionCtx?.waitUntil(notify);
    } catch {
      void notify;
    }
  }

  return c.json(result);
});

seriesRoutes.get("/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();

  if (!ROOM_CODE_PATTERN.test(code)) return c.json({ error: "Invalid series code" }, 400);

  return seriesRequest(c.env, code, "/view", { userId: c.get("user")!.id });
});

seriesRoutes.post("/:code/:action", async (c) => {
  const code = c.req.param("code").toUpperCase(),
    action = c.req.param("action");

  if (!ROOM_CODE_PATTERN.test(code)) return c.json({ error: "Invalid series code" }, 400);

  if (!["join", "start", "ready", "cancel"].includes(action))
    return c.json({ error: "Invalid action" }, 404);
  const user = c.get("user")!;
  const labels = seriesLabelsSchema.strict().safeParse(await c.req.json().catch(() => ({})));

  if (!labels.success) return c.json({ error: "Invalid participant labels" }, 400);

  const body = { userId: user.id };

  if (action === "join")
    Object.assign(body, {
      participant: {
        id: `participant_${crypto.randomUUID()}`,
        browserId: user.id,
        name: user.gamertag || "Player",
        kind: "human",
        ...labels.data,
      },
    });

  return seriesRequest(c.env, code, `/${action}`, body);
});
