import { z } from "zod";
import { testUser } from "../fixtures/auth";
import { SQLiteD1 } from "../fixtures/sqlite-d1";
import { testEnv } from "../fixtures/env";
import { DatabaseSync } from "node:sqlite";
import { URL } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { authRoutes } from "../../auth/routes";
import type { Variables } from "../../types";
import type { Env } from "../../types";
import { recordFeaturedGame, refreshFeaturedVods, streamWatchUrl } from "../../lib/featuredGames";
import { getOwnedAgentGameLogKey, listOwnedAgentGameLogs } from "../../auth/gameLogs";

function harness() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../../../migrations/", import.meta.url);

  for (const file of readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  const now = Date.now();
  sqlite.exec(
    "INSERT INTO users (id,email,broadcast_allowed) VALUES ('stream-host','host@example.test',1)",
  );
  sqlite
    .prepare(
      "INSERT INTO broadcast_rooms (id,room_id,game_type,created_at,listed_at,expires_at,summary,game_log_id,broadcast_allowed) VALUES ('broadcast','room','reversi',?,?,?,'{}','game',1)",
    )
    .run(now, now, now + 60000);

  const env = testEnv({
    TWITCH_CLIENT_ID: crypto.randomUUID(),
    TWITCH_CLIENT_SECRET: "test-secret",
    TWITCH_BROADCASTER_ID: "123",
    DB: new SQLiteD1(sqlite),
  });

  let live = true;
  let vod = true;

  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("/oauth2/token"))
      return Response.json({ access_token: "test-token", expires_in: 3600 });

    if (url.includes("/streams?"))
      return Response.json({
        data: live
          ? [
              {
                id: "stream-1",
                user_login: "test_channel",
                type: "live",
                started_at: new Date(now - 120000).toISOString(),
              },
            ]
          : [],
      });

    return Response.json({
      data: [
        { id: "999", stream_id: "other-stream", viewable: "public" },
        ...(vod ? [{ id: "456", stream_id: "stream-1", viewable: "public" }] : []),
      ],
    });
  });

  vi.stubGlobal("fetch", fetcher);

  return {
    env,
    sqlite,
    now,
    fetcher,
    setLive: (value: boolean) => {
      live = value;
    },
    setVod: (value: boolean) => {
      vod = value;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function historyApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("user", testUser({ id: "owner" }));
    await next();
  });
  app.route("/", authRoutes);

  return app;
}

function addHistory(h: ReturnType<typeof harness>) {
  h.sqlite.exec(
    "INSERT INTO users (id,email) VALUES ('owner','owner@example.test'); INSERT INTO game_logs (id,game_type,started_at,ended_at,end_reason,event_count,r2_key,size_bytes) VALUES ('game','reversi',1,2,'win',10,'key',100); INSERT INTO game_log_participants (game_log_id,participant_ref,owner_user_id,is_agent,display_name) VALUES ('game','p1','owner',1,'Agent')",
  );
}

