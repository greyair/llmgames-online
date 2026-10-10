import type { WireObject } from "./value-contracts.js";

export * from "./value-contracts.js";

export * from "./series.js";

export { battleshipAgentState } from "./battleship-state.js";

import { BATTLESHIP_FLEET_FORMAT } from "./fleet.js";

export { BATTLESHIP_FLEET, BATTLESHIP_FALLBACK_FLEET, BATTLESHIP_FLEET_FORMAT } from "./fleet.js";
/**
 * Progressive-disclosure catalog of game intents.
 *
 * Hosts only see core MCP tools + list_game_tools / get_tool_schema / send_action.
 * Full per-action schemas live here so they are not dumped into tools/list context.
 */

export { compactAgentDecisionState } from "./agent-state.js";

export type GameTypeId =
  | "connect4"
  | "pokemon"
  | "checkers"
  | "reversi"
  | "codenames"
  | "battleship"
  | "poker"
  | "contexto";

/** Absolute lifetime of a game room, measured from room creation. */
export const ROOM_LIFETIME_MINUTES = 45;

export const ROOM_LIFETIME_MS = ROOM_LIFETIME_MINUTES * 60 * 1000;

/** Delete a live room after this long without a new member, start, or accepted action. */
export const ROOM_INACTIVITY_MINUTES = 5;

export const ROOM_INACTIVITY_MS = ROOM_INACTIVITY_MINUTES * 60 * 1000;

/** Configurable decision timers for every game phase except fleet placement. */
export const TURN_TIME_MIN_MS = 30 * 1000;

export const TURN_TIME_MAX_MS = 150 * 1000;

export const TURN_TIME_OPTIONS_SECONDS = [30, 60, 90, 120, 150] as const;

export type DataFieldSpec = {
  type: string;
  description: string;
  required?: boolean;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
};

export type GameActionSpec = {
  /** Value for send_action({ actionType }) — server DO intent name */
  actionType: string;
  title: string;
  description: string;
  /** Games this action applies to */
  games: readonly GameTypeId[];
  /** Fields inside send_action data (not controllerId/roomId) */
  data: Record<string, DataFieldSpec>;
  /** Alternate actionType strings accepted by the DO */
  aliases?: readonly string[];
};

export type GameInstructionSpec = {
  briefing?: string;
  timers: {
    /** Which countdown applies during the game's decision phases. */
    turnTimer: string;
    /** Server action taken when that countdown reaches zero. */
    onTimeout: string;
  };
};

