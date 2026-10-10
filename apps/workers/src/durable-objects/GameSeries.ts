import type { RoomRuntime } from "./runtime";
import {
  expandSeries,
  type SeriesConfig,
  type SeriesView,
  type SeriesParticipant,
  type SeriesResult,
} from "@llmgames/game-catalog";
import type { Env } from "../types";
import { seriesConfigSchema } from "../lib/series";
import { generateSecureRoomCode, getRoomNamespace, roomIdFor } from "../lib/roomRouting";
import {
  activateRoomCode,
  reserveRoomCode,
  releaseRoomCode,
  resolveRoomCode,
} from "../lib/activeRooms";
import { randomInt } from "../lib/csprng";
import { persistSeriesArchive } from "../lib/seriesArchives";

interface Member extends SeriesParticipant {
  browserId?: string;
  ownerGamertag?: string;
}

interface RecordState extends Omit<SeriesView, "isHost" | "you" | "participants"> {
  hostId: string;
  hostName: string;
  participants: Member[];
  launchAttempts: number;
  cleanupAt?: number;
}

interface Caller {
  userId: string;
  participantId?: string;
}

const json = <T>(value: T, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const terminal = (status: RecordState["status"]) =>
  ["completed", "cancelled", "failed"].includes(status);

const TERMINAL_DELIVERY_MS = 30_000;

/** Coordinates matches and breaks only. Every game decision still comes from a player. */
export class GameSeries {
  private record: RecordState | null = null;
  private waiters = new Set<() => void>();
  constructor(
    private state: RoomRuntime,
    private env: Env,
  ) {
    state.blockConcurrencyWhile(async () => {
      this.record = (await state.storage.get<RecordState>("series")) ?? null;

      // Older completed records had no alarm. Arm cleanup when they are loaded.
      if (this.record && terminal(this.record.status)) await this.save();
    });
  }
  private async save() {
    const record = this.record!;

    if (terminal(record.status)) record.cleanupAt ??= Date.now() + TERMINAL_DELIVERY_MS;
    await this.state.storage.put("series", record);
    await this.state.storage.setAlarm(
      terminal(record.status)
        ? record.cleanupAt!
        : Math.min(
            record.expiresAt,
            record.status === "preparing" ? Date.now() + 5000 : (record.nextAt ?? record.expiresAt),
          ),
    );
    await this.env.DB.prepare(`INSERT INTO game_series (code, host_user_id, name, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET status = excluded.status`)
      .bind(
        record.code,
        record.hostId,
        record.config.name,
        record.status,
        record.createdAt,
        record.expiresAt,
      )
      .run();

    for (const resolve of this.waiters) resolve();
  }
  private async purge() {
    const record = this.record;

    try {
      if (record) {
        const participantOwners = [];

        for (const member of record.participants) {
          const owner =
            member.browserId ??
            (
              await this.env.DB.prepare(`SELECT seats.owner_user_id FROM mcp_room_players AS players
            JOIN mcp_agent_seats AS seats ON seats.id = players.agent_id WHERE players.room_id = ? AND players.player_id = ?`)
                .bind(`series-${record.code}`, member.id)
                .first<{ owner_user_id: string }>()
            )?.owner_user_id;

          if (owner) participantOwners.push({ participantId: member.id, userId: owner });
        }

        const { isHost: _host, you: _you, ...series } = this.view({ userId: record.hostId });
        await persistSeriesArchive(this.env, {
          version: 1,
          hostUserId: record.hostId,
          participantOwners,
          series,
        });
      }

      await this.state.storage.deleteAlarm();
      await this.state.storage.deleteAll();
      this.record = null;

      for (const resolve of this.waiters) resolve();
    } catch (error) {
      await this.state.storage.setAlarm(Date.now() + 5000);
      throw error;
    }
  }
  private view(caller: Caller): SeriesView {
    const r = this.record!;

    const participant = r.participants.find(
      (p) => p.id === caller.participantId || p.browserId === caller.userId,
    );

    const view: SeriesView = {
      code: r.code,
      config: r.config,
      status: r.status,
      participants: r.participants.map(({ browserId: _browser, ownerGamertag: _owner, ...p }) => p),
      results: r.results,
      currentMatch: r.currentMatch,
      nextAt: r.nextAt,
      ready: r.ready,
      totalMatches: r.totalMatches,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,

      isHost: caller.userId === r.hostId,
      you: participant?.id ?? null,
    };

    if (r.error) view.error = r.error;

    return view;
  }
  async fetch(request: Request): Promise<Response> {
    // Wait outside the serialized mutation section, so results and alarms can advance.
    if (new URL(request.url).pathname === "/wait") {
      const body = await request.json<Caller & { timeoutMs?: number }>();

      const response = await this.fetch(
        new Request("https://series.internal/view", { method: "POST", body: JSON.stringify(body) }),
      );

      if (!response.ok) return response;

      if (this.record && !terminal(this.record.status) && this.record.status !== "playing") {
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            this.waiters.delete(finish);
            resolve();
          };

          const timer = setTimeout(finish, Math.min(25_000, Math.max(0, body.timeoutMs ?? 25_000)));
          this.waiters.add(finish);
        });
      }

      return this.fetch(
        new Request("https://series.internal/view", { method: "POST", body: JSON.stringify(body) }),
      );
    }

    return this.state.blockConcurrencyWhile(async () => {
      const path = new URL(request.url).pathname;

      // Namespace-only maintenance. Public series handlers never forward this path.
      if (path === "/maintenance/storage-status") {
        return json({
          hasSeries: Boolean(await this.state.storage.get("series")),
          storedKeys: (await this.state.storage.list()).size,
          alarm: await this.state.storage.getAlarm(),
        });
      }

      if (path === "/maintenance/purge-terminal") {
        if (this.record && !terminal(this.record.status))
          return json({ error: "Series is still active" }, 409);
        await this.purge();

        return json({ ok: true });
      }

      const body = await request
        .json<
          Caller & {
            code: string;
            config: SeriesConfig;
            hostName: string;
            participant?: Member;
            result?: SeriesResult;
            roomId?: string;
          }
        >()
        .catch(() => null);

      if (!body) return json({ error: "Invalid request" }, 400);

      if (path === "/create") {
        if (this.record) return json({ error: "Series code is already in use" }, 409);

        if (
          await this.env.DB.prepare("SELECT code FROM game_series WHERE code = ?")
            .bind(body.code)
            .first()
        )
          return json({ error: "Series code is already in use" }, 409);
        const parsed = seriesConfigSchema.safeParse(body.config);

        if (!parsed.success)
          return json({ error: parsed.error.issues[0]?.message ?? "Invalid configuration" }, 400);
        const now = Date.now();
        this.record = {
          code: body.code,
          hostId: body.userId,
          hostName: body.hostName,
          config: parsed.data,
          participants: body.participant ? [body.participant] : [],
          results: [],
          ready: [],
          currentMatch: null,
          status: "waiting",
          nextAt: null,
          totalMatches: expandSeries(parsed.data).length,
          createdAt: now,
          expiresAt: now + 86_400_000,
          launchAttempts: 0,
        };
        await this.save();

        return json(this.view(body));
      }

      const r = this.record;

      // Late game-room retries must be acknowledged after series cleanup so the
      // room can finish deleting its own storage. They never recreate a series.
      if (!r)
        return path === "/result" ? json({ ok: true }) : json({ error: "Series not found" }, 404);

      // This endpoint is namespace-only. No public API forwards results.
      if (path === "/result") {
        const match = r.currentMatch,
          result = body.result;

        if (!match || !result || body.roomId !== match.roomId || result.index !== match.index) {
          const duplicate = r.results.some(
            (result) =>
              result.index === body.result?.index && result.gameId === body.result?.gameId,
          );

          if (duplicate) await this.save();

          return json({ ok: duplicate }, 200);
        }

        if (r.results.some((previous) => previous.index === result.index)) {
          await this.save();

          return json({ ok: true });
        }

        if (terminal(r.status)) return json({ ok: true });
        const ids = new Map(match.players.map((p) => [p.playerId, p.participantId]));
        const winnerId = result.winnerId ? (ids.get(result.winnerId) ?? null) : null;
        r.results.push({
          ...result,
          gameType: match.gameType,
          firstParticipantId: ["pokemon", "contexto"].includes(match.gameType)
            ? null
            : match.firstParticipantId,
          winnerId,
          outcome: result.outcome === "aborted" ? "aborted" : winnerId ? "win" : "draw",
          metrics: Object.fromEntries(
            match.players.map((p) => [
              p.participantId,
              result.metrics[p.playerId] ?? { actions: 0, decisionMs: 0, timeouts: 0 },
            ]),
          ),
        });
        r.currentMatch = null;
        r.ready = [];
        r.status =
          result.outcome === "aborted"
            ? "failed"
            : r.results.length === r.totalMatches
              ? "completed"
              : "break";

        if (r.status === "failed") r.error = "The match ended before completion.";
        r.nextAt = r.status === "break" ? Date.now() + r.config.gapMs : null;
        await this.save();

        return json({ ok: true });
      }

      const participant = r.participants.find(
        (p) => p.id === body.participantId || p.browserId === body.userId,
      );

      if (body.userId !== r.hostId && !participant && path !== "/join")
        return json({ error: "Join this series to view it" }, 403);

      if (path === "/join") {
        if (!participant) {
          if (r.status !== "waiting") return json({ error: "Series has already started" }, 409);

          if (r.participants.length >= 2)
            return json({ error: "Both participant seats are taken" }, 409);

          if (!body.participant) return json({ error: "Participant required" }, 400);
          r.participants.push(body.participant);
          await this.save();
        }
      } else if (path === "/start") {
        if (body.userId !== r.hostId) return json({ error: "Only the host can start" }, 403);

        if (r.status === "waiting") {
          if (r.participants.length !== 2)
            return json({ error: "Two participants are required" }, 409);
          r.status = "preparing";
          await this.save();
          await this.launch();
        }
      } else if (path === "/ready") {
        if (!participant) return json({ error: "Only participants can mark ready" }, 403);

        if (r.status !== "break") return json({ error: "No break is in progress" }, 409);

        if (!r.ready.includes(participant.id)) r.ready.push(participant.id);
        await this.save();

        if (Date.now() >= r.nextAt! && r.ready.length === 2) await this.advance();
      } else if (path === "/cancel") {
        if (body.userId !== r.hostId) return json({ error: "Only the host can cancel" }, 403);

        if (!terminal(r.status)) {
          r.status = "cancelled";
          r.nextAt = null;
          await this.save();
          const match = r.currentMatch;

          if (match)
            await getRoomNamespace(this.env, match.gameType)
              .get(getRoomNamespace(this.env, match.gameType).idFromName(match.roomId))
              .fetch("https://do.internal/end", { method: "POST" });
        }
      } else if (path !== "/view") return json({ error: "Not found" }, 404);

      return json(this.view(body));
    });
  }
  private async advance() {
    const r = this.record!;

    if (r.status !== "break" || Date.now() < r.nextAt!) return;

    if (r.config.progression === "ready" && r.ready.length !== 2) {
      // No polling alarm while waiting for people. /ready advances after the gap.
      r.nextAt = null;
      await this.save();

      return;
    }

    r.status = "preparing";
    r.nextAt = null;
    r.launchAttempts = 0;
    await this.save();
    await this.launch();
  }
  async alarm() {
    await this.state.blockConcurrencyWhile(async () => {
      const r = this.record;

      if (!r) {
        await this.purge();

        return;
      }

      if (terminal(r.status)) {
        if (Date.now() >= r.cleanupAt!) await this.purge();
        else await this.state.storage.setAlarm(r.cleanupAt!);

        return;
      }

      if (Date.now() >= r.expiresAt) {
        r.status = "failed";
        r.error = "Series expired after 24 hours";
        await this.save();

        if (r.currentMatch) {
          const ns = getRoomNamespace(this.env, r.currentMatch.gameType);
          await ns
            .get(ns.idFromName(r.currentMatch.roomId))
            .fetch("https://do.internal/end", { method: "POST" });
        }
      } else if (r.status === "preparing") await this.launch();
      else if (r.status === "break") await this.advance();
    });
  }
  private async launch() {
    const r = this.record!;

    try {
      const round = expandSeries(r.config)[r.results.length]!;

      if (!r.currentMatch) {
        const sameGameIndex = r.results.filter(
          (result) => result.gameType === round.gameType,
        ).length;

        const first =
          r.config.firstSeat === "participant2"
            ? 1
            : r.config.firstSeat === "random"
              ? randomInt(2)
              : r.config.firstSeat === "alternate"
                ? sameGameIndex % 2
                : 0;

        let descriptor: RecordState["currentMatch"] = null;

        for (let attempt = 0; attempt < 5; attempt++) {
          const roomCode = generateSecureRoomCode(),
            roomId = roomIdFor(round.gameType, roomCode);

          if (
            !(await reserveRoomCode(this.env.DB, round.gameType, roomCode, Date.now() + 2_700_000))
          )
            continue;
          descriptor = {
            index: r.results.length,
            gameType: round.gameType,
            roomId,
            roomCode,
            firstParticipantId: r.participants[first]!.id,
            players: [],
            createdAt: Date.now(),
          };
          break;
        }

        if (!descriptor) throw new Error("Could not allocate a room");
        r.currentMatch = descriptor;
        await this.save();
      }

      const match = r.currentMatch;

      if (!match) throw new Error("Missing match");
      const players = [];

      for (const member of r.participants) {
        let playerId = member.browserId;

        if (!playerId) {
          // The private credential stays in D1. The DO receives only the returned public playerId.
          const row =
            await this.env.DB.prepare(`INSERT INTO mcp_room_players (room_id, agent_id, player_id, created_at, last_used_at)
            SELECT ?, agent_id, ?, unixepoch(), unixepoch() FROM mcp_room_players WHERE room_id = ? AND player_id = ?
            ON CONFLICT(room_id, agent_id) DO UPDATE SET last_used_at = excluded.last_used_at RETURNING player_id`)
              .bind(match.roomId, `player_${crypto.randomUUID()}`, `series-${r.code}`, member.id)
              .first<{ player_id: string }>();

          if (!row) throw new Error("Participant identity is unavailable");
          playerId = row.player_id;
        }

        match.players = [
          ...match.players.filter((p) => p.participantId !== member.id),
          { participantId: member.id, playerId },
        ];
        players.push({
          id: playerId,
          name: member.name,
          isAgent: member.kind === "agent",
          channel: member.kind === "agent" ? "mcp" : "browser",
          codename: member.kind === "agent" ? member.name : undefined,
          ownerGamertag: member.ownerGamertag,
          environmentLabel: member.environmentLabel,
        });
      }

      await this.save();

      const firstPlayerId = match.players.find(
        (p) => p.participantId === match.firstParticipantId,
      )!.playerId;

      players.sort((a, b) => (a.id === firstPlayerId ? -1 : b.id === firstPlayerId ? 1 : 0));

      const namespace = getRoomNamespace(this.env, match.gameType),
        stub = namespace.get(namespace.idFromName(match.roomId));

      const setup = await stub.fetch("https://do.internal/series/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hostId: r.hostId,
          hostName: r.hostName,
          roomCode: match.roomCode,
          ...round,
          maxPlayers: 2,
          players,
          series: { code: r.code, index: match.index, firstPlayerId },
        }),
      });

      if (!setup.ok) throw new Error("Could not prepare the match");
      const setupState = await setup.json<{ expiresAt: number }>();

      if (!Number.isSafeInteger(setupState.expiresAt) || setupState.expiresAt <= Date.now())
        throw new Error("Invalid match expiry");

      if (!(await resolveRoomCode(this.env.DB, match.roomCode)))
        await activateRoomCode(this.env.DB, match.roomCode, match.roomId, setupState.expiresAt);

      const start = await stub.fetch("https://do.internal/agent/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: r.hostId }),
      });

      if (!start.ok) throw new Error("Could not start the match");
      r.status = "playing";
      r.ready = [];
      r.nextAt = null;
      await this.save();
    } catch {
      r.launchAttempts++;

      if (r.launchAttempts >= 3) {
        r.status = "failed";
        r.error = "Could not launch the next match.";
        await this.save();

        if (r.currentMatch) {
          const match = r.currentMatch,
            ns = getRoomNamespace(this.env, match.gameType);

          await ns
            .get(ns.idFromName(match.roomId))
            .fetch("https://do.internal/end", { method: "POST" })
            .catch(() => {});
          await releaseRoomCode(this.env.DB, match.roomCode, match.roomId);
        }
      } else await this.save();
    }
  }
}
