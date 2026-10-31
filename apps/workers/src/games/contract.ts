import type {
  AgentDecisionFields,
  GameTypeId,
  WireObject,
  WireValue,
} from "@llmgames/game-catalog";
import type { BaseGameState, GameRoomConfig } from "../durable-objects/types";
import type { StartGameProblem } from "../durable-objects/actionErrors";

/**
 * Game interface for M3.
 *
 * A rule module owns only what is specific to one game: the initial state, the
 * legal turn intents, the state transition, the per-seat identity and the
 * agent-facing fields. Everything else — Durable Object lifecycle, seats,
 * sockets, clocks, idempotent receipts, persistence, archives and replay — stays
 * in the platform layer (`BaseGameRoom` and its adapters).
 *
 * Rules are pure with respect to the platform: they mutate the state they are
 * given and describe side effects as {@link GameEffect} values. They never call
 * storage, timers, broadcasts or `Date.now()` behind the adapter's back.
 */

/** One player intent after the platform has checked identity, phase and timing. */
export interface GameIntent {
  actionType: string;
  data: WireValue;
}

/**
 * Side effects a rule module asks the platform to perform, in order.
 *
 * - `event`        append to the replay/audit log (`recordEvent`)
 * - `stop_timers`  clear the running match and turn clocks
 * - `match_ended`  persist, then broadcast the projected final state
 */
export type GameEffect =
  | { type: "event"; event: string; data?: WireValue }
  | { type: "stop_timers" }
  | { type: "match_ended"; reason: string };

/** A rejected intent carries the exact English message legacy clients already read. */
export type GameActionResult =
  | { ok: true; effects: readonly GameEffect[] }
  | {
      ok: false;
      message: string;
      /**
       * The intent is refused but the attempt itself belongs in the state.
       *
       * Contexto records a word outside its dictionary on the seat's progress so
       * every client can show "not in pool" next to the guess box, then answers
       * 400 so an agent reads it as bad input rather than a rule violation. The
       * adapter persists and broadcasts before it reports the rejection; a
       * plugin that leaves this unset keeps the plain "state is untouched"
       * contract.
       */
      persist?: boolean;
    };

/** Seat order is a platform decision: CSPRNG for casual rooms, coordinator for series. */
export interface GameStartContext {
  firstPlayerIndex: number;
  now: number;
}

/** Who the viewer is, in this game's terms. */
export interface GameSeatIdentity {
  /**
   * Numeric seat, or omitted when the game does not expose one.
   *
   * Battleship is the first such game: its clients read `role` and the munition
   * wallet, and adding `seat: null` would change a public `you` shape that never
   * had the key.
   */
  seat?: number | null;
  /**
   * Role label the client reads (`player1`, `black`, …). Omit it when the game
   * projects no role at all — adding a key changes the public `you` shape.
   */
  role?: string | null;
  /** Game-specific display tag the client reads, e.g. Reversi's disc colour. */
  color?: string | null;
}

/** Everything a rule module needs to know about the viewer before offering an intent. */
export interface GameViewerContext {
  isSpectator: boolean;
}

/** Nominal id used for diagnostics and registry lookups. */
export type GamePluginId = GameTypeId;

export interface GamePlugin<TState extends BaseGameState, TId extends string = GamePluginId> {
  /** Stable public game id; must match the Durable Object's `state.type`. */
  readonly id: TId;
  /** Seats required before the host may start (the lobby enforces this). */
  readonly minPlayersToStart: number;
  /** Phase the platform writes when the match starts (e.g. `play`, `preflop`). */
  readonly initialTurnPhase: string;

  /** Lobby state before anyone has played. */
  createInitialState(config: GameRoomConfig, roomCode: string, now: number): TState;

  /** Assign seats, deal or reset the board and set the first turn. */
  start(state: TState, context: GameStartContext): void;

  /**
   * Extra check before the lobby may start the match.
   *
   * Codenames refuses to start unless every seat holds a role and both teams are
   * balanced; the platform reports the message and code unchanged.
   */
  validateStart?(state: TState): StartGameProblem | null;

