import { knownValue } from "@/domain/view-contracts";
import { gameCatalog, getGame } from "../interface/catalog";
import { roomGuides } from "../interface/gameRules";
import { gameRouteSlug } from "@llmgames/game-catalog";

export const SITE_URL = import.meta.env.PUBLIC_SITE_URL || "http://localhost:3000";

export const SITE_NAME = "llmgames";

export const SOCIAL_IMAGE = `${SITE_URL}/og/llmgames-dither-v1.png`;

export const SOCIAL_IMAGE_ALT =
  "llmgames.online. Can your AI beat you? Pixel game icons for Connect 4, Poker, Codenames, Pokémon, Checkers, Battleship, Reversi and Contexto over a dithered pastel field.";

export const HOME_TITLE = "llmgames | Multiplayer games for humans and AI agents";

export const HOME_DESCRIPTION =
  "Pick a game. Invite your friends or your own AI agent. Play Pokémon, Poker, Codenames, and more in your browser.";

const pages = {
  "ai-spec": {
    title: "How AI plays: Jev and MCP specification",
    description:
      "See what AI agents receive and send in every LLM Games game. Read the hosted Jev request format, MCP tool schemas, privacy boundaries and action definitions.",
  },
  series: {
    title: "Game series",
    description: "Configure repeated matches across games, rotate seats, and compare results.",
  },
  play: {
    title: "Pick a game",
    description:
      "Find your next game of Pokémon, Poker, Checkers, Reversi, Codenames, and more. Create a room or join friends and AI agents with a room code.",
  },
  watch: {
    title: "Broadcasts have ended",
    description: "We no longer stream games. Join friends or bring your AI agent to a room.",
  },
  setup: {
    title: "Connect your AI agent through MCP",
    description:
      "Bring your own AI to llmgames. Connect an app that supports remote MCP, sign in, and ask your agent to create a room or join your friends.",
  },
  login: {
    title: "Sign in",
    description: "Sign in to llmgames to join a room, invite friends, and connect your AI agents.",
  },
  onboarding: {
    title: "Choose your player name",
    description: "Set up your llmgames profile and take a seat.",
  },
  profile: {
    title: "Your profile",
    description:
      "View your player name and manage sessions, agent webhooks, and TypeSafe settings.",
  },
  "agent-log": {
    title: "Your AI agents",
    description: "Manage your llmgames agents and look back at their games.",
  },
  history: {
    title: "Your game history",
    description: "Look back at your llmgames matches and open your saved replays.",
  },
  privacy: {
    title: "Privacy policy",
    description:
      "Read how llmgames handles account information, game data, and AI agent connections.",
  },
  terms: {
    title: "Terms of service",
    description:
      "Read the terms for using llmgames, joining multiplayer rooms, connecting AI agents, and sharing games.",
  },
} satisfies Record<string, { title: string; description: string }>;

const ACCOUNT_PAGE_PATHS = ["login", "onboarding", "profile", "agent-log", "history"];

const GAME_APP_PATHS = gameCatalog.map((game) => gameRouteSlug(game.id));

const GAME_INFO_PATHS = gameCatalog.map((game) => `games/${gameRouteSlug(game.id)}`);

// Astro must prerender both public pages and client-side app entry points.
export const STATIC_PAGE_PATHS = [
  ...Object.keys(pages),
  "connect-ai",
  ...GAME_APP_PATHS,
  ...GAME_INFO_PATHS,
];

// Search engines should only receive stable, public 200 pages. Account pages and
// game-room entry points can redirect after hydration and do not belong here.
export const SITEMAP_PAGE_PATHS = [
  "ai-spec",
  "play",
  "setup",
  "privacy",
  "terms",
  ...GAME_INFO_PATHS,
];

const NOINDEX_PAGE_PATHS = new Set(["watch", "series", ...ACCOUNT_PAGE_PATHS, ...GAME_APP_PATHS]);

export function pageMetadata(path: string) {
  const key = path === "connect-ai" ? "setup" : path;
  const game = getGame(key.startsWith("games/") ? key.slice(6) : key);

  const page = game
    ? {
        title: `${game.title}${game.id === "pokemon" ? " Gen 1 random battles" : " online"}`,
        description: `${roomGuides[game.id]?.description ?? game.detail} Play with friends or your own AI agent on llmgames.`,
      }
    : knownValue(pages, key);

  return {
    title: page ? `${page.title} | ${SITE_NAME}` : HOME_TITLE,
    description: page?.description ?? HOME_DESCRIPTION,
    canonicalPath: `/${key}`,
    noindex: NOINDEX_PAGE_PATHS.has(key),
  };
}
