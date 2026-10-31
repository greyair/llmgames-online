import { z } from "zod";
import { isString, type WireObject } from "./value-contracts.js";

/**
 * Compact decision state for agents (M3.10).
 *
 * The platform owns the frame: series, type, status, phase, turn, clocks and
 * the legal actions that are actually decisions. The game owns the fields,
 * because only the game knows how to shrink its own projection — a board of
 * numbers becomes rows of digits, a poker seat loses the cards its holder may
 * not see, a card grid becomes tuples.
 *
 * `agentDecision` is therefore a plugin hook, not a branch in this file: a new
 * game ships its compaction next to its rules and never edits the shared
 * package.
 */

export interface ProjectionPart {
  rivalProgress?: unknown;
  yourProgress?: unknown;
  fleetFormat?: unknown;
  targetGridFormat?: unknown;
  ownGridFormat?: unknown;
  currentSeat?: unknown;
  boardFormat?: unknown;
  legalColumns?: unknown;
  gameType?: unknown;
  series?: unknown;
  winnerSeat?: unknown;
  yourSeat?: unknown;
  sides?: unknown;
  decision?: unknown;
  battleLog?: unknown;
  battleTurn?: unknown;
  format?: unknown;
  type?: unknown;
  status?: unknown;
  updatedAt?: unknown;
  you?: unknown;
  turnState?: unknown;
  currentPlayerId?: unknown;
  turnNumber?: unknown;
  phase?: unknown;
  gameTimeRemaining?: unknown;
  turnTimeRemaining?: unknown;
  playerId?: unknown;
  legalActions?: unknown;
  team?: unknown;
  role?: unknown;
  board?: unknown;
  seats?: unknown;
  winner?: unknown;
  lastMove?: unknown;
  scores?: unknown;
  legalMoves?: unknown;
  forcedPiece?: unknown;
  quietTurns?: unknown;
  lastPass?: unknown;
  index?: unknown;
  word?: unknown;
  revealed?: unknown;
  affiliation?: unknown;
  clue?: unknown;
  count?: unknown;
  activeTeam?: unknown;
  guessesRemaining?: unknown;
  guessesMade?: unknown;
  remaining?: unknown;
  lastReveal?: unknown;
  winnerTeam?: unknown;
  cards?: unknown;
  rank?: unknown;
  cardCount?: unknown;
  bet?: unknown;
  chips?: unknown;
  total?: unknown;
  handNumber?: unknown;
  boardSize?: unknown;
  yourBoard?: unknown;
  opponent?: unknown;
  munitionEconomy?: unknown;
  fleet?: unknown;
  ships?: unknown;
  cells?: unknown;
  mines?: unknown;
  incomingHits?: unknown;
  incomingMisses?: unknown;
  ready?: unknown;
  fleetReady?: unknown;
  weaponCosts?: unknown;
  munitionPoints?: unknown;
  yourPoints?: unknown;
  costs?: unknown;
  cannonReward?: unknown;
  turnReward?: unknown;
  damageReward?: unknown;
  hits?: unknown;
  misses?: unknown;
  radarScans?: unknown;
  row?: unknown;
  col?: unknown;
  shipsRemaining?: unknown;
  sunkShips?: unknown;
  lastAnnouncement?: unknown;
  community?: unknown;
  pot?: unknown;
  currentBet?: unknown;
  minRaise?: unknown;
  toCall?: unknown;
  canCheck?: unknown;
  buttonPlayerId?: unknown;
  smallBlindPlayerId?: unknown;
  bigBlindPlayerId?: unknown;
  blinds?: unknown;
  actionLog?: unknown;
  action?: unknown;
  amount?: unknown;
  street?: unknown;
  lastHandResult?: unknown;
  stack?: unknown;
  streetBet?: unknown;
  handContributed?: unknown;
  folded?: unknown;
  allIn?: unknown;
  sittingOut?: unknown;
  hole?: unknown;
  entries?: unknown;
  omitted?: unknown;
  actionHistory?: unknown;
  targetGrid?: unknown;
  ownGrid?: unknown;
  progress?: unknown;
  guessLimit?: unknown;
  vocabularySize?: unknown;
  totalGuesses?: unknown;
  secret?: unknown;
}

const NON_DECISION_ACTIONS = new Set([
  "add_jev",
  "remove_jev",
  "leave",
  "start_game",
  "kick_player",
  "move_player_to_spectator",
  "set_host_spectating",
  "set_player_seats",
  "end_game",
  "assign_codenames_role",
  "reset_codenames_roles",
  "randomize_codenames_roles",
]);