/** Per-game rules returned alongside each progressive action catalog. */
export const GAME_INSTRUCTIONS: Readonly<Record<GameTypeId, GameInstructionSpec>> = {
  connect4: {
    briefing:
      "Connect four of your discs horizontally, vertically or diagonally to win. The board has 6 rows and 7 columns, indexed from zero at the top-left. Discs fall to the lowest empty cell in the chosen column. Use yourSeat to identify your discs and choose from legalColumns. A full board without a winner is a draw.",
    timers: {
      turnTimer: "The room's configured turn timer applies to each disc turn.",
      onTimeout:
        "No disc is placed; the timed-out player forfeits the turn and play passes to the opponent.",
    },
  },
  pokemon: {
    briefing:
      "Gen 1 Random Battle: 6 vs 6 singles, original 151 species and Gen 1 moves; generated levels/sets, no items, abilities or team preview. KO all six to win. RBY mechanics apply: type-based damage categories, one Special stat, Speed-based critical hits and Gen 1 status/type interactions. Sleep, Freeze, Species, OHKO and Evasion clauses apply. Use current decision slots only; submit once, then wait. Recharge/Fight are explicit move choices. condition is HP/maxHP plus status; foe HP is percentage. effects are public effect names without hidden counters; stats are unboosted. Trust the supplied Gen 1 move data over later-generation assumptions.",
    timers: {
      turnTimer:
        "Both players choose privately each turn. Forced switches have a fresh decision timer.",
      onTimeout:
        "The server selects the first enabled move for each pending player, or the first available switch when a replacement is required. Match time expiry is a draw.",
    },
  },
  checkers: {
    briefing:
      "American checkers on an 8x8 board. Seat 1 (black) moves first, toward row 0; seat 2 (white) moves toward row 7. Men move and capture forward; kings move and capture in both directions, one square or one jump at a time. Captures are mandatory. Choose any available capture, then finish all jumps with the same piece. Crowning ends the turn. No pieces or no legal move loses. Threefold repetition or 80 turns without a capture or man move draws.",
    timers: {
      turnTimer: "One timer for the whole turn, including chained jumps.",
      onTimeout: "Turn timeout forfeits the match. Match time expiry is a draw.",
    },
  },
  reversi: {
    briefing:
      "Reversi on an 8x8 board. Coordinates are zero-based from the top-left; rows increase downward and columns rightward. Seat 1 is black, seat 2 white. Choose a coordinate from legalMoves; all horizontal, vertical and diagonal lines of opponent discs bracketed by your discs flip. A player with no legal move is passed automatically. When neither player can move, the higher disc count wins; equal counts draw.",
    timers: {
      turnTimer:
        "The room's configured turn timer applies whenever a player has a legal placement.",
      onTimeout:
        "No disc is placed. The server passes according to legal-move rules: the opponent moves if able, the same player retains play if only they can move, and the game ends if neither can move.",
    },
  },
  codenames: {
    briefing:
      "Find all your team's agents on the 25-card board before the other team. yourTeam and yourRole determine your job. Spymasters see the full key and give one-word clues with a count; operatives see unrevealed affiliations as null and guess from the clue. cards use the supplied cardFormat and zero-based indexes 0-24. Correct guesses may continue up to the clue count plus one; 0 or unlimited means no cap and guessesRemaining is null. Make at least one guess before end_turn. Revealing a neutral or opposing card ends your turn; revealing the assassin loses immediately.",
    timers: {
      turnTimer:
        "Codenames turn timers start at 30 seconds. The configured timer applies first to the active spymaster's clue, then once to the active team's entire operative guessing phase. Correct guesses do not restart it.",
      onTimeout:
        "The active team's turn ends without revealing a card. Play passes to the opposing spymaster.",
    },
  },
  battleship: {
    briefing:
      "Sink all five enemy polyomino ships, 22 cells. Fleet shape offsets rotate clockwise around the placement anchor; ships may touch but cannot overlap. Coordinates are zero-based. ownGrid: . empty water, s ship, m your armed mine, x hit ship, o attacked water. targetGrid: . unknown, x hit, o miss. Enemy unhit cells and armed mines are hidden. Ship IDs identify shapes, not visible enemy locations. Cannon is free: a hit keeps your turn and refreshes its timer; a miss ends it. Gain 2 energy at turn start and 1 per new hit your fleet receives. Specials do not refresh the timer. Radar counts all ship cells, including previous hits, in a centered 3x3 clipped to the board. Torpedoes stop at the first ship cell, including previous hits. A bomb-triggered mine ends the bombing player's turn after three random return shots.",
    timers: {
      turnTimer:
        "Fleet placement uses a fixed 5-minute concurrent countdown; battle then uses the room's configured turn timer.",
      onTimeout:
        "Missing fleets are server-deployed when placement expires. During battle, a timed-out captain forfeits the turn without firing.",
    },
  },
  poker: {
    briefing:
      "No-limit Texas Hold'em with 2-6 seats, 1000 starting chips and blinds 5/10. Use the best five cards from your two hole cards and the community cards. Opponent hole cards stay hidden until eligible showdown. isYou identifies your seat. toCall is chips owed now; currentBet is the largest street total; minRaise is the minimum increase above currentBet. bet.amount adds chips when toCall is zero, including the big-blind option; raise.amount adds chips now or raise.raiseTo sets your total for this street. Use exactly one raise field. Non-all-in street totals must be multiples of 10; calls and exact all-ins are exceptions. Short all-in raises may not reopen betting; trust legalActions. Unequal contributions form side pots. Heads-up, the button is small blind and acts first preflop. A five-second result display precedes next_hand; wait_for_turn waits until it is available.",
    timers: {
      turnTimer: "The room's configured turn timer applies to each betting decision.",
      onTimeout: "The server checks when nothing is owed; otherwise it folds the timed-out hand.",
    },
  },
  contexto: {
    briefing:
      "Contexto is a simultaneous word game. Submit one English dictionary word of 2-18 letters at a time, up to 50 accepted distinct word families. Lower semantic ranks are closer to the hidden secret; rank 1 wins. Case and supported word aliases are normalized; repeated families and unknown words do not consume a guess. Your words stay private from opponents. Read action errors for invalid or repeated guesses; yourProgress.lastAttempt records ranked, aliased or out-of-pool attempts. If everyone exhausts their guesses, the lowest best rank wins and equal best ranks draw.",
    timers: {
      turnTimer: "All seated players may guess concurrently until the match clock expires.",
      onTimeout: "The player with the lowest best rank wins; an equal best rank is a draw.",
    },
  },
};

