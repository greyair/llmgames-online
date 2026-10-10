import { z } from "zod";
import { isNumber, isObject, isString } from "./value-contracts.js";

import { battleshipAgentState } from "./battleship-state.js";

interface ProjectionPart {
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

const arrayValue = z.array(z.unknown()).catch([]).parse;

function defined<T extends object>(value: T): Partial<T> {
  // SAFETY: Only undefined entries are removed; all retained keys and their original T value types are unchanged.
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>;
}

const stringValue = z.string().optional().catch(undefined).parse;

const numberValue = z.number().optional().catch(undefined).parse;

const encodeNumericBoard = z
  .array(z.array(z.number().int()))
  .optional()
  .catch(undefined)
  .transform((board) => board?.map((row) => row.join(""))).parse;

const seatMap = z.record(z.string(), z.number()).catch({}).parse;

function seatFor(seats: ProjectionPart | null, playerId: string | undefined): number | undefined {
  return isString(playerId) && seats ? seatMap(seats)[playerId] : undefined;
}

function winnerForSeats(
  state: ProjectionPart,
  seats: ProjectionPart | null,
): string | number | null | undefined {
  const winner = state.winner;

  if (winner === null) return null;

  return winner === "draw" ? "draw" : seatFor(seats, stringValue(winner));
}

function compactPokerSeats(value: readonly ProjectionPart[], playerId: string | undefined) {
  return value.flatMap((entry) => {
    const seat = objectValue(entry);

    if (!seat) return [];
    const isYou = isString(playerId) && seat.playerId === playerId;
    const hole = arrayValue(seat.hole);
    const visibleHole = hole.some((card) => objectValue(card)?.rank !== "?");

    return [
      defined({
        playerId: seat.playerId,
        isYou,
        stack: seat.stack,
        streetBet: seat.streetBet,
        contributed: seat.handContributed,
        folded: seat.folded,
        allIn: seat.allIn,
        sittingOut: seat.sittingOut,
        hole: isYou || visibleHole ? seat.hole : undefined,
      }),
    ];
  });
}

function compactPokerActions(value: readonly ProjectionPart[], handNumber: number | undefined) {
  const entries = value.filter((entry) => {
    const actionHand = objectValue(entry)?.handNumber;

    return handNumber === undefined || actionHand === undefined || actionHand === handNumber;
  });

  const kept = entries.slice(-24).flatMap((entry) => {
    const action = objectValue(entry);

    if (!action) return [];

    return [
      defined({
        playerId: action.playerId,
        action: action.action,
        amount: action.amount,
        street: action.street,
      }),
    ];
  });

  return {
    entries: kept,
    omitted: Math.max(0, entries.length - kept.length),
  };
}

/**
 * Reduce a fog-of-war-safe game projection to the fields the model needs for
 * one decision. This deliberately excludes room rosters, display metadata,
 * static rules, and host table controls. `get_state` remains the explicit rich
 * inspection tool.
 */
const projectedEntries = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const part = objectValue(entry);

      return part ? [part] : [];
    }),
  ).parse;

