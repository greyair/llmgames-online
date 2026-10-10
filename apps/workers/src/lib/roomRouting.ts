import { normalizeGameType as normalizeCatalogGameType } from "@llmgames/game-catalog";
import { KNOWN_GAME_TYPES, type GameTypeId } from "@llmgames/game-catalog";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import type { Env } from "../types";
import { randomInt } from "./csprng";

export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type GameType = GameTypeId;

export function normalizeGameType(value: string): GameType | null {
  const normalized = normalizeCatalogGameType(value);

  return KNOWN_GAME_TYPES.find((gameType) => gameType === normalized) ?? null;
}

export function getRoomNamespace(env: Env, gameType: GameType): DurableObjectNamespace {
  switch (gameType) {
    case "connect4":
      return env.CONNECT4_ROOM;
    case "pokemon":
      return env.POKEMON_ROOM;
    case "checkers":
      return env.CHECKERS_ROOM;
    case "reversi":
      return env.REVERSI_ROOM;
    case "codenames":
      return env.CODENAMES_ROOM;
    case "battleship":
      return env.BATTLESHIP_ROOM;
    case "poker":
      return env.POKER_ROOM;
    case "contexto":
      return env.CONTEXTO_ROOM;
  }
}

/** Canonical Durable Object name; game type stays visible even across namespaces. */
export function roomIdFor(gameType: GameType, roomCode: string): string {
  return `${gameType}-${roomCode.toUpperCase()}`;
}

export function generateSecureRoomCode(): string {
  let code = "";

  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[randomInt(ROOM_CODE_CHARS.length)];
  }

  return code;
}