const emptyData: Record<string, DataFieldSpec> = {};

export const GAME_ACTIONS: readonly GameActionSpec[] = [
  {
    actionType: "move_checker",
    title: "Move checker",
    description:
      "Choose one server-listed legal move. Captures are forced; after a jump, keep using the same piece while legalMoves contains continuations. Crowning ends the turn.",
    games: ["checkers"],
    data: {
      fromRow: {
        type: "integer",
        description: "Source row from legalMoves",
        required: true,
        minimum: 0,
        maximum: 7,
      },
      fromCol: {
        type: "integer",
        description: "Source column from legalMoves",
        required: true,
        minimum: 0,
        maximum: 7,
      },
      row: {
        type: "integer",
        description: "Destination row from legalMoves",
        required: true,
        minimum: 0,
        maximum: 7,
      },
      col: {
        type: "integer",
        description: "Destination column from legalMoves",
        required: true,
        minimum: 0,
        maximum: 7,
      },
    },
  },
  {
    actionType: "pokemon_move",
    title: "Choose a move",
    description:
      "Seal one legal Gen 1 move. Both choices resolve together; no changes after submission.",
    games: ["pokemon"],
    data: {
      slot: {
        type: "integer",
        description: "One-based slot from decision.moves, excluding disabled moves",
        required: true,
        minimum: 1,
        maximum: 4,
      },
    },
  },
  {
    actionType: "pokemon_switch",
    title: "Switch Pokémon",
    description: "Switch to a legal teammate, or replace a fainted Pokémon.",
    games: ["pokemon"],
    data: {
      slot: {
        type: "integer",
        description: "One-based slot from decision.switches",
        required: true,
        minimum: 1,
        maximum: 6,
      },
    },
  },
  // Shared lobby management (host only)
  {
    actionType: "add_jev",
    title: "Add Jev",
    description:
      "Host only, private lobby: add one hosted Jev player to an open seat when the server offers add_jev in legalActions. At most one Jev per room.",
    games: ["connect4", "pokemon", "reversi", "checkers", "battleship", "poker", "contexto"],
    data: emptyData,
  },
  {
    actionType: "remove_jev",
    title: "Remove Jev",
    description: "Host only, private lobby: remove the hosted Jev player before the game starts.",
    games: ["connect4", "pokemon", "reversi", "checkers", "battleship", "poker", "contexto"],
    data: emptyData,
  },
  {
    actionType: "move_player_to_spectator",
    title: "Move player to spectators",
    description:
      "Host only, before the game starts: move any human or MCP agent seat, including the host's own seat, to the watch-only spectator list without disconnecting it.",
    games: [
      "connect4",
      "pokemon",
      "reversi",
      "checkers",
      "codenames",
      "battleship",
      "poker",
      "contexto",
    ],
    data: {
      playerId: {
        type: "string",
        description: "Player/agent seat id to move, including the host's own seat",
        required: true,
      },
    },
  },
  {
    actionType: "set_host_spectating",
    title: "Set host participation",
    description:
      "Host only, before the game starts: switch between occupying a player seat and organizing from the spectator list. A spectator-host keeps lobby and table controls but receives no game-turn actions.",
    games: [
      "connect4",
      "pokemon",
      "reversi",
      "checkers",
      "codenames",
      "battleship",
      "poker",
      "contexto",
    ],
    data: {
      spectating: {
        type: "boolean",
        description: "true to host without playing; false to take an available player seat",
        required: true,
      },
    },
  },
  {
    actionType: "set_player_seats",
    title: "Set player seats",
    description:
      "Host only, before the game starts: atomically make the listed room-member IDs players and move every other member to spectators. A playing host is retained implicitly; a spectator-host stays watch-only unless listed. Use roomMembers from get_state to resolve usernames, agent names, and environments to stable playerIds.",
    games: [
      "connect4",
      "pokemon",
      "reversi",
      "checkers",
      "codenames",
      "battleship",
      "poker",
      "contexto",
    ],
    data: {
      playerIds: {
        type: "array",
        description:
          "Exact room-member IDs that should occupy player seats. Spectators in this list are promoted and unlisted players are moved to spectators. A playing host is implicit; list a spectator-host only when they should rejoin as a player.",
        required: true,
      },
    },
  },
  {
    actionType: "end_game",
    title: "End game",
    description:
      "Host only: end the room for every player. The server delivers each connection's projected final state before it archives and purges the Durable Object, with a 30-second fallback for unavailable clients.",
    games: [
      "connect4",
      "pokemon",
      "reversi",
      "checkers",
      "codenames",
      "battleship",
      "poker",
      "contexto",
    ],
    data: emptyData,
  },

  // ── Connect 4 ───────────────────────────────────────────────
  {
    actionType: "drop_disc",
    title: "Drop disc",
    description: "Drop a disc into column 0–6.",
    games: ["connect4"],
    aliases: ["drop"],
    data: {
      col: {
        type: "integer",
        description: "Column index 0–6",
        required: true,
        minimum: 0,
        maximum: 6,
      },
    },
  },

  // ── Contexto ────────────────────────────────────────────
  {
    actionType: "guess_word",
    title: "Guess a word",
    description:
      "Submit one dictionary word. The server returns its ordinal semantic rank for the hidden secret. Rank 1 wins; each player may submit at most 50 unique accepted guesses.",
    games: ["contexto"],
    aliases: ["guess"],
    data: {
      word: {
        type: "string",
        description: "One English dictionary word containing letters only",
        required: true,
      },
    },
  },

  // ── Reversi ───────────────────────────────────────────────
  {
    actionType: "place_disc",
    title: "Place disc",
    description:
      "Place a disc at a server-listed legal move on the 8×8 board. The move must bracket one or more opponent discs; all bracketed lines flip automatically.",
    games: ["reversi"],
    aliases: ["place", "move"],
    data: {
      row: {
        type: "integer",
        description: "Row index 0–7; choose from state.legalMoves",
        required: true,
        minimum: 0,
        maximum: 7,
      },
      col: {
        type: "integer",
        description: "Column index 0–7; choose from state.legalMoves",
        required: true,
        minimum: 0,
        maximum: 7,
      },
    },
  },

  // ── Codenames ─────────────────────────────────────────────────
  {
    actionType: "assign_codenames_role",
    title: "Join or arrange a Codenames role",
    description:
      "Before starting, every member may choose their own red or blue spymaster/operative role; a spectator choosing a role claims an open player seat. The host may arrange any room member, including moving a spectator into an open seat. A non-host cannot displace an occupied spymaster.",
    games: ["codenames"],
    data: {
      playerId: {
        type: "string",
        description: "Your own room-member id, or any room-member id when acting as host",
        required: true,
      },
      team: {
        type: "string",
        description: "red or blue; use null together with role null to unassign",
        required: false,
      },
      role: {
        type: "string",
        description: "spymaster or operative; use null together with team null to unassign",
        required: false,
      },
    },
  },
  {
    actionType: "reset_codenames_roles",
    title: "Reset Codenames teams",
    description:
      "Lobby host: restore the default team and role assignments for all seated players.",
    games: ["codenames"],
    data: emptyData,
  },
  {
    actionType: "randomize_codenames_roles",
    title: "Randomize Codenames teams",
    description:
      "Lobby host with at least four active players: securely shuffle balanced teams with exactly one spymaster and at least one operative per team.",
    games: ["codenames"],
    data: emptyData,
  },
  {
    actionType: "give_clue",
    title: "Give clue",
    description:
      "Active spymaster: give one word plus 0–9 or the official expert value unlimited. A positive number allows that many linked guesses plus one extra; 0 and unlimited allow uncapped correct guesses.",
    games: ["codenames"],
    data: {
      word: {
        type: "string",
        description: "One-word clue; it cannot exactly match an unrevealed codename",
        required: true,
      },
      count: {
        type: "integer|string",
        description: "Integer 0–9 or the string unlimited",
        required: true,
      },
    },
  },
  {
    actionType: "guess_word",
    title: "Guess codename",
    description:
      "Active-team operative: reveal one unrevealed codename by its 0–24 board index or exact word. A bystander or opposing agent ends the turn; the assassin loses immediately.",
    games: ["codenames"],
    aliases: ["guess"],
    data: {
      index: {
        type: "integer",
        description: "Board index 0–24 (preferred; word may be used instead)",
        required: false,
        minimum: 0,
        maximum: 24,
      },
      word: {
        type: "string",
        description: "Exact visible codename (optional alternative to index)",
        required: false,
      },
    },
  },
  {
    actionType: "end_turn",
    title: "Stop guessing",
    description:
      "Active-team operative: stop after the team has made at least one guess, passing play to the opposing spymaster.",
    games: ["codenames"],
    aliases: ["stop_guessing"],
    data: emptyData,
  },

  {
    actionType: "next_hand",
    title: "Next hand",
    description:
      "Start the next Poker hand after the five-second result display. wait_for_turn waits until this action is available.",
    games: ["poker"],
    data: emptyData,
  },
  // ── Poker ──────────────────────────────────────────────────────
  {
    actionType: "fold",
    title: "Fold",
    description: "Fold your hand.",
    games: ["poker"],
    data: emptyData,
  },
  {
    actionType: "check",
    title: "Check",
    description: "Check when toCall is 0.",
    games: ["poker"],
    data: emptyData,
  },
  {
    actionType: "call",
    title: "Call",
    description: "Call the current bet.",
    games: ["poker"],
    data: emptyData,
  },
  {
    actionType: "bet",
    title: "Bet",
    description:
      "When toCall is zero, add amount chips, including the preflop big-blind option after callers. Minimum added amount is the big blind. Your resulting street total must be a multiple of 10, except exact all-in.",
    games: ["poker"],
    data: {
      amount: {
        type: "number",
        description: "Chips to put in (min = big blind)",
        required: true,
        minimum: 1,
      },
    },
  },
  {
    actionType: "raise",
    title: "Raise",
    description:
      "Raise. amount = chips to add now (must cover call + min raise), or raiseTo as absolute street total. The street total must be a multiple of the big blind (10), except exact all-in.",
    games: ["poker"],
    data: {
      amount: {
        type: "number",
        description: "Chips to add now (optional if raiseTo set)",
        required: false,
        minimum: 1,
      },
      raiseTo: {
        type: "number",
        description: "Absolute street total to raise to (optional if amount set)",
        required: false,
        minimum: 1,
      },
    },
  },
  {
    actionType: "all_in",
    title: "All-in",
    description: "Put all remaining chips in the pot.",
    games: ["poker"],
    data: emptyData,
  },

  // ── Battleship ─────────────────────────────────────────────────
  {
    actionType: "place_fleet",
    title: "Place fleet",
    description:
      "Place all 5 polyomino ships on your 10×10 board. Each ship: { id, row, col, rotation: 0|90|180|270 }; vary rotations so the fleet is less predictable. " +
      "(legacy orientation h|v maps to 0|90). Shapes: carrier6 (forked deck), dreadnought5 (armored bend), " +
      "cruiser4 (hooked bow), submarine4 (diving zigzag), destroyer3 (angled hull). Total 22 cells; no overlap; all on board. " +
      "Placement is concurrent for 5 minutes; the server auto-deploys any missing fleet at expiry, then the configured battle turn timer begins. " +
      BATTLESHIP_FLEET_FORMAT,
    games: ["battleship"],
    data: {
      ships: {
        type: "array",
        description:
          "Array of { id: carrier|dreadnought|cruiser|submarine|destroyer, row: 0-9, col: 0-9, rotation?: 0|90|180|270, orientation?: h|v }",
        required: true,
      },
    },
  },
  {
    actionType: "cannon",
    title: "Cannon",
    description:
      "Free single-cell shot at (row,col) 0–9. Gain 2 energy at turn start and 1 energy for every new hit your own fleet takes, including ability hits. Hit → fire again; miss → turn ends.",
    games: ["battleship"],
    aliases: ["fire", "shoot"],
    data: {
      row: {
        type: "integer",
        description: "Row 0–9",
        required: true,
        minimum: 0,
        maximum: 9,
      },
      col: {
        type: "integer",
        description: "Col 0–9",
        required: true,
        minimum: 0,
        maximum: 9,
      },
    },
  },
  {
    actionType: "mine",
    title: "Mines",
    description:
      "Place a hidden mine on empty, unattacked water on your own board. Costs 2 pts. Reusable while you have enough energy; keeps your normal shot available. When shot, fires three random return shots at the opponent.",
    games: ["battleship"],
    data: {
      row: {
        type: "integer",
        description: "Own board row 0–9",
        required: true,
        minimum: 0,
        maximum: 9,
      },
      col: {
        type: "integer",
        description: "Own board column 0–9",
        required: true,
        minimum: 0,
        maximum: 9,
      },
    },
  },
  {
    actionType: "bomb",
    title: "Bomb",
    description:
      "Attack a 2×2 zone with (row,col) as top-left (0–8). Costs 5 munition points. Reusable while you have enough energy; keeps your normal shot available unless it triggers a mine, which fires three return shots and ends your turn.",
    games: ["battleship"],
    data: {
      row: {
        type: "integer",
        description: "Top-left row 0–8",
        required: true,
        minimum: 0,
        maximum: 8,
      },
      col: {
        type: "integer",
        description: "Top-left col 0–8",
        required: true,
        minimum: 0,
        maximum: 8,
      },
    },
  },
  {
    actionType: "radar",
    title: "Radar",
    description:
      "Scan 3×3 centered on (row,col). Info only — no hits/pegs; announcement reports ship-cell count. Costs 3 pts. Reusable while you have enough energy; keeps your normal shot available.",
    games: ["battleship"],
    data: {
      row: {
        type: "integer",
        description: "Center row 0–9",
        required: true,
        minimum: 0,
        maximum: 9,
      },
      col: {
        type: "integer",
        description: "Center col 0–9",
        required: true,
        minimum: 0,
        maximum: 9,
      },
    },
  },
  {
    actionType: "torpedo",
    title: "Torpedo",
    description:
      "Launch from a board edge only. Travels row/col inward until first ship hit, then stops. " +
      "Direction inferred from edge; corners need n|s|e|w. Costs 7 pts. Reusable while you have enough energy; keeps your normal shot available.",
    games: ["battleship"],
    data: {
      row: {
        type: "integer",
        description: "Edge row 0–9",
        required: true,
        minimum: 0,
        maximum: 9,
      },
      col: {
        type: "integer",
        description: "Edge col 0–9",
        required: true,
        minimum: 0,
        maximum: 9,
      },
      direction: {
        type: "string",
        description:
          "Required only on corners: n|s|e|w (or north|south|east|west). Edge mid-sides infer direction.",
        required: false,
        enum: ["n", "s", "e", "w", "north", "south", "east", "west"],
      },
    },
  },
];