export const compactAgentDecisionState = z.unknown().transform((value): ProjectionPart | null => {
  const state = objectValue(value);

  if (!state) return null;
  const you = objectValue(state.you);
  const turn = objectValue(state.turnState);
  const playerId = stringValue(you?.playerId);
  const gameType = stringValue(state.type) ?? "unknown";

  const legalActions = arrayValue(you?.legalActions)
    .filter((action): action is string => isString(action))
    .filter((action) => !NON_DECISION_ACTIONS.has(action));

  const common = defined({
    series: state.series,
    gameType,
    status: state.status,
    phase: turn?.phase ?? you?.phase,
    turnNumber: turn?.turnNumber,
    gameTimeRemaining: state.gameTimeRemaining,
    turnTimeRemaining: turn?.turnTimeRemaining,
    legalActions,
  });

  if (gameType === "connect4" || gameType === "reversi" || gameType === "checkers") {
    const seats = objectValue(state.seats);
    const board = encodeNumericBoard(state.board);

    const game = defined({
      ...common,
      board,
      boardFormat: board
        ? "zero-based rows top-to-bottom, columns left-to-right; 0 empty, 1 seat 1, 2 seat 2"
        : undefined,
      yourSeat: seatFor(seats, playerId),
      currentSeat: seatFor(seats, stringValue(turn?.currentPlayerId)),
      winnerSeat: winnerForSeats(state, seats),
      lastMove: state.lastMove,
    });

    if (gameType === "checkers")
      return defined({
        ...game,
        boardFormat:
          "zero-based rows top-to-bottom, columns left-to-right; 0 empty, 1 black man, 2 white man, 3 black king, 4 white king; seat 1 black moves toward row 0, seat 2 white toward row 7; kings move both ways",
        scores: state.scores,
        forcedPiece: state.forcedPiece,
        quietTurns: state.quietTurns,
        legalMoves: legalActions.includes("move_checker") ? state.legalMoves : [],
      });

    if (gameType === "connect4") {
      const top = board?.[0];

      return defined({
        ...game,
        legalColumns:
          top && legalActions.includes("drop_disc")
            ? [...top].flatMap((cell, col) => (cell === "0" ? [col] : []))
            : [],
      });
    }

    return defined({
      ...game,
      scores: state.scores,
      legalMoves: legalActions.includes("place_disc") ? state.legalMoves : [],
      lastPass: state.lastPass,
    });
  }

  if (gameType === "pokemon")
    return defined({
      ...common,
      format: state.format,
      yourSeat: state.yourSeat,
      sides: state.sides,
      decision: state.decision,
      battleLog: state.battleLog,
      winner: state.winnerSeat,
    });

  if (gameType === "contexto") {
    const progress = objectValue(state.progress);

    return defined({
      ...common,
      guessLimit: state.guessLimit,
      vocabularySize: state.vocabularySize,
      totalGuesses: state.totalGuesses,
      yourProgress: objectValue(
        progress && isString(playerId)
          ? z.record(z.string(), z.unknown()).catch({}).parse(progress)[playerId]
          : undefined,
      ),
      rivalProgress: progress
        ? Object.values(progress).filter((entry) => objectValue(entry)?.playerId !== playerId)
        : [],
      secret: state.status === "ended" ? state.secret : undefined,
      winner: state.winner,
    });
  }

  if (gameType === "codenames") {
    const cards = arrayValue(state.board).flatMap((entry) => {
      const card = objectValue(entry);

      if (!card) return [];

      return [[card.index, card.word, card.revealed, card.affiliation ?? null]];
    });

    const clue = objectValue(state.clue);

    return defined({
      ...common,
      yourTeam: you?.team,
      yourRole: you?.role,
      activeTeam: state.activeTeam,
      cardFormat: ["index", "word", "revealed", "affiliation_or_null"],
      cards,
      clue: clue ? defined({ word: clue.word, count: clue.count }) : null,
      guessesRemaining: state.guessesRemaining,
      guessesMade: state.guessesMade,
      remaining: state.remaining,
      lastReveal: state.lastReveal,
      winnerTeam: state.winnerTeam ?? state.winner,
    });
  }

  if (gameType === "battleship") return { ...common, ...battleshipAgentState(state) };

  if (gameType === "poker") {
    return defined({
      ...common,
      handNumber: state.handNumber,
      community: state.community,
      pot: state.pot,
      currentBet: state.currentBet,
      minRaise: state.minRaise,
      toCall: state.toCall,
      canCheck: state.canCheck,
      seats: compactPokerSeats(projectedEntries(state.seats), playerId),
      buttonPlayerId: state.buttonPlayerId,
      smallBlindPlayerId: state.smallBlindPlayerId,
      bigBlindPlayerId: state.bigBlindPlayerId,
      blinds: state.blinds,
      actionHistory: compactPokerActions(
        projectedEntries(state.actionLog),
        numberValue(state.handNumber),
      ),
      lastHandResult: state.lastHandResult,
      winner: state.winner,
    });
  }

  return common;
}).parse;
