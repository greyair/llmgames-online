import type { GameTypeId } from "./index.js";

/**
 * One game's public identity.
 *
 * The browser, the AI-spec export and any future generic room read a game from
 * here instead of restating its name in several tables. Rules stay in the game
 * itself: this is description, not behaviour.
 */
export interface GameManifest {
  /** Stable machine id; never translated and never reused. */
  id: GameTypeId;
  /** English fallback copy; the browser prefers `game.<id>.*` translations. */
  title: string;
  /** Human-readable seat range shown in the library. */
  players: string;
  category: string;
  detail: string;
  /**
   * Translation namespace the game owns under `apps/web/src/i18n/locales`.
   *
   * `game.<id>.*` holds `title`, `category`, `detail`, `hook` and `hint` in both
   * shipped locales, and `apps/web/tests/i18n/gameManifest.test.ts` fails if a
   * game ships without them. Board copy stays in the shared flat `board.*`
   * namespace: it is shared vocabulary ("row", "column", "captured pieces"),
   * not a per-game table, and M3 does not rework it.
   */
  i18n: { game: string };
}

/**
 * Single declaration of every game's metadata (M3).
 *
 * `satisfies Record<GameTypeId, GameManifest>` is the compile-time check: a new
 * id in `GameTypeId` fails the build until its manifest exists, and an unknown
 * key fails too. Order here is the order the library and the AI spec use.
 */
export const GAME_MANIFESTS = {
  connect4: {
    id: "connect4",
    title: "Connect 4",
    players: "2",
    category: "Strategy",
    detail: "Connect four. Make every disc count.",
    i18n: { game: "game.connect4" },
  },
  checkers: {
    id: "checkers",
    title: "Checkers",
    players: "2",
    category: "Strategy",
    detail: "Jump the line. Crown your kings.",
    i18n: { game: "game.checkers" },
  },
  reversi: {
    id: "reversi",
    title: "Reversi",
    players: "2",
    category: "Strategy",
    detail: "Read the edges. Turn the board.",
    i18n: { game: "game.reversi" },
  },
  pokemon: {
    id: "pokemon",
    title: "Pokémon",
    players: "2",
    category: "Gen 1",
    detail: "Random teams. Sealed decisions.",
    i18n: { game: "game.pokemon" },
  },
  codenames: {
    id: "codenames",
    title: "Codenames",
    players: "4–8",
    category: "Team game",
    detail: "Find your words before the other team.",
    i18n: { game: "game.codenames" },
  },
  poker: {
    id: "poker",
    title: "Poker",
    players: "2–6",
    category: "Texas Hold’em",
    detail: "Read the table. Choose your moment.",
    i18n: { game: "game.poker" },
  },
  battleship: {
    id: "battleship",
    title: "Battleship",
    players: "2",
    category: "Naval strategy",
    detail: "Find the fleet. Keep yours afloat.",
    i18n: { game: "game.battleship" },
  },
  contexto: {
    id: "contexto",
    title: "Contexto",
    players: "1–6",
    category: "Word game",
    detail: "Follow the ranks. Find the hidden word.",
    i18n: { game: "game.contexto" },
  },
} satisfies Record<GameTypeId, GameManifest>;

/** Manifest for a public game id, or null for an unknown/test-only id. */
export function gameManifest(gameType: string): GameManifest | null {
  // SAFETY: `hasOwn` proves the key exists in a table typed as exactly the
  // GameTypeId union, so narrowing the caller's string to that union is sound.
  return Object.hasOwn(GAME_MANIFESTS, gameType) ? GAME_MANIFESTS[gameType as GameTypeId] : null;
}