export const KNOWN_GAME_TYPES: readonly GameTypeId[] = [
  "connect4",
  "pokemon",
  "reversi",
  "checkers",
  "codenames",
  "battleship",
  "poker",
  "contexto",
] as const;

export const GAME_AVAILABILITY: Readonly<Record<GameTypeId, boolean>> = {
  connect4: true,
  pokemon: true,
  reversi: true,
  checkers: true,
  codenames: true,
  battleship: true,
  poker: true,
  contexto: true,
};

export const ENABLED_GAME_TYPES: readonly GameTypeId[] = KNOWN_GAME_TYPES.filter(
  (gameType) => GAME_AVAILABILITY[gameType],
);

/** Normalize supported game names and shorthand. */
export function normalizeGameType(raw: string): GameTypeId | string {
  const g = raw.trim().toLowerCase().replace(/\s+/g, "-");

  switch (g) {
    case "connect-4":
      return "connect4";
    case "draughts":
      return "checkers";
    case "othello":
      return "reversi";
    case "heads-up-poker":
    case "holdem":
    case "texas-holdem":
      return "poker";
    case "contexto":
      return "contexto";
    default:
      return g;
  }
}

/** Canonical public URL slug. */
export function gameRouteSlug(gameType: string): string {
  return normalizeGameType(gameType);
}

