import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../types";
import { generateSecureRoomCode, ROOM_CODE_PATTERN } from "../lib/roomRouting";
import { seriesConfigSchema, seriesLabelsSchema, seriesRequest } from "../lib/series";

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
