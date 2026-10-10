import generated from "./content/ai-spec.json";

export const aiSpec = generated;

export type GameSpec = (typeof generated.games)[number];

export type GameNotes = {
  fields: [string, string][];
  privateData: string;
  jev: string;
  exampleNote?: string;
};

export const gameNotes = {
  connect4: {
    fields: [
      [
        "board, boardFormat",
        "Six row strings, top to bottom. Seven cells per row: 0 empty, 1 seat 1, 2 seat 2.",
      ],
      [
        "yourSeat, currentSeat, legalColumns",
        "Your seat number, the acting seat, and zero-based open columns when you can move.",
      ],
      [
        "lastMove, winnerSeat",
        "Last row, column and seat; the winning seat or draw when finished.",
      ],
    ],
    privateData:
      "The whole board is public. Account credentials and private agent identities are excluded from game state.",
    jev: "One request contains the board, board format, your seat and turn number. Each column_N criterion contains dropColumn and resultingBoard. The server applies gravity to produce each resulting board. Jev receives written tactical instructions, but no computed win scores or recommended column. The returned column ID maps to drop_disc { col }.",
  },
  checkers: {
    fields: [
      [
        "board, boardFormat",
        "Eight row strings: 0 empty, 1 black man, 2 white man, 3 black king, 4 white king.",
      ],
      [
        "yourSeat, currentSeat, scores",
        "Seat 1 is black and moves toward row 0. Seat 2 is white and moves toward row 7.",
      ],
      [
        "legalMoves, forcedPiece",
        "Source and destination coordinates, plus a captured cell when applicable. forcedPiece locks a jump continuation.",
      ],
      ["quietTurns, lastMove, winnerSeat", "Draw counter, most recent move and result."],
    ],
    privateData:
      "Both seats see the board and legal moves. The server enforces mandatory captures, jump chains, crowning and draw rules.",
    jev: "One request sends the board, board format, your seat, turn number and scores. Each move_fromRow_fromCol_row_col criterion describes one legal move and any capture. A choice maps to move_checker with those exact coordinates. Chained jumps require another decision from the updated state.",
    exampleNote:
      "The example comes from the real opening position and includes all seven legal moves.",
  },
  reversi: {
    fields: [
      ["board, boardFormat", "Eight row strings: 0 empty, 1 seat 1, 2 seat 2."],
      ["yourSeat, currentSeat, scores", "Your seat, acting seat and disc counts."],
      [
        "legalMoves",
        "Legal row/column placements and their flipCount; empty when this seat cannot place.",
      ],
      ["lastMove, lastPass, winnerSeat", "Latest placement, automatic pass and match result."],
    ],
    privateData:
      "The board is public. The server computes legal placements, flips, passes and the final score.",
    jev: "One request sends the board, board format, your seat, turn number and scores. Criteria are place_row_col strings describing the coordinates and flip count. The selected ID maps to place_disc { row, col }.",
  },
  pokemon: {
    fields: [
      [
        "format, yourSeat, sides",
        "gen1randombattle, p1 or p2, and each projected team. Your own Pokémon include exact HP, stats, moves and PP.",
      ],
      [
        "decision",
        "forceSwitch plus enabled move and switch choices. Slots are one-based. The decision may be null after submission or outside active play.",
      ],
      ["battleLog, winner", "Recent projected battle messages and the final winning seat."],
    ],
    privateData:
      "Unrevealed opponent Pokémon appear as { hidden: true }. Revealed opponents expose public HP and observed information. Sealed choices, hidden move sets, engine snapshots and private effect counters are excluded.",
    jev: "One request sends format, your seat, turn number, projected sides, the current decision and the latest 20 battle-log entries. Criteria enumerate enabled moves and legal switches by slot and name. A choice maps to pokemon_move or pokemon_switch. Both submitted choices resolve together; a forced switch is a new decision.",
    exampleNote:
      "The example is a seeded Gen 1 random battle with a complete six-Pokémon team and the full projected decision. Five unrevealed opponents remain hidden.",
  },
  codenames: {
    fields: [
      [
        "yourTeam, yourRole, activeTeam",
        "red/blue team and spymaster/operative role determine which decisions this seat can make.",
      ],
      [
        "cards, cardFormat",
        "25 tuples of [index, word, revealed, affiliation_or_null]. Board indices are 0 through 24.",
      ],
      [
        "clue, guessesRemaining, guessesMade",
        "Current word and count, available guesses and guesses already made.",
      ],
      ["remaining, lastReveal, winnerTeam", "Team card counts, latest reveal and match result."],
    ],
    privateData:
      "Spymasters receive the complete key. Operatives receive null for unrevealed affiliations. The server applies this role projection before MCP receives the board.",
    jev: "Hosted Jev is unavailable for Codenames. External MCP agents can join either role, give a clue, guess a word or end their guessing phase using the same server validation as humans.",
  },
  poker: {
    fields: [
      ["handNumber, community, pot", "Current hand, shared cards and pot."],
      ["currentBet, minRaise, toCall, canCheck", "The street bet and legal betting constraints."],
      [
        "seats",
        "Public room player IDs, isYou, stack, streetBet, contributed, folded, allIn and sittingOut. hole appears only when visible to this seat.",
      ],
      [
        "buttonPlayerId, smallBlindPlayerId, bigBlindPlayerId, blinds",
        "Table position and blind amounts.",
      ],
      [
        "actionHistory, lastHandResult, winner",
        "Latest 24 actions from the current hand with an omitted count, settlement and match result.",
      ],
    ],
    privateData:
      "Your hole cards are private to your seat. Opponent hole cards stay absent until the showdown projection reveals them. Deck order and private agent identities are excluded.",
    jev: "One request sends the projected cards, seats, position, pot, betting amounts, blinds and action history. Criteria contain legal fold/check/call/all_in/next_hand choices and legal bet or raise-to totals in 10-chip steps. At very large stacks, totals are sampled to fit the 255-candidate limit, retaining endpoints and pot-relative sizes. All-in remains separate. The chosen ID maps to an exact legal intent.",
  },
  battleship: {
    fields: [
      [
        "boardSize, fleet, fleetFormat, fleetReady",
        "10×10 board. Each ship ID and its shape offsets appear once. fleetFormat defines dr as row offset and dc as column offset, rows downward and columns rightward, and all four clockwise rotations around the fixed placement anchor. Rotated shapes are not shifted to a new origin. IDs identify placement and remaining or sunk ships.",
      ],
      [
        "ownGrid, ownGridFormat",
        "Ten row strings: . empty water, s your ship, m your armed mine, x hit ship, o attacked water. Mines can only be placed on . cells.",
      ],
      [
        "targetGrid, targetGridFormat, radarScans",
        "Enemy grid: . unknown, o miss, x hit. Your latest 20 radar observations include the scan center and total ship-cell count, including previous hits.",
      ],
      [
        "munitionPoints, weaponCosts, turnReward, damageReward",
        "Current energy, costs, +2 at turn start and +1 per new hit your fleet receives. Cannon costs nothing and earns no energy.",
      ],
      [
        "remainingShips, sunkShips, winner",
        "Enemy ship IDs still afloat, revealed sunk ship anchors and rotations, and result. Shape definitions come from fleet.",
      ],
      [
        "gameTimeRemaining, turnTimeRemaining",
        "Milliseconds remaining. A cannon hit refreshes the turn clock; specials do not. Both MCP and Jev receive the clocks.",
      ],
    ],
    privateData:
      "Your grid includes your fleet and armed mines. Enemy unhit cells and armed mines remain hidden. Radar supplies a count, not exact ship coordinates.",
    jev: "MCP and Jev use the same seat projection. Placement offers six valid layouts as structured objects. In battle, one request asks for a weapon and a target for each available weapon; only the chosen weapon’s target is submitted. Each action gets a fresh projection. Ticking clocks alone do not invalidate a pending answer.",
    exampleNote:
      "Examples exercise a fictional in-memory room through real actions and projections. Six distinct deterministic layouts illustrate placement. The battle includes an armed mine, radar observation, hits and misses, and enough energy for every weapon.",
  },
  contexto: {
    fields: [
      [
        "guessLimit, vocabularySize, totalGuesses",
        "50 accepted guesses per player, dictionary size and total accepted guesses.",
      ],
      [
        "yourProgress",
        "Your word/rank history, lastAttempt, guessCount, guessesRemaining, bestRank and exhausted flag.",
      ],
      ["rivalProgress", "Other players’ guess counts, ranks and progress with their words masked."],
      [
        "secret, winner",
        "secret is omitted during play and may appear only in ended state. The complete ranking table is never part of MCP state.",
      ],
    ],
    privateData:
      "Jev receives only its own word/rank history and guess limit. The target word, rank table, embeddings and opponents’ words are excluded from Jev requests.",
    jev: "The adapter considers every unguessed canonical dictionary word. It divides candidates into Choice questions of at most 255 words, packs questions by byte size, and sends up to three group requests concurrently. Each group nominates one word. A final request selects among those nominees and maps the result to guess_word { word }. The current example uses four requests. This count can vary with state size, remaining words and retries.",
  },
} satisfies Record<string, GameNotes>;

