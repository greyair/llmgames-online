import type { GameTypeId, WireValue } from "@llmgames/game-catalog";
import type { ClientView } from "@/domain/game-state";
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/** Props every board renderer receives. Boards render projections and send intents only. */
export interface GameBoardProps {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
}

type LazyBoard = LazyExoticComponent<ComponentType<GameBoardProps>>;

const Battleship = lazy(() =>
  import("./Battleship").then(({ Battleship }) => ({ default: Battleship })),
);

const Discs = lazy(() => import("./Discs").then(({ Discs }) => ({ default: Discs })));

const Codenames = lazy(() =>
  import("./Codenames").then(({ Codenames }) => ({ default: Codenames })),
);

const Cards = lazy(() => import("./Cards").then(({ Cards }) => ({ default: Cards })));

const Pokemon = lazy(() => import("./Pokemon").then(({ Pokemon }) => ({ default: Pokemon })));

const Checkers = lazy(() => import("./Checkers").then(({ Checkers }) => ({ default: Checkers })));

const Contexto = lazy(() => import("./Contexto").then(({ Contexto }) => ({ default: Contexto })));

/**
 * Game id → board renderer.
 *
 * `Record<GameTypeId, LazyBoard>` is the compile-time gate: adding a public game
 * id fails the build until its board is registered here. Every entry is lazy, so
 * unrelated board code stays out of the first paint.
 */
const BOARDS: Readonly<Record<GameTypeId, LazyBoard>> = {
  connect4: Discs,
  reversi: Discs,
  checkers: Checkers,
  codenames: Codenames,
  poker: Cards,
  battleship: Battleship,
  pokemon: Pokemon,
  contexto: Contexto,
};

/** Renderer for a game, or null when this build does not ship that board. */
export function boardFor(gameType: string | undefined): LazyBoard | null {
  if (!gameType) return null;

  // SAFETY: `hasOwn` proves the key is present in a table typed as exactly the
  // GameTypeId union, so narrowing the server string to that union is sound.
  return Object.hasOwn(BOARDS, gameType) ? BOARDS[gameType as GameTypeId] : null;
}