const objectValue = z
  .object({
    series: z.unknown().optional(),
    winnerSeat: z.unknown().optional(),
    yourSeat: z.unknown().optional(),
    sides: z.unknown().optional(),
    decision: z.unknown().optional(),
    battleLog: z.unknown().optional(),
    battleTurn: z.unknown().optional(),
    format: z.unknown().optional(),
    type: z.unknown().optional(),
    status: z.unknown().optional(),
    updatedAt: z.unknown().optional(),
    you: z.unknown().optional(),
    turnState: z.unknown().optional(),
    currentPlayerId: z.unknown().optional(),
    turnNumber: z.unknown().optional(),
    phase: z.unknown().optional(),
    gameTimeRemaining: z.unknown().optional(),
    turnTimeRemaining: z.unknown().optional(),
    playerId: z.unknown().optional(),
    legalActions: z.unknown().optional(),
    team: z.unknown().optional(),
    role: z.unknown().optional(),
    board: z.unknown().optional(),
    seats: z.unknown().optional(),
    winner: z.unknown().optional(),
    lastMove: z.unknown().optional(),
    scores: z.unknown().optional(),
    legalMoves: z.unknown().optional(),
    forcedPiece: z.unknown().optional(),
    quietTurns: z.unknown().optional(),
    lastPass: z.unknown().optional(),
    index: z.unknown().optional(),
    word: z.unknown().optional(),
    revealed: z.unknown().optional(),
    affiliation: z.unknown().optional(),
    clue: z.unknown().optional(),
    count: z.unknown().optional(),
    activeTeam: z.unknown().optional(),
    guessesRemaining: z.unknown().optional(),
    guessesMade: z.unknown().optional(),
    remaining: z.unknown().optional(),
    lastReveal: z.unknown().optional(),
    winnerTeam: z.unknown().optional(),
    cards: z.unknown().optional(),
    rank: z.unknown().optional(),
    cardCount: z.unknown().optional(),
    bet: z.unknown().optional(),
    chips: z.unknown().optional(),
    total: z.unknown().optional(),
    handNumber: z.unknown().optional(),
    boardSize: z.unknown().optional(),
    yourBoard: z.unknown().optional(),
    opponent: z.unknown().optional(),
    munitionEconomy: z.unknown().optional(),
    fleet: z.unknown().optional(),
    ships: z.unknown().optional(),
    cells: z.unknown().optional(),
    mines: z.unknown().optional(),
    incomingHits: z.unknown().optional(),
    incomingMisses: z.unknown().optional(),
    ready: z.unknown().optional(),
    munitionPoints: z.unknown().optional(),
    yourPoints: z.unknown().optional(),
    costs: z.unknown().optional(),
    cannonReward: z.unknown().optional(),
    turnReward: z.unknown().optional(),
    damageReward: z.unknown().optional(),
    hits: z.unknown().optional(),
    misses: z.unknown().optional(),
    radarScans: z.unknown().optional(),
    row: z.unknown().optional(),
    col: z.unknown().optional(),
    shipsRemaining: z.unknown().optional(),
    sunkShips: z.unknown().optional(),
    lastAnnouncement: z.unknown().optional(),
    community: z.unknown().optional(),
    pot: z.unknown().optional(),
    currentBet: z.unknown().optional(),
    minRaise: z.unknown().optional(),
    toCall: z.unknown().optional(),
    canCheck: z.unknown().optional(),
    buttonPlayerId: z.unknown().optional(),
    smallBlindPlayerId: z.unknown().optional(),
    bigBlindPlayerId: z.unknown().optional(),
    blinds: z.unknown().optional(),
    actionLog: z.unknown().optional(),
    action: z.unknown().optional(),
    amount: z.unknown().optional(),
    street: z.unknown().optional(),
    lastHandResult: z.unknown().optional(),
    stack: z.unknown().optional(),
    streetBet: z.unknown().optional(),
    handContributed: z.unknown().optional(),
    folded: z.unknown().optional(),
    allIn: z.unknown().optional(),
    sittingOut: z.unknown().optional(),
    hole: z.unknown().optional(),
    entries: z.unknown().optional(),
    omitted: z.unknown().optional(),
    actionHistory: z.unknown().optional(),
    targetGrid: z.unknown().optional(),
    ownGrid: z.unknown().optional(),
    progress: z.unknown().optional(),
    guessLimit: z.unknown().optional(),
    vocabularySize: z.unknown().optional(),
    totalGuesses: z.unknown().optional(),
    secret: z.unknown().optional(),
  })
  .loose()
  .nullable()
  .catch(null).parse;