function isGameTypeId(gameType: string): gameType is GameTypeId {
  return Object.hasOwn(GAME_AVAILABILITY, gameType);
}

export function isGameEnabled(gameType: string): boolean {
  const normalized = normalizeGameType(gameType);

  return isGameTypeId(normalized) && GAME_AVAILABILITY[normalized] === true;
}

export function actionsForGame(gameType: string): GameActionSpec[] {
  const gt = normalizeGameType(gameType);

  if (!isGameTypeId(gt) || !isGameEnabled(gt)) return [];

  return GAME_ACTIONS.filter((a) => a.games.includes(gt));
}

export function instructionsForGame(gameType: string): GameInstructionSpec | undefined {
  const normalized = normalizeGameType(gameType);

  if (!isGameTypeId(normalized) || !isGameEnabled(normalized)) return undefined;

  return GAME_INSTRUCTIONS[normalized];
}

export function findAction(actionType: string, gameType?: string): GameActionSpec | undefined {
  const name = actionType.toLowerCase().replace(/\s+/g, "_");

  const pool = gameType
    ? actionsForGame(gameType)
    : GAME_ACTIONS.filter((action) => action.games.some(isGameEnabled));

  return pool.find(
    (a) => a.actionType === name || a.aliases?.some((al) => al.toLowerCase() === name),
  );
}

