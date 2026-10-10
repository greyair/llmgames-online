import { z } from "zod";

const previewRequestSchema = z.object({
  allowed: z.boolean().optional(),
  dailyLimit: z.number().optional(),
  url: z.string().optional(),
  name: z.string().optional(),
  headerName: z.string().optional(),
});

import { isString } from "@llmgames/game-catalog";

import type { User } from "@/services/auth";
import type { AgentWebhook } from "@/services/agentWebhooks";
import { featuredHistoryFixture } from "./featuredHistoryFixture";
import { fixture } from "./previewFixtures";

export const previewUser: User = {
  id: "preview-0",
  email: "alex@example.test",
  name: "Alex",
  gamertag: "Alex",
  gamertag_selected: 1,
  broadcast_allowed: 1,
};

/** Installed only by the dev preview route. All API requests stay in this tab. */
export function installPreviewApi(options?: {
  typesafeConnected?: boolean;
  trialAvailable?: boolean;
}) {
  const original = window.fetch;
  let user = { ...previewUser };

  interface PreviewTypeSafeStatus {
    available: boolean;
    connected: boolean;
    trialAvailable: boolean;
    verifiedAt: number | null;
    dailyLimit: number;
    callsToday: number;
  }

  let typesafe: PreviewTypeSafeStatus = {
    available: true,
    connected: Boolean(options?.typesafeConnected),
    trialAvailable: options?.trialAvailable !== false,
    verifiedAt: options?.typesafeConnected ? Date.now() : null,
    dailyLimit: 10000,
    callsToday: options?.typesafeConnected ? 38 : 0,
  };

  let webhooks: AgentWebhook[] = [];

  let agents = [
    {
      codename: "SwiftAnchor",
      environmentLabel: "Codex",
      createdAt: 1788970000,
      lastUsedAt: 1788970300,
      hasRoomHistory: true,
      isActive: true,
    },
    {
      codename: "BrightRook",
      environmentLabel: "Claude",
      createdAt: 1788970000,
      lastUsedAt: null,
      hasRoomHistory: true,
      isActive: false,
    },
  ];

  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);

    if (!url.pathname.startsWith("/api/")) return original(input, init);
    const path = url.pathname;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");

    const payload = isString(init?.body) ? previewRequestSchema.parse(JSON.parse(init.body)) : {};

    if (path.endsWith("/users/me")) return Response.json({ user });

    if (path.endsWith("/users/me/typesafe")) {
      if (method === "PUT") {
        const verifiedAt = Date.now();
        typesafe = {
          ...typesafe,
          connected: true,
          verifiedAt,
          dailyLimit: Number(payload.dailyLimit),
        };

        return Response.json({ connected: true, verifiedAt });
      }

      if (method === "DELETE") {
        typesafe = { ...typesafe, connected: false, verifiedAt: null };

        return Response.json({ connected: false });
      }

      return Response.json(typesafe);
    }

    if (path.includes("/users/me/agent-webhooks")) {
      const id = path.split("/agent-webhooks/")[1]?.split("/")[0];

      if (path.endsWith("/invite"))
        return Response.json({ delivered: true, eventId: "preview-invite" });

      if (method === "POST" || method === "PUT") {
        const existing = webhooks.find((h) => h.id === id);
        const url = payload.url;

        const row: AgentWebhook = {
          id: id ?? crypto.randomUUID(),
          name: String(payload.name),
          hostname: url
            ? new URL(String(url)).hostname
            : (existing?.hostname ?? "hooks.example.com"),
          headerName: String(payload.headerName),
          createdAt: existing?.createdAt ?? Date.now(),
          lastAttemptAt: null,
          lastDelivery: null,
        };

        webhooks = [...webhooks.filter((h) => h.id !== row.id), row];

        return Response.json({ id: row.id });
      }

      if (method === "DELETE") {
        webhooks = webhooks.filter((h) => h.id !== id);

        return Response.json({ ok: true });
      }

      return Response.json({ available: true, webhooks });
    }

    if (path.endsWith("/users/me/broadcast")) {
      user = { ...user, broadcast_allowed: payload.allowed ? 1 : 0 };

      return Response.json({ user });
    }

    if (path.endsWith("/users/me/onboarding")) return Response.json({ user });

    if (path.endsWith("/email/request")) return Response.json({ challengeId: "preview-code" });

    if (path.endsWith("/email/verify"))
      return Response.json({ redirectUrl: "/design-preview/profile" });

    if (path.endsWith("/oauth/google"))
      return Response.json({ authUrl: "/design-preview/public/oauth" });

    if (path.endsWith("/sessions/logout") || path.endsWith("/sessions/logout-all"))
      return Response.json({ ok: true });

    if (path.endsWith("/agents")) {
      if (method === "DELETE") {
        const count = agents.filter((a) => !a.isActive).length;
        agents = agents.filter((a) => a.isActive);

        return Response.json({ deletedCount: count, preservedActiveCount: agents.length });
      }

      return Response.json({ agents });
    }

    if (path.includes("/agents/") && method === "DELETE") {
      agents = agents.filter((a) => a.codename !== decodeURIComponent(path.split("/").at(-1)!));

      return Response.json({ ok: true });
    }

    if (path.endsWith("/game-logs"))
      return Response.json({ games: featuredHistoryFixture, nextCursor: null });

    if (path.includes("/game-logs/")) {
      const game =
        featuredHistoryFixture.find((g) => g.id === path.split("/").at(-1)) ??
        featuredHistoryFixture[0]!;

      return Response.json({
        version: 1,
        gameId: game.id,
        gameType: game.gameType,
        startedAt: game.startedAt,
        endedAt: game.endedAt,
        endReason: game.endReason,
        winner: game.winner,
        participants: game.participants,
        events: [{ seq: 1, at: 1788873600000, type: "game_started", summary: { players: 2 } }],
        rewatch: {
          version: 1,
          visibility: "full_reveal",
          gameType: game.gameType,
          frames: [
            { index: 0, at: 0, label: "Match started", state: fixture(game.gameType) },
            {
              index: 1,
              at: 900,
              label: "Match finished",
              state: { ...fixture(game.gameType), status: "ended", winner: "preview-0" },
            },
          ],
        },
      });
    }

    return Response.json(
      { error: "This action is disabled in the seeded preview." },
      { status: 400 },
    );
  };

  return () => {
    window.fetch = original;
  };
}