export const toolNotes = {
  agent_claim:
    "Returns a private controllerId, codename, owner and environment metadata, and expiry. Each independent task claims once. The persistent agentId stays on the server.",
  agent_list:
    "Returns agents and count. Metadata is read-only; it contains no identity handles for selecting a seat.",
  auth_status:
    "Returns authenticated, user, optional agent metadata and origin. It describes the authenticated account, not a public game projection.",
  room_create:
    "Returns roomId, roomCode, gameType, joinUrl, wsUrl and expiresAt. Player counts must also satisfy the chosen game. Room codes are private invitation data.",
  room_join:
    "Returns the joined room and seat information. A repeated join with the same controller is rejected. Resume an existing seat with get_state or wait_for_turn.",
  get_state:
    "Returns state with the richer seat projection and roomMembers for lobby management. Legal actions are under state.you.legalActions.",
  wait_for_turn:
    "Returns timedOut, reason, revision and, when needed, a compact state. A normal timeout omits unchanged state. Default 25 seconds; accepted range 1–30 seconds.",
  start_game:
    "Host-only start after the game’s required seats and roles are ready. Returns the room’s start response; continue with wait_for_turn.",
  list_game_tools:
    "Returns per-game action names, descriptions, dataKeys, timer instructions and the core tool list. Omit gameType for all games.",
  get_tool_schema:
    "Returns one action’s field definitions, required fields and example. Include gameType to disambiguate guess_word for Codenames and Contexto.",
  send_action:
    "Returns an acknowledgement for a continuing game, or finalState with next: done when the action ends it. A rejected action can include compact recovery state.",
} satisfies Record<string, string>;

export const exampleController = "00000000-0000-4000-8000-000000000001";

export const exampleRoom = "connect4-ABC234";

export const waitExample = {
  timedOut: false,
  reason: "your_turn",
  revision: 14,
  state: generated.games.find((game) => game.id === "connect4")!.decisionExample,
};

export const actionExample = {
  controllerId: exampleController,
  roomId: exampleRoom,
  actionType: "drop_disc",
  data: { col: 3 },
};

export const acknowledgement = { ok: true, acceptedRevision: 15, next: "wait_for_turn" };

export const timeoutExample = { timedOut: true, reason: "timeout", revision: 14 };

export const endExample = {
  ok: true,
  terminal: true,
  acceptedRevision: 16,
  reason: "connect4",
  finalState: {
    gameType: "connect4",
    status: "ended",
    phase: "ended",
    winnerSeat: 1,
    legalActions: [],
  },
  next: "done",
};

export const publicAiSpec = {
  ...generated,
  fieldGuide: gameNotes,
  toolResults: toolNotes,
  responseExamples: {
    wait: waitExample,
    timeout: timeoutExample,
    acknowledgement,
    terminalExcerpt: endExample,
  },
};
