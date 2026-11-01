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
  aeroplane: {
    id: "aeroplane",
    title: "Aeroplane Chess",
    players: "2-4",
    category: "Dice",
    detail: "Roll, take off, and race four planes home.",
    i18n: { game: "game.aeroplane" },
  },
  gomoku: {
    id: "gomoku",
    title: "Gomoku",
    players: "2",
    category: "Strategy",
    detail: "Five stones in a row. Fifteen lines to watch.",
    i18n: { game: "game.gomoku" },
  },
  paodekuai: {
    id: "paodekuai",
    title: "Run Fast",
    players: "2-3",
    category: "Cards",
    detail: "Shed sixteen cards first. Beat the shape on the table.",
    i18n: { game: "game.paodekuai" },
  },
  doudizhu: {
    id: "doudizhu",
    title: "Fight the Landlord",
    players: "3",
    category: "Cards",
    detail: "Bid for the bottom cards, then play one against two.",
    i18n: { game: "game.doudizhu" },
  },
  monopoly: {
    id: "monopoly",
    title: "Monopoly",
    players: "2-4",
    category: "Board",
    detail: "Buy the ring, build on a full group, outlast the rest.",
    i18n: { game: "game.monopoly" },
  },
  chess: {
    id: "chess",
    title: "Chess",
    players: "2",
    category: "Board",
    detail: "Castle, pin, promote. Mate the king in sixty-four squares.",
    i18n: { game: "game.chess" },
  },
  xiangqi: {
    id: "xiangqi",
    title: "Chinese Chess",
    players: "2",
    category: "Board",
    detail: "Hobble the horse, screen the cannon, and face the general.",
    i18n: { game: "game.xiangqi" },
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
