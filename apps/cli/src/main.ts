#!/usr/bin/env node
import { storedConnectionSchema, type StoredConnectionConfig } from "@llmgames/game-catalog";
import { isObject, isString } from "@llmgames/game-catalog";

/**
 * Thin CLI wrapper around @llmgames/agent-client.
 *
 * Auth: MCP OAuth access token (env LLMGAMES_ACCESS_TOKEN or config).
 * Multi-agent seats: use remote MCP (agent_claim), not this CLI.
 *
 * Usage:
 *   llmgames config set-url URL
 *   llmgames config set-token TOKEN
 *   llmgames room create connect4
 *   llmgames room join CODE [--game connect4]
 *   llmgames play
 *   llmgames start
 *   llmgames drop COL
 */

import { AgentClient, type RoomInfo } from "@llmgames/agent-client";
import { chmodSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".llmgames");

const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULT_GAME = "connect4";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("API URL must not contain credentials, a query, or a fragment");
  }

  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  ) {
    throw new Error("API URL must use HTTPS, except for local loopback development");
  }

  return url.toString().replace(/\/$/, "");
}

interface Config {
  baseUrl: string;
  accessToken?: string;
  roomId?: string;
  roomCode?: string;
  wsUrl?: string;
  joinUrl?: string;
  gameType?: string;
}

function parseConfig(value: StoredConnectionConfig, fallbackBaseUrl: string): Config {
  const config: Config = { baseUrl: normalizeBaseUrl(value.baseUrl || fallbackBaseUrl) };

  if (value.accessToken) config.accessToken = value.accessToken;

  if (value.roomId) config.roomId = value.roomId;

  if (value.roomCode) config.roomCode = value.roomCode;

  if (value.wsUrl) config.wsUrl = value.wsUrl;

  if (value.joinUrl) config.joinUrl = value.joinUrl;

  if (value.gameType) config.gameType = value.gameType;

  return config;
}

function loadConfig(): Config {
  const envBaseUrl = process.env.LLMGAMES_API
    ? normalizeBaseUrl(process.env.LLMGAMES_API)
    : undefined;

  if (!existsSync(CONFIG_PATH)) {
    return { baseUrl: envBaseUrl || "http://localhost:6787" };
  }

  chmodSync(CONFIG_DIR, 0o700);
  chmodSync(CONFIG_PATH, 0o600);

  const file = parseConfig(
    storedConnectionSchema.parse(JSON.parse(readFileSync(CONFIG_PATH, "utf8"))),
    "http://localhost:6787",
  );

  const fileBaseUrl = file.baseUrl;
  const baseUrl = envBaseUrl || fileBaseUrl;

  const accessToken =
    !envBaseUrl || new URL(envBaseUrl).origin === new URL(fileBaseUrl).origin
      ? file.accessToken
      : undefined;

  const config: Config = { baseUrl };

  if (accessToken) config.accessToken = accessToken;

  if (file.roomId) config.roomId = file.roomId;

  if (file.roomCode) config.roomCode = file.roomCode;

  if (file.wsUrl) config.wsUrl = file.wsUrl;

  if (file.joinUrl) config.joinUrl = file.joinUrl;

  if (file.gameType) config.gameType = file.gameType;

  return config;
}

function saveConfig(cfg: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  chmodSync(CONFIG_DIR, 0o700);
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(CONFIG_PATH, 0o600);
}

function requireToken(cfg: Config): string {
  const token = process.env.LLMGAMES_ACCESS_TOKEN || cfg.accessToken;

  if (!token) {
    console.error(
      "No access token. Complete MCP OAuth in a host, then:\n" +
        "  llmgames config set-token <access_token>\n" +
        "or set LLMGAMES_ACCESS_TOKEN.\n" +
        "For agent vs agent, use remote MCP agent_claim (not this CLI).",
    );
    process.exit(1);
  }

  return token;
}

function clientFromConfig(cfg: Config): AgentClient {
  return new AgentClient({
    baseUrl: cfg.baseUrl,
    accessToken: requireToken(cfg),
  });
}

function requireRoom(cfg: Config) {
  if (!cfg.roomId || !cfg.wsUrl) {
    throw new Error("No room in config. Create or join one first.");
  }

  const room: RoomInfo = {
    roomId: cfg.roomId,
    roomCode: cfg.roomCode || "",
    wsUrl: cfg.wsUrl,
  };

  if (cfg.joinUrl) room.joinUrl = cfg.joinUrl;

  if (cfg.gameType) room.gameType = cfg.gameType;

  return room;
}