  /**
   * A seat was promoted to player or moved to spectator.
   *
   * Codenames drops the role of a player who starts watching, so a stale team
   * assignment cannot keep the key visible.
   */
  onMemberRoleChanged?(state: TState, playerId: string, role: "player" | "spectator"): void;

  /** Game-specific intents this player may send now, on top of the shared lobby ones. */
  turnActions(state: TState, playerId: string, viewer: GameViewerContext): readonly string[];

  /**
   * Extra game-owned fields merged into the browser `you` block.
   *
   * Mirrors `agentFields` for the human view: Battleship adds its munition
   * wallet and `ready` flag, and Codenames will add `team`/`canSeeKey`. The
   * adapter merges it, so platform keys such as `legalActions` keep their value.
   */
  youFields?(state: TState, playerId: string, viewer: GameViewerContext): WireObject;

  /**
   * Whether this player may decide right now.
   *
   * Omitted means "only the seat in `turnState.currentPlayerId`". Games with
   * simultaneous or role-scoped decisions (Battleship's concurrent fleet
   * placement, Codenames' team-wide guessing, Pokémon's sealed turn) widen it.
   * The platform uses this one answer for `wait_for_turn`, the projected
   * `isYourTurn` flag, series metrics and turn resolution.
   */
  mayActNow?(state: TState, playerId: string): boolean;

  /**
   * Wall-clock time from which a decision may be taken again.
   *
   * Poker shows the finished hand for five seconds before anyone can deal the
   * next one. The platform waits for this instant before answering
   * `wait_for_turn` and before offering legal actions; every other game returns
   * 0 (immediately ready).
   */
  decisionReadyAt?(state: TState): number;

  /** Seat number and role shown to this player, or `{ seat: null, role: "spectator" }`. */
  seatIdentity(state: TState, playerId: string, viewer: GameViewerContext): GameSeatIdentity;

  /** Validate and apply one intent. Rejections must not change the state. */
  applyAction(state: TState, playerId: string, intent: GameIntent, now: number): GameActionResult;

  /** Game-specific turn-timeout policy. Omitted means "pass the turn" (platform default). */
  onTurnTimeout?(state: TState, playerId: string | null, now: number): readonly GameEffect[];

  /**
   * Match-clock expiry. Omitted means "no game-specific result", which leaves
   * the platform's own time-up handling in charge.
   */
  onMatchTimeout?(state: TState, now: number): void;

  /** Recipient-safe view of the state. Omitted means the whole state is public. */
  projectState?(state: TState, playerId: string): object;

  /**
   * Full-reveal projection recorded in replay frames.
   *
   * Omitted means "the whole state", which is right for games with nothing to
   * hide at the end. Games that carry internal bookkeeping (Checkers records
   * repetition keys) return a projection that strips it.
   */
  rewatchView?(state: TState): object;

  /**
   * Extra MCP decision fields for this game.
   *
   * The platform passes the **already projected** state for this recipient, so a
   * rule module cannot widen what a player is allowed to see: anything its
   * `projectState` hid is absent here too. Platform-owned keys (`type`,
   * `status`, `players`, `roomMembers`, `gameTimeRemaining`, `turnState`,
   * `winner`, `you`, `series`) are ignored if a plugin returns them.
   */
  agentFields?(projection: WireObject): WireObject;

  /**
   * The game-owned half of the compact MCP decision state.
   *
   * The platform owns the frame — `gameType`, status, phase, turn, clocks and
   * the legal actions that are actually decisions — and this returns the rest,
   * shrunk for a model: digit rows instead of nested number arrays, card tuples
   * instead of card objects, no field a rival may not read.
   *
   * It lives beside `agentFields` on purpose: the rich view and the compact view
   * of one game are written by the same author in the same file, so a new field
   * cannot quietly reach one and miss the other.
   */
  agentDecision?: AgentDecisionFields;
}
