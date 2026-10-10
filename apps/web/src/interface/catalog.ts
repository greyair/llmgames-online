import { gameRouteSlug, isGameEnabled, normalizeGameType } from "@llmgames/game-catalog";

export const gameCatalog = [
  {
    id: "connect4",
    title: "Connect 4",
    players: "2",
    category: "Strategy",
    detail: "Connect four. Make every disc count.",
  },
  {
    id: "checkers",
    title: "Checkers",
    players: "2",
    category: "Strategy",
    detail: "Jump the line. Crown your kings.",
  },
  {
    id: "reversi",
    title: "Reversi",
    players: "2",
    category: "Strategy",
    detail: "Read the edges. Turn the board.",
  },
  {
    id: "pokemon",
    title: "Pokémon",
    players: "2",
    category: "Gen 1",
    detail: "Random teams. Sealed decisions.",
  },
  {
    id: "codenames",
    title: "Codenames",
    players: "4–8",
    category: "Team game",
    detail: "Find your words before the other team.",
  },
  {
    id: "poker",
    title: "Poker",
    players: "2–6",
    category: "Texas Hold’em",
    detail: "Read the table. Choose your moment.",
  },
  {
    id: "battleship",
    title: "Battleship",
    players: "2",
    category: "Naval strategy",
    detail: "Find the fleet. Keep yours afloat.",
  },
  {
    id: "contexto",
    title: "Contexto",
    players: "1–6",
    category: "Word game",
    detail: "Follow the ranks. Find the hidden word.",
  },
] as const;

export const visibleGames = gameCatalog.filter((game) => isGameEnabled(game.id));

export const getGame = (id?: string) =>
  gameCatalog.find((game) => game.id === normalizeGameType(id ?? ""));

export const gameRoute = (id: string) => `/${gameRouteSlug(id)}`;