/** Compact catalog for list_game_tools (no full field schemas). */
export interface CatalogOptions {
  transport?: "remote" | "local";
}

export function listGameToolsCatalog(gameType?: string, options: CatalogOptions = {}) {
  if (gameType && !isGameEnabled(gameType)) {
    throw new Error(`Game type "${gameType}" is currently unavailable.`);
  }

  const games = gameType ? [normalizeGameType(gameType)] : [...ENABLED_GAME_TYPES];

  const byGame: Record<
    string,
    Array<{
      actionType: string;
      title: string;
      description: string;
      aliases?: readonly string[];
      dataKeys: string[];
    }>
  > = {};

  const gameInstructions: Record<string, GameInstructionSpec> = {};

  for (const g of games) {
    byGame[g] = actionsForGame(g).map((a) => ({
      actionType: a.actionType,
      title: a.title,
      description: a.description,
      aliases: a.aliases,
      dataKeys: Object.keys(a.data),
    }));
    const instructions = instructionsForGame(g);

    if (instructions) gameInstructions[g] = instructions;
  }

  return {
    howToUse: {
      list:
        options.transport === "local"
          ? "room_create/join, then room_connect, then list_game_tools({ gameType })"
          : "list_game_tools({ gameType }) after room_create/join",
      schema: "get_tool_schema({ actionType, gameType? }) for full data fields",
      act:
        options.transport === "local"
          ? "send_action({ actionType, data }) — prefer state.legalActions from wait_for_turn"
          : "send_action({ controllerId, roomId, actionType, data }) — prefer state.legalActions from wait_for_turn",
    },
    turnTimerConfig: {
      minimumMs: TURN_TIME_MIN_MS,
      maximumMs: TURN_TIME_MAX_MS,
      optionsSeconds: TURN_TIME_OPTIONS_SECONDS,
      exception:
        "Battleship fleet placement stays fixed at 5 minutes; its battle turns use this range. Contexto uses one concurrent match clock rather than per-turn timers.",
    },
    gameInstructions,
    games: byGame,
    coreTools:
      options.transport === "local"
        ? [
            "auth_set_token",
            "auth_status",
            "auth_whoami",
            "auth_clear",
            "set_api_url",
            "room_create",
            "room_join",
            "room_connect",
            "room_leave",
            "get_state",
            "wait_for_turn",
            "start_game",
            "list_game_tools",
            "get_tool_schema",
            "send_action",
          ]
        : [
            "agent_claim",
            "agent_list",
            "auth_status",
            "room_create",
            "room_join",
            "get_state",
            "wait_for_turn",
            "start_game",
            "list_game_tools",
            "get_tool_schema",
            "send_action",
          ],
  };
}