export const arrayValue = z.array(z.unknown()).catch([]).parse;

/** Drop undefined entries so an absent field costs nothing in the token budget. */
export function defined<T extends object>(value: T): Partial<T> {
  // SAFETY: Only undefined entries are removed; all retained keys and their original T value types are unchanged.
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>;
}

export const stringValue = z.string().optional().catch(undefined).parse;

export const numberValue = z.number().optional().catch(undefined).parse;

/** Read a projected record, or null when the value is not one. */
export const projectionPart = objectValue;

export const encodeNumericBoard = z
  .array(z.array(z.number().int()))
  .optional()
  .catch(undefined)
  .transform((board) => board?.map((row) => row.join(""))).parse;

export const seatMap = z.record(z.string(), z.number()).catch({}).parse;

export function seatFor(
  seats: ProjectionPart | null,
  playerId: string | undefined,
): number | undefined {
  return isString(playerId) && seats ? seatMap(seats)[playerId] : undefined;
}

export function winnerForSeats(
  state: ProjectionPart,
  seats: ProjectionPart | null,
): string | number | null | undefined {
  const winner = state.winner;

  if (winner === null) return null;

  return winner === "draw" ? "draw" : seatFor(seats, stringValue(winner));
}

export const projectedEntries = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const part = objectValue(entry);

      return part ? [part] : [];
    }),
  ).parse;

/**
 * Collect game fields into a wire object.
 *
 * Compactors read values straight out of a parsed projection, so every entry is
 * already a wire value; typing each one as `unknown` would only force narrowing
 * that buys nothing here.
 */
export function agentFields<T extends object>(fields: T): WireObject {
  // SAFETY: every value is read from a JSON projection parsed by `projectionPart`.
  return defined(fields) as WireObject;
}

/**
 * Game-owned part of a compact decision state.
 *
 * `legalActions` is the platform's filtered list, so a game never has to repeat
 * which lobby intents are not decisions.
 */
export type AgentDecisionFields = (
  view: ProjectionPart,
  legalActions: readonly string[],
) => WireObject;

/** Keys the platform frame restates, so a game never pays for them twice. */
const RESTATED_VIEW_KEYS = new Set([
  "type",
  "players",
  "roomMembers",
  "turnState",
  "gameTimeRemaining",
  "series",
]);

/**
 * Fallback for a caller that has a view but no rule module.
 *
 * The local stdio bridge relays the socket view and lives in its own package, so
 * it cannot see the game plugins. It still gets the platform frame and the
 * roster trimmed; the game's own fields pass through untouched rather than
 * being silently dropped.
 */
function passthroughFields(state: ProjectionPart): WireObject {
  // SAFETY: every entry comes from a JSON projection; only bookkeeping is dropped.
  return Object.fromEntries(
    Object.entries(state).filter(([key]) => !RESTATED_VIEW_KEYS.has(key)),
  ) as WireObject;
}

/**
 * Reduce a fog-of-war-safe game projection to the fields the model needs for
 * one decision. This deliberately excludes room rosters, display metadata,
 * static rules, and host table controls. `get_state` remains the explicit rich
 * inspection tool.
 *
 * Without `fields` the game's own keys are passed through as they are: only a
 * rule module knows how to shrink them.
 */
export function compactAgentDecisionState(
  state: ProjectionPart | null,
  fields?: AgentDecisionFields,
): ProjectionPart | null {
  if (!state) return null;

  const you = objectValue(state.you);
  const turn = objectValue(state.turnState);

  const legalActions = arrayValue(you?.legalActions)
    .filter((action): action is string => isString(action))
    .filter((action) => !NON_DECISION_ACTIONS.has(action));

  const common = defined({
    series: state.series,
    gameType: stringValue(state.type) ?? "unknown",
    status: state.status,
    phase: turn?.phase ?? you?.phase,
    turnNumber: turn?.turnNumber,
    gameTimeRemaining: state.gameTimeRemaining,
    turnTimeRemaining: turn?.turnTimeRemaining,
    legalActions,
  });

  return defined({
    ...common,
    ...(fields ? fields(state, legalActions) : passthroughFields(state)),
  });
}