async function main(): Promise<void> {
  const [cmd, sub, ...rest] = process.argv.slice(2);
  const cfg = loadConfig();

  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(`llmgames — CLI (OAuth access token; multi-agent via remote MCP)

  config set-url URL           API base URL
  config set-token TOKEN       MCP OAuth access JWT
  config show

  room create [connect4]   Create room (browser-style human seat)
  room join CODE [--game T]    Join room by code
  start                        Host starts game
  play                         Connect and print events (Ctrl+C leave)
  drop COL                     Connect 4: drop_disc (col 0–6)
  state                        Print last state after reconnect
`);

    return;
  }

  if (cmd === "config" && sub === "set-url") {
    const nextBaseUrl = normalizeBaseUrl(rest[0] || cfg.baseUrl);

    if (cfg.accessToken && new URL(nextBaseUrl).origin !== new URL(cfg.baseUrl).origin) {
      throw new Error("Remove the saved token before changing API origins");
    }

    cfg.baseUrl = nextBaseUrl;
    saveConfig(cfg);
    console.log("baseUrl =", cfg.baseUrl);

    return;
  }

  if (cmd === "config" && sub === "set-token") {
    const token = rest[0];

    if (!token) {
      console.error("Usage: llmgames config set-token <access_token>");
      process.exit(1);
    }

    cfg.accessToken = token;
    saveConfig(cfg);
    console.log("accessToken saved to ~/.llmgames/config.json");

    return;
  }

  if (cmd === "config" && sub === "show") {
    console.log(
      JSON.stringify({ ...cfg, accessToken: cfg.accessToken ? "***" : undefined }, null, 2),
    );

    return;
  }

  if (cmd === "agent") {
    console.error(
      "API key minting was removed. Use remote MCP: OAuth → agent_claim → room_create.",
    );
    process.exit(1);
  }

  if (cmd === "room" && sub === "create") {
    const gameType = rest[0] || DEFAULT_GAME;
    const c = clientFromConfig(cfg);
    const room = await c.createRoom({ gameType });
    cfg.roomId = room.roomId;
    cfg.roomCode = room.roomCode;
    cfg.wsUrl = room.wsUrl;
    cfg.joinUrl = room.joinUrl;
    cfg.gameType = gameType;
    saveConfig(cfg);
    console.log(JSON.stringify(room, null, 2));

    if (room.joinUrl) console.log("\nJoin link:", room.joinUrl);

    return;
  }

  if (cmd === "room" && sub === "join") {
    const roomCode = (rest[0] || "").toUpperCase();

    const gameType = rest.includes("--game") ? rest[rest.indexOf("--game") + 1] : undefined;

    if (!roomCode) {
      console.error("Usage: llmgames room join CODE [--game legacy-game-hint]");
      process.exit(1);
    }

    const c = clientFromConfig(cfg);
    const room = await c.joinRoom({ roomCode, gameType });
    cfg.roomId = room.roomId;
    cfg.roomCode = room.roomCode;
    cfg.wsUrl = room.wsUrl;
    cfg.joinUrl = room.joinUrl;
    cfg.gameType = room.gameType || gameType;
    saveConfig(cfg);
    console.log(JSON.stringify(room, null, 2));

    return;
  }

  if (cmd === "play") {
    const c = clientFromConfig(cfg);

    if (!cfg.roomId || !cfg.wsUrl) {
      console.error("No room in config. create or join first.");
      process.exit(1);
    }

    const room = {
      roomId: cfg.roomId,
      roomCode: cfg.roomCode || "",
      wsUrl: cfg.wsUrl,
      joinUrl: cfg.joinUrl,
    };

    c.onMessage((type, payload) => {
      console.log(JSON.stringify({ type, payload }));
    });
    const state = await c.connect(room);
    console.log(JSON.stringify({ type: "ready", you: state.you, status: state.status }));
    process.on("SIGINT", () => {
      c.leave();
      process.exit(0);
    });
    await new Promise(() => {});

    return;
  }

  if (cmd === "start") {
    const c = clientFromConfig(cfg);
    await c.connect(requireRoom(cfg));
    c.startGame();
    console.log("start_game sent");
    await c.waitForMessage("game_started", 10000).catch(() => null);
    console.log(JSON.stringify(c.currentState?.you));
    c.leave();

    return;
  }

  if (cmd === "drop") {
    const col = Number(rest[0]);

    if (!Number.isInteger(col) || col < 0 || col > 6) {
      console.error("Usage: llmgames drop COL  (0–6)");
      process.exit(1);
    }

    const c = clientFromConfig(cfg);
    await c.connect(requireRoom(cfg));
    c.dropDisc(col);
    await sleep(500);
    console.log(JSON.stringify(c.currentState, null, 2));
    c.leave();

    return;
  }

  if (cmd === "state") {
    const c = clientFromConfig(cfg);
    await c.connect(requireRoom(cfg));
    console.log(JSON.stringify(c.currentState, null, 2));
    c.leave();

    return;
  }

  console.error("Unknown command. Run: llmgames help");
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