interface ActionInvocationSchema {
  actionType: string;
  data: Record<string, DataFieldSpec>;
  dataRequired: string[];
  controllerId?: string;
  roomId?: string;
  gameType?: string;
}

/** Full schema for one action (get_tool_schema). */
export function getGameToolSchema(
  actionType: string,
  gameType?: string,
  options: CatalogOptions = {},
) {
  if (gameType && !isGameEnabled(gameType)) {
    return { error: `Game type "${gameType}" is currently unavailable.` };
  }

  if (!gameType) {
    const name = actionType.toLowerCase().replace(/\s+/g, "_");

    const matches = GAME_ACTIONS.filter(
      (action) =>
        action.games.some(isGameEnabled) &&
        (action.actionType === name ||
          action.aliases?.some((alias) => alias.toLowerCase() === name)),
    );

    if (matches.length > 1) {
      const games = [...new Set(matches.flatMap((action) => action.games.filter(isGameEnabled)))];

      return {
        error: `Action "${actionType}" has different schemas across games. Pass gameType: ${games.join(" or ")}.`,
      };
    }
  }

  const action = findAction(actionType, gameType);

  if (!action) {
    const hint = gameType
      ? `Unknown actionType "${actionType}" for game ${gameType}. Call list_game_tools first.`
      : `Unknown actionType "${actionType}". Call list_game_tools({ gameType }) first.`;

    return {
      error: hint,
      knownActionTypes: GAME_ACTIONS.flatMap((action) =>
        action.games.some(isGameEnabled) ? [action.actionType] : [],
      ),
    };
  }

  const required = Object.entries(action.data)
    .filter(([, f]) => f.required)
    .map(([k]) => k);

  const invocation: ActionInvocationSchema = {
    actionType: action.actionType,
    data: action.data,
    dataRequired: required,
  };

  if (options.transport !== "local") {
    invocation.controllerId = "uuid from agent_claim (required)";
    invocation.roomId = "string (required)";
    invocation.gameType = "optional if inferable from roomId";
  }

  return {
    actionType: action.actionType,
    title: action.title,
    description: action.description,
    games: action.games.filter(isGameEnabled),
    aliases: action.aliases ?? [],
    gameInstructions: Object.fromEntries(
      (gameType ? [normalizeGameType(gameType)] : action.games.filter(isGameEnabled))
        .map((game) => [game, instructionsForGame(game)])
        .filter((entry) => entry[1] !== undefined),
    ),
    send_action: invocation,
    example:
      options.transport === "local"
        ? { actionType: action.actionType, data: buildExample(action).data }
        : buildExample(action),
  };
}

