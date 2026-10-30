import type { GameTypeId, WireObject, WireValue } from "@llmgames/game-catalog";
import type { BaseGameState, GameRoomConfig } from "../durable-objects/types";

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
  | { ok: false; message: string };

/** Seat order is a platform decision: CSPRNG for casual rooms, coordinator for series. */
export interface GameStartContext {
  firstPlayerIndex: number;
  now: number;
}

/** Who the viewer is, in this game's terms. */
export interface GameSeatIdentity {
  seat: number | null;
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

  /** Game-specific intents this player may send now, on top of the shared lobby ones. */
  turnActions(state: TState, playerId: string, viewer: GameViewerContext): readonly string[];

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
  onMatchTimeout?(state: TState): void;

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
}