describe("featured stream history", () => {
  it("retains the match-start decision after profile and host changes", async () => {
    const h = harness();
    h.sqlite.exec(
      "INSERT INTO users (id,email,broadcast_allowed) VALUES ('guest','guest@example.test',0)",
    );
    const eligible = () => h.sqlite.prepare("SELECT id FROM eligible_broadcast_rooms").all();
    expect(eligible()).toHaveLength(1);
    h.sqlite.exec(
      "UPDATE users SET broadcast_allowed = 0 WHERE id = 'stream-host'; UPDATE users SET broadcast_allowed = 1 WHERE id = 'guest'",
    );
    expect(eligible()).toHaveLength(1);
    await recordFeaturedGame(h.env, "broadcast", h.now);
    expect(h.fetcher).toHaveBeenCalled();
    h.sqlite.exec(
      "UPDATE broadcast_rooms SET snapshot = '{}'; UPDATE users SET broadcast_allowed = 1 WHERE id = 'stream-host'",
    );
    expect(eligible()).toHaveLength(1);
    h.sqlite.exec("UPDATE users SET broadcast_allowed = 0 WHERE id = 'stream-host'");
    expect(eligible()).toHaveLength(1);
    h.sqlite.exec(
      "UPDATE broadcast_rooms SET broadcast_allowed = 0; UPDATE users SET broadcast_allowed = 1",
    );
    expect(eligible()).toHaveLength(0);
  });
  it("stores a timestamped VOD for the exact stream and preserves its first appearance", async () => {
    const h = harness();
    await recordFeaturedGame(h.env, "broadcast", h.now);
    await recordFeaturedGame(h.env, "broadcast", h.now + 30000);
    expect(
      h.sqlite
        .prepare(
          "SELECT game_log_id,offset_seconds,vod_id,featured_at FROM game_broadcast_features",
        )
        .all(),
    ).toEqual([{ game_log_id: "game", offset_seconds: 110, vod_id: "456", featured_at: h.now }]);
    expect(
      streamWatchUrl({ channel_login: "test_channel", vod_id: "456", offset_seconds: 110 }),
    ).toBe("https://www.twitch.tv/videos/456?t=110s");
  });
  it("does not feature an offline channel or a missing room", async () => {
    const h = harness();
    h.setLive(false);
    await recordFeaturedGame(h.env, "broadcast", h.now);
    await recordFeaturedGame(h.env, "missing", h.now);
    expect(h.sqlite.prepare("SELECT * FROM game_broadcast_features").all()).toHaveLength(0);
  });
  it("starts with a channel link then resolves a delayed VOD", async () => {
    const h = harness();
    h.setVod(false);
    await recordFeaturedGame(h.env, "broadcast", h.now);
    expect(h.sqlite.prepare("SELECT vod_id FROM game_broadcast_features").get()?.vod_id).toBeNull();
    expect(
      streamWatchUrl({ channel_login: "test_channel", vod_id: null, offset_seconds: 110 }),
    ).toBe("https://www.twitch.tv/test_channel");
    h.setVod(true);
    h.sqlite.exec("UPDATE game_broadcast_features SET checked_at = 0");
    await refreshFeaturedVods(h.env, ["game"]);
    expect(h.sqlite.prepare("SELECT vod_id FROM game_broadcast_features").get()?.vod_id).toBe(
      "456",
    );
  });
  it("resolves late publication in the same History response after the stream and room end", async () => {
    const h = harness();
    h.setVod(false);
    vi.spyOn(Date, "now").mockReturnValue(h.now);
    await recordFeaturedGame(h.env, "broadcast", h.now);
    addHistory(h);
    h.setLive(false);
    h.sqlite.exec("DELETE FROM broadcast_rooms");
    const app = historyApp();
    const before = await app.request("/users/me/game-logs", undefined, h.env);
    expect(
      z
        .object({
          games: z.array(
            z
              .object({
                featured: z.object({ watchUrl: z.string(), recording: z.boolean() }).optional(),
              })
              .passthrough(),
          ),
        })
        .parse(await before.json()).games[0]!.featured,
    ).toEqual({
      watchUrl: "https://www.twitch.tv/test_channel",
      recording: false,
    });
    h.setVod(true);
    vi.spyOn(Date, "now").mockReturnValue(h.now + 60001);
    const after = await app.request("/users/me/game-logs", undefined, h.env);
    expect(after.status).toBe(200);
    expect(
      z
        .object({
          games: z.array(
            z
              .object({
                featured: z.object({ watchUrl: z.string(), recording: z.boolean() }).optional(),
              })
              .passthrough(),
          ),
        })
        .parse(await after.json()).games[0]!.featured,
    ).toEqual({
      watchUrl: "https://www.twitch.tv/videos/456?t=110s",
      recording: true,
    });
  });
  it("shares a paginated lookup across pending games and updates the entire matching stream", async () => {
    const h = harness();
    h.setVod(false);
    await recordFeaturedGame(h.env, "broadcast", h.now);

    for (let i = 0; i < 5; i++) {
      h.sqlite
        .prepare(
          "INSERT INTO game_broadcast_features SELECT ?,stream_id,channel_login,broadcaster_id,featured_at,?,NULL,0 FROM game_broadcast_features WHERE game_log_id = ?",
        )
        .run(`game-${i}`, i * 30, "game");
    }

    h.sqlite.exec(
      "UPDATE game_broadcast_features SET checked_at = 0; UPDATE game_broadcast_features SET stream_id = 'missing' WHERE game_log_id IN ('game-0','game-1')",
    );
    h.fetcher.mockClear();
    h.fetcher.mockImplementation(async (url: string) => {
      if (url.includes("after=next"))
        return Response.json({ data: [{ id: "456", stream_id: "stream-1", viewable: "public" }] });

      return Response.json({
        data: [
          { id: "999", stream_id: "unrelated", viewable: "public" },
          { id: "888", stream_id: "stream-1", viewable: "private" },
          { id: "bad-id", stream_id: "stream-1", viewable: "public" },
        ],
        pagination: { cursor: "next" },
      });
    });
    await refreshFeaturedVods(h.env, ["game-0", "game-1", "game-2", "game-3"]);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(
      h.sqlite
        .prepare(
          "SELECT game_log_id FROM game_broadcast_features WHERE vod_id = ? ORDER BY game_log_id",
        )
        .all("456"),
    ).toEqual(["game", "game-2", "game-3", "game-4"].map((game_log_id) => ({ game_log_id })));
    expect(
      h.sqlite
        .prepare("SELECT offset_seconds FROM game_broadcast_features WHERE game_log_id = ?")
        .get("game-4")?.offset_seconds,
    ).toBe(120);
    await refreshFeaturedVods(h.env, ["game-0", "game-1", "game-2"]);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps History available on Twitch failure and retries after the cooldown", async () => {
    const h = harness();
    h.setVod(false);
    const clock = vi.spyOn(Date, "now").mockReturnValue(h.now);
    await recordFeaturedGame(h.env, "broadcast", h.now);
    addHistory(h);
    h.sqlite.exec("UPDATE game_broadcast_features SET checked_at = 0");
    h.fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await historyApp().request("/users/me/game-logs", undefined, h.env);
    expect(response.status).toBe(200);
    expect(
      z
        .object({
          games: z.array(
            z
              .object({
                featured: z.object({ watchUrl: z.string(), recording: z.boolean() }).optional(),
              })
              .passthrough(),
          ),
        })
        .parse(await response.json()).games[0]!.featured?.recording,
    ).toBe(false);
    h.setVod(true);
    h.fetcher.mockClear();
    clock.mockReturnValue(h.now + 59999);
    await refreshFeaturedVods(h.env, ["game"]);
    expect(h.fetcher).not.toHaveBeenCalled();
    clock.mockReturnValue(h.now + 60001);
    await refreshFeaturedVods(h.env, ["game"]);
    expect(h.sqlite.prepare("SELECT vod_id FROM game_broadcast_features").get()?.vod_id).toBe(
      "456",
    );
  });
  it("joins the feature to owned history without exposing another account history", async () => {
    const h = harness();
    await recordFeaturedGame(h.env, "broadcast", h.now);
    h.sqlite.exec(
      "INSERT INTO users (id,email,created_at,updated_at) VALUES ('owner','owner@example.test',0,0); INSERT INTO game_logs (id,game_type,started_at,ended_at,end_reason,event_count,r2_key,size_bytes) VALUES ('game','reversi',1,2,'win',10,'key',100); INSERT INTO game_log_participants (game_log_id,participant_ref,owner_user_id,is_agent,display_name) VALUES ('game','p1','owner',1,'Agent')",
    );
    const own = await listOwnedAgentGameLogs(h.env.DB, "owner");
    expect(own.games[0]?.featured).toEqual({
      watchUrl: "https://www.twitch.tv/videos/456?t=110s",
      recording: true,
    });
    expect((await listOwnedAgentGameLogs(h.env.DB, "someone-else")).games).toHaveLength(0);
  });
  it("shares featured history and replay access with a signed-in human participant who was not host", async () => {
    const h = harness();
    await recordFeaturedGame(h.env, "broadcast", h.now);
    h.sqlite.exec(
      "INSERT INTO users (id,email,created_at,updated_at) VALUES ('guest','guest@example.test',0,0); INSERT INTO game_logs (id,game_type,started_at,ended_at,end_reason,event_count,r2_key,size_bytes) VALUES ('game','reversi',1,2,'win',10,'key',100); INSERT INTO game_log_participants (game_log_id,participant_ref,owner_user_id,is_agent,display_name) VALUES ('game','p2','guest',0,'Guest')",
    );
    const history = await listOwnedAgentGameLogs(h.env.DB, "guest");
    expect(history.games).toHaveLength(1);
    expect(history.games[0]?.featured).toEqual({
      watchUrl: "https://www.twitch.tv/videos/456?t=110s",
      recording: true,
    });
    expect(await getOwnedAgentGameLogKey(h.env.DB, "guest", "game")).toBe("key");
  });
  it("does not call Twitch without configuration", async () => {
    const h = harness();
    delete h.env.TWITCH_CLIENT_SECRET;
    await recordFeaturedGame(h.env, "broadcast", h.now);
    expect(h.fetcher).not.toHaveBeenCalled();
  });
});