type GameActionExampleData = WireObject;

interface GameToolExample {
  controllerId: string;
  roomId: string;
  actionType: string;
  data: GameActionExampleData;
}

function buildExample(action: GameActionSpec): GameToolExample {
  const examples = {
    give_clue: { word: "ocean", count: 1 },
    guess_word: action.games.includes("codenames") ? { index: 0 } : { word: "ocean" },
    bet: { amount: 10 },
    raise: { raiseTo: 20 },
    place_disc: { row: 2, col: 3 },
  };

  const exampleData = new Map<string, GameActionExampleData>(Object.entries(examples)).get(
    action.actionType,
  );

  if (exampleData)
    return {
      controllerId: "<task-controllerId>",
      roomId: "<roomId>",
      actionType: action.actionType,
      data: exampleData,
    };

  if (action.actionType === "move_checker")
    return {
      controllerId: "<task-controllerId>",
      roomId: "<roomId>",
      actionType: "move_checker",
      data: { fromRow: 5, fromCol: 0, row: 4, col: 1 },
    };

  if (action.actionType === "place_fleet") {
    return {
      controllerId: "<task-controllerId>",
      roomId: "<roomId>",
      actionType: action.actionType,
      data: {
        ships: [
          { id: "carrier", row: 2, col: 2, rotation: 90 },
          { id: "dreadnought", row: 0, col: 5, rotation: 0 },
          { id: "cruiser", row: 5, col: 9, rotation: 180 },
          { id: "submarine", row: 9, col: 4, rotation: 270 },
          { id: "destroyer", row: 6, col: 3, rotation: 90 },
        ],
      },
    };
  }

  if (action.actionType === "torpedo")
    return {
      controllerId: "<task-controllerId>",
      roomId: "<roomId>",
      actionType: "torpedo",
      data: { row: 0, col: 0, direction: "s" },
    };
  const data: GameActionExampleData = {};

  for (const [key, field] of Object.entries(action.data)) {
    if (!field.required && Object.keys(action.data).length > 1) continue;
    const firstEnumValue = field.enum?.[0];

    if (firstEnumValue !== undefined) {
      data[key] = firstEnumValue;
    } else if (field.type === "integer" || field.type === "number") {
      data[key] = field.minimum ?? 0;
    } else if (field.type === "array") {
      data[key] = [];
    } else {
      data[key] = `<${key}>`;
    }
  }

  return {
    controllerId: "<task-controllerId>",
    roomId: "<roomId>",
    actionType: action.actionType,
    data,
  };
}
