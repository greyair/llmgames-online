// --- Shared types used by all game room durable objects ---

/** How this seat is connected to the room. */
export type SeatChannel = "browser" | "mcp";

/**
 * Live session seat. Browser humans have a WebSocket; remote MCP agents
 * may have no socket and act via /agent/* endpoints.
 */
export interface Player {
  id: string;
  name: string;
  /** Present for browser WS seats; null/undefined for MCP HTTP seats. */
  socket?: WebSocket | null;
  isConnected: boolean;
  joinedAt: number;
  /** True when this seat is an MCP agent (not a browser human). */
  isAgent?: boolean;
  /**
   * Connection channel:
   * - browser — web app WebSocket human
   * - mcp — remote MCP agent represented by a public room-scoped playerId
   */
  channel?: SeatChannel;
  /** PascalCase AdjectiveObject codename for mcp seats */
  codename?: string;
  /** Public owner identity; never includes an @ prefix. */
  ownerGamertag?: string;
  /** MCP host display hint such as Codex, Claude, or Cursor. */
  environmentLabel?: string;
  /**
   * Watch-only connection when seats are full or the game already started.
   * Spectators are not in `players` and cannot send game intents.
   */
  isSpectator?: boolean;
}

interface TimerConfig {
  gameTotalTime: number;
  turnTime: number;
}

export interface BaseTurnState {
  currentPlayerId: string | null;
  turnNumber: number;
  phase: string;
  startedAt: number;
  turnTimeRemaining: number;
}

export interface BasePlayerInfo {
  /** Server-created hosted seat. Clients cannot assign this marker. */
  hostedAgent?: "jev";
  id: string;
  name: string;
  role?: string;
  /** MCP agent seat. Omitted or false for browser humans. */
  isAgent?: boolean;
  /** browser | mcp — how this seat connected */
  channel?: SeatChannel;
  /** PascalCase AdjectiveObject codename for mcp seats */
  codename?: string;
  /** Public owner identity; never includes an @ prefix. */
  ownerGamertag?: string;
  /** MCP host display hint such as Codex, Claude, or Cursor. */
  environmentLabel?: string;
}

/** Stable per-seat metadata appended to every projected client view. */
export interface YouContext {
  playerId: string;
  name: string | null;
  codename: string | null;
  ownerGamertag: string | null;
  environmentLabel: string | null;
  isHost: boolean;
  isYourTurn: boolean;
  isAgent: boolean;
  isSpectator: boolean;
  seatKind: "spectator" | "mcp" | "human";
  channel: SeatChannel;
  channelLabel: string;
  phase: string;
  status: BaseGameState["status"];
  legalActions: string[];
  /** Optional team-game identity projected by games such as Codenames. */
  team?: string | null;
  role?: string | null;
  canSeeKey?: boolean;
}

/** Public roster entry; playerId is room-scoped and is never an agentId. */
export interface AgentRoomMember {
  playerId: string;
  role: "player" | "spectator";
  isHost: boolean;
  seatKind: "agent" | "human";
  username?: string;
  agentName?: string;
  environmentLabel?: string;
  displayName: string;
}

/** Validated room-creation options shared by the base room and game implementations. */
export interface GameRoomConfig {
  hostId: string;
  hostName: string;
  maxPlayers?: number;
  gameTotalTime?: number;
  turnTime?: number;
  roomCode?: string;
}

/** Minimum shape every game state must have for shared room logic to work */
export interface BaseGameState {
  series?: {
    code: string;
    index: number;
    firstPlayerId: string;
    metrics: Record<
      string,
      {
        actions: number;
        decisionMs: number;
        timeouts: number;
        lastActionAt?: number;
        turnNumber?: number;
      }
    >;
    reported?: boolean;
    aborted?: boolean;
  };
  id: string;
  roomCode: string;
  type: string;
  status: "waiting" | "playing" | "ended";
  /** Host permission captured at match start; never refreshed during this match. */
  broadcastAllowed?: boolean;
  players: BasePlayerInfo[];
  /**
   * Watch-only viewers (room full or game already in progress).
   * Not counted toward maxPlayers; cannot act.
   */
  spectators?: BasePlayerInfo[];
  hostId: string;
  maxPlayers: number;
  timerConfig: TimerConfig;
  gameTimeRemaining: number;
  turnState: BaseTurnState;
  createdAt: number;
  updatedAt: number;
  /** When the match started; the room deadline is anchored here, not at creation. */
  playStartedAt?: number;
  /** Absolute room expiry timestamp in milliseconds since Unix epoch. */
  expiresAt: number;
}

// --- Connect 4 ---

export type Connect4Cell = 0 | 1 | 2; // 0 empty, 1 P1, 2 P2

export interface Connect4GameState extends BaseGameState {
  type: "connect4";
  turnState: BaseTurnState & { phase: "waiting" | "play" | "ended" };
  /** 6 rows × 7 cols, row 0 = top */
  board: Connect4Cell[][];
  /** playerId → seat 1 | 2 */
  seats: Record<string, 1 | 2>;
  winner: string | null; // playerId | "draw"
  lastMove: { col: number; row: number; seat: 1 | 2 } | null;
}

// --- Gomoku ---

/** 0 empty, 1 black (seat 1), 2 white (seat 2). */
export type GomokuCell = 0 | 1 | 2;

export interface GomokuGameState extends BaseGameState {
  type: "gomoku";
  turnState: BaseTurnState & { phase: "waiting" | "play" | "ended" };
  /** 15 rows × 15 cols, row 0 = top. Same axis as the structured `place_stone`. */
  board: GomokuCell[][];
  /** playerId → seat 1 | 2 */
  seats: Record<string, 1 | 2>;
  winner: string | null; // playerId | "draw"
  lastMove: { row: number; col: number; seat: 1 | 2 } | null;
  /** The run that ended the match, kept for the winning-line highlight. */
  winLine: Array<{ row: number; col: number }> | null;
}

// --- Aeroplane Chess (飞行棋) ---

/**
 * Progress values every plane shares, ported from West Window's board geometry:
 * -1 hangar, 0 take-off square, 1..52 loop, 53..58 home column, 59 home.
 */
export type AeroplaneProgress = number;

export interface AeroplaneCaptures {
  seat: number;
  planes: number[];
}

export interface AeroplaneGameState extends BaseGameState {
  type: "aeroplane";
  turnState: BaseTurnState & { phase: "waiting" | "roll" | "choose" | "ended" };
  /** playerId → seat index 0..N-1, in board-colour order. */
  seats: Record<string, number>;
  /** Board colour (0..3) owned by each seat, clockwise from the bottom arm. */
  colours: number[];
  /** Rolls that let a plane leave the hangar: `[6]` or `[5, 6]`. */
  takeoff: number[];
  /** `planes[seat][planeIndex]`; four planes per seat, numbered 1..4 to players. */
  planes: AeroplaneProgress[][];
  /** The roll the seat to move must use, and who rolled it. */
  roll: number | null;
  rollBy: string | null;
  /** Consecutive sixes in the current turn. Three sends the chosen plane home. */
  sixes: number;
  /** What the roll did the last time a plane moved, for the browser trail. */
  lastMove: {
    playerId: string;
    seat: number;
    plane: number;
    kind: "launch" | "move";
    from: AeroplaneProgress;
    to: AeroplaneProgress;
    jump: AeroplaneProgress | null;
    fly: AeroplaneProgress | null;
    bounce: boolean;
    home: boolean;
    sentBack: boolean;
    captures: AeroplaneCaptures[];
  } | null;
  winner: string | null; // playerId
}

// --- Contexto ---

export interface ContextoGuess {
  word: string;
  /** What the player typed when an explicit alias resolved to `word`. */
  submittedWord?: string;
  rank: number;
  sequence: number;
}

export interface ContextoGuessAttempt {
  submittedWord: string;
  canonicalWord?: string;
  status: "ranked" | "aliased" | "not_in_pool";
  rank?: number;
}

export interface ContextoPlayerProgress {
  playerId: string;
  guesses: ContextoGuess[];
  lastAttempt: ContextoGuessAttempt | null;
  bestRank: number | null;
  exhausted: boolean;
}

export interface ContextoGameState extends BaseGameState {
  type: "contexto";
  turnState: BaseTurnState & { phase: "waiting" | "guessing" | "ended" };
  secret: string;
  /** Server-only base64 Uint16 rank lookup. Never project or archive. */
  rankTable: string;
  guessLimit: 50;
  vocabularySize: number;
  progress: Record<string, ContextoPlayerProgress>;
  winner: string | null;
  totalGuesses: number;
}

// --- Reversi ---

export type ReversiCell = 0 | 1 | 2; // 0 empty, 1 black, 2 white

export interface ReversiMove {
  row: number;
  col: number;
  flipCount: number;
}

export interface ReversiGameState extends BaseGameState {
  type: "reversi";
  turnState: BaseTurnState & { phase: "waiting" | "play" | "ended" };
  /** 8 rows × 8 cols, row 0 = top */
  board: ReversiCell[][];
  /** playerId → 1 (black) | 2 (white) */
  seats: Record<string, 1 | 2>;
  winner: string | null; // playerId | "draw"
  scores: Record<1 | 2, number>;
  /** Legal placements for the current player; computed by the server. */
  legalMoves: ReversiMove[];
  lastMove: {
    playerId: string;
    row: number;
    col: number;
    seat: 1 | 2;
    flipped: Array<{ row: number; col: number }>;
  } | null;
  lastPass: { playerId: string; seat: 1 | 2; turn: number } | null;
}

// --- Codenames ---

export type CodenamesTeam = "red" | "blue";

export type CodenamesRole = "spymaster" | "operative";

export type CodenamesAffiliation = CodenamesTeam | "neutral" | "assassin";

export interface CodenamesCard {
  index: number;
  word: string;
  affiliation: CodenamesAffiliation;
  revealed: boolean;
  revealedBy: string | null;
}

export interface CodenamesAssignment {
  team: CodenamesTeam;
  role: CodenamesRole;
}

export interface CodenamesClue {
  word: string;
  count: number | "unlimited";
  givenBy: string;
  at: number;
}

export interface CodenamesLogEntry {
  at: number;
  type: "clue" | "guess" | "turn_end" | "game_end";
  team: CodenamesTeam | null;
  playerId: string | null;
  word?: string;
  count?: number | "unlimited";
  affiliation?: CodenamesAffiliation;
  reason?:
    | "stopped"
    | "timeout"
    | "wrong_guess"
    | "guess_limit"
    | "assassin"
    | "all_agents_contacted"
    | "game_timeout";
  winner?: CodenamesTeam | "draw";
}

export interface CodenamesGameState extends BaseGameState {
  type: "codenames";
  turnState: BaseTurnState & {
    phase: "waiting" | "clue" | "guess" | "ended";
  };
  board: CodenamesCard[];
  assignments: Record<string, CodenamesAssignment>;
  startingTeam: CodenamesTeam;
  activeTeam: CodenamesTeam;
  clue: CodenamesClue | null;
  /** Null for the official zero / unlimited expert clues. */
  guessesRemaining: number | null;
  guessesMade: number;
  remaining: Record<CodenamesTeam, number>;
  winner: CodenamesTeam | "draw" | null;
  winnerTeam: CodenamesTeam | null;
  /** Public, compact in-room history for the browser game-log rail. */
  activityLog?: CodenamesLogEntry[];
  lastReveal: {
    index: number;
    word: string;
    affiliation: CodenamesAffiliation;
    playerId: string;
  } | null;
}

// --- Shared playing cards ---
export type CardRank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

export type CardSuit = "S" | "H" | "D" | "C";

// --- Battleship ---

export type ShipId = "carrier" | "dreadnought" | "cruiser" | "submarine" | "destroyer";

/**
 * Special munitions (energy economy).
 * Normal shots are free; specials spend points earned at turn start.
 */
export type WeaponId = "radar" | "bomb" | "torpedo" | "mine";

/** Absolute rotation in degrees (CW from the shape's default facing). */
export type ShipRotation = 0 | 90 | 180 | 270;

/** Relative cell offset from the placement anchor (row, col). */
export type CellOffset = { dr: number; dc: number };

export interface ShipSpec {
  id: ShipId;
  /** Number of occupied cells (HP). */
  length: number;
  /** Display name */
  name: string;
  /** Short label for UI */
  shortName: string;
  /**
   * Polyomino silhouette at rotation 0 (anchor = placement cell).
   * Not pure lines — each class has a distinct naval footprint.
   */
  "shape": CellOffset[];
}

/** Fleet footprints shared with browser previews. Rotations remain server validated. */
export { BATTLESHIP_FLEET, BATTLESHIP_FALLBACK_FLEET } from "@llmgames/game-catalog";

/**
 * Point cost for each special weapon (spent from munitionPoints).
 * Cannon is free and is not listed here.
 */
export const BATTLESHIP_WEAPON_COSTS: Record<WeaponId, number> = {
  /** 2×2 airstrike — attack every cell in the zone */
  mine: 2,
  bomb: 5,
  /** 3×3 scan — info only (no hits / no miss pegs) */
  radar: 3,
  /** Edge launch → travels row/col until first ship hit, then stops */
  torpedo: 7,
};

/** Legacy reward field. Normal shots no longer award points. */
export const BATTLESHIP_CANNON_POINT_REWARD = 0;

/**
 * Everyone starts with 0 munition points.
 * Gain 2 points at the start of each battle turn.
 */
export const BATTLESHIP_STARTING_MUNITION_POINTS = 0;

export const BATTLESHIP_TURN_POINT_REWARD = 2;

/** Awarded to the defender once per newly damaged ship cell, from any weapon. */
export const BATTLESHIP_DAMAGE_POINT_REWARD = 1;

export interface WeaponCatalogEntry {
  id: WeaponId | "cannon";
  name: string;
  description: string;
  pattern: string;
  /** Munition points required per use (0 = free / earns points) */
  cost: number;
  /** Points gained when this weapon is used (cannon only) */
  reward?: number;
}

export const BATTLESHIP_WEAPONS_CATALOG: WeaponCatalogEntry[] = [
  {
    id: "mine",
    name: "Mines",
    description:
      "Place a hidden mine on empty, unattacked water on your own board. When shot, it fires three random return shots. Costs 2 pts; reusable while you have enough energy; keeps your normal shot available.",
    pattern: "own board trap",
    cost: BATTLESHIP_WEAPON_COSTS.mine,
  },
  {
    id: "cannon",
    name: "Cannon",
    description: "Fire a single cell. Free. No point reward. Hit keeps your turn; miss ends it.",
    pattern: "1 cell",
    cost: 0,
    reward: BATTLESHIP_CANNON_POINT_REWARD,
  },
  {
    id: "bomb",
    name: "Bomb",
    description:
      "Drop a bomb on a 2×2 zone (click = top-left). Every cell is attacked. Reusable while you have enough energy; keeps your normal shot available unless it triggers a mine, which fires three return shots and ends your turn.",
    pattern: "2×2 attack",
    cost: BATTLESHIP_WEAPON_COSTS.bomb,
  },
  {
    id: "radar",
    name: "Radar",
    description:
      "Scan a 3×3 area. Does not hit or mark cells — only reports ship-cell count. Reusable while you have enough energy; keeps your normal shot available.",
    pattern: "3×3 scan (info only)",
    cost: BATTLESHIP_WEAPON_COSTS.radar,
  },
  {
    id: "torpedo",
    name: "Torpedo",
    description:
      "Launch from a board edge only. Travels the row/column inward until the first ship is hit, then stops. Reusable while you have enough energy; keeps your normal shot available. Direction inferred from the edge (corners need n|s|e|w).",
    pattern: "edge → stop on first hit",
    cost: BATTLESHIP_WEAPON_COSTS.torpedo,
  },
];

export type TorpedoDirection = "n" | "s" | "e" | "w";

interface TorpedoDirectionAliases {
  [alias: string]: TorpedoDirection;
}

const TORPEDO_DIR_ALIASES: TorpedoDirectionAliases = {
  n: "n",
  north: "n",
  up: "n",
  s: "s",
  south: "s",
  down: "s",
  e: "e",
  east: "e",
  right: "e",
  w: "w",
  west: "w",
  left: "w",
};

/** Normalize torpedo direction aliases to n|s|e|w. */
function parseTorpedoDirection(raw: string | undefined | null): TorpedoDirection | null {
  if (!raw) return null;

  return TORPEDO_DIR_ALIASES[raw.toLowerCase()] ?? null;
}

/**
 * Inward directions allowed when launching a torpedo from a board cell.
 * Edge cells have one; corners have two; interior cells have none.
 */
function torpedoInwardDirections(row: number, col: number, size = 10): TorpedoDirection[] {
  const dirs: TorpedoDirection[] = [];

  if (row === 0) dirs.push("s");

  if (row === size - 1) dirs.push("n");

  if (col === 0) dirs.push("e");

  if (col === size - 1) dirs.push("w");

  return dirs;
}

/**
 * Resolve torpedo direction: launch must be on a board edge.
 * Non-corner edges infer direction; corners require an explicit valid dir.
 */
export function resolveTorpedoDirection(
  row: number,
  col: number,
  requested?: string | null,
  size = 10,
): { direction: TorpedoDirection } | { error: string } {
  const valid = torpedoInwardDirections(row, col, size);

  if (valid.length === 0) {
    return {
      error: "Torpedo must be launched from a board edge (row 0/9 or col 0/9)",
    };
  }

  const parsed = parseTorpedoDirection(requested ?? null);

  if (!parsed) {
    if (valid.length === 1) return { direction: valid[0]! };

    return {
      error: `Corner launch requires direction: ${valid.join("|")}`,
    };
  }

  if (!valid.includes(parsed)) {
    return {
      error: `From this edge cell, direction must be ${valid.join("|")} (inward)`,
    };
  }

  return { direction: parsed };
}

export const TORPEDO_DELTAS: Record<TorpedoDirection, { dr: number; dc: number }> = {
  n: { dr: -1, dc: 0 },
  s: { dr: 1, dc: 0 },
  e: { dr: 0, dc: 1 },
  w: { dr: 0, dc: -1 },
};

/** Rotate a relative offset clockwise by 0/90/180/270 around the anchor. */
function rotateOffset(off: CellOffset, rotation: ShipRotation): CellOffset {
  const { dr, dc } = off;

  switch (rotation) {
    case 0:
      return { dr, dc };
    case 90:
      return { dr: dc, dc: -dr };
    case 180:
      return { dr: -dr, dc: -dc };
    case 270:
      return { dr: -dc, dc: dr };
  }
}

/** Absolute cells for a ship at (row, col) with the given rotation. */
export function cellsForShipSilhouette(
  row: number,
  col: number,
  silhouette: CellOffset[],
  rotation: ShipRotation,
) {
  return silhouette.map((off) => {
    const r = rotateOffset(off, rotation);

    return { row: row + r.dr, col: col + r.dc };
  });
}

/**
 * Normalize placement orientation input.
 * Accepts: rotation 0|90|180|270, "h"|"v" (legacy → 0|90), "n"|"e"|"s"|"w".
 */
export function parseShipRotation(
  raw: import("@llmgames/game-catalog").WireValue,
): ShipRotation | null {
  if (raw === 0 || raw === "0" || raw === "h" || raw === "e" || raw === "east") {
    return 0;
  }

  if (raw === 90 || raw === "90" || raw === "v" || raw === "s" || raw === "south") {
    return 90;
  }

  if (raw === 180 || raw === "180" || raw === "w" || raw === "west") {
    return 180;
  }

  if (raw === 270 || raw === "270" || raw === "n" || raw === "north") {
    return 270;
  }

  return null;
}

export interface PlacedShip {
  id: ShipId;
  row: number;
  col: number;
  /** Absolute CW rotation of the polyomino (0 = default shape). */
  rotation: ShipRotation;
  /**
   * Legacy alias kept for older clients: "h" if rotation 0 or 180, "v" otherwise.
   * Prefer `rotation`.
   */
  orientation: "h" | "v";
  hits: number;
  sunk: boolean;
}

/** How a cell was attacked. `fire` is a legacy alias of `cannon`. */
export type ShotWeapon = "cannon" | "fire" | WeaponId;

export interface BattleShot {
  row: number;
  col: number;
  hit: boolean;
  sunkShipId?: ShipId;
  byPlayerId: string;
  /** How this cell was attacked (default fire) */
  weapon?: ShotWeapon;
  /** Group id when one action hits multiple cells */
  salvoId?: string;
}

/** A private, persistent radar observation owned by the scanning player. */
export interface BattleshipRadarScan {
  row: number;
  col: number;
  shipCells: number;
  /** Actual cells checked when the centered 3×3 area is clipped by an edge. */
  cellsScanned: number;
}

export interface BattleshipPlayerBoard {
  playerId: string;
  ships: PlacedShip[];
  /** 10×10: null = empty, shipId if occupied */
  cells: (ShipId | null)[][];
  ready: boolean;
  /**
   * Spendable munition points for special weapons.
   * Gain 2 points each turn and 1 for each new hit received. Mine costs 2, radar 3, bomb 5, torpedo 7.
   */
  munitionPoints: number;
  /** Hidden from opponents until triggered. */
  mines?: { row: number; col: number }[];
  /** Hidden from opponents. Used to render the player's past radar searches. */
  radarScans?: BattleshipRadarScan[];
  /** Public radar zones received by this board. */
  receivedRadarScans?: BattleshipRadarScan[];
  /** Public top-left coordinates of bomb zones received by this board. */
  bombedAreas?: { row: number; col: number }[];
  /** Public locations of mines after an opponent triggers them. */
  triggeredMines?: { row: number; col: number }[];
  torpedoPaths?: {
    row: number;
    col: number;
    endRow: number;
    endCol: number;
    direction: TorpedoDirection;
  }[];
  /** Public cells selected by triggered-mine return fire, including misses. */
  mineShots?: { row: number; col: number }[];
  /** Return-fire cells that hit a ship. Kept for projection compatibility. */
  mineHits?: { row: number; col: number }[];
  /**
   * Derived convenience: max uses left if you spent remaining points only on
   * that weapon (floor(points / cost)). Prefer munitionPoints + costs.
   */
  weapons: Record<WeaponId, number>;
  /** Shots this player has fired (cells attacked) */
  shotsFired: number;
  /** Hits this player scored */
  hitsScored: number;
}

export interface BattleshipGameState extends BaseGameState {
  type: "battleship";
  turnState: BaseTurnState & {
    phase: "waiting" | "placement" | "battle" | "ended";
  };
  boards: BattleshipPlayerBoard[];
  shots: BattleShot[];
  winner: string | null;
  boardSize: 10;
  /** Last combat announcement (hit / miss / sunk / radar) for UI */
  lastAnnouncement: string | null;
}

// --- 2–6 player Texas Hold'em ---

export type PokerStreet =
  | "waiting"
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"
  | "hand_over"
  | "ended";

export interface PokerCardPublic {
  rank: CardRank;
  suit: CardSuit;
}

export interface PokerSeat {
  playerId: string;
  name: string;
  stack: number;
  hole: PokerCardPublic[];
  /** Chips committed this street */
  streetBet: number;
  /** Chips committed this hand (total in pot from this seat) */
  handContributed: number;
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
}

interface PokerActionLog {
  playerId: string;
  action: string;
  amount?: number;
  street: PokerStreet;
  handNumber: number;
}

interface PokerHandResult {
  winners: string[];
  pot: number;
  showdown: boolean;
  finishedAt?: number;
  hands?: Array<{
    playerId: string;
    hole: PokerCardPublic[];
    category: string;
    label: string;
  }>;
  reason: string;
  payouts?: Array<{ playerId: string; amount: number }>;
  sidePots?: Array<{
    amount: number;
    eligiblePlayerIds: string[];
    winnerIds: string[];
    refunded?: boolean;
  }>;
}

export interface PokerGameState extends BaseGameState {
  type: "poker";
  turnState: BaseTurnState & { phase: PokerStreet };
  seats: PokerSeat[];
  /** Button / dealer seat index. The button posts SB only when heads-up. */
  buttonIndex: number;
  smallBlind: number;
  bigBlind: number;
  pot: number;
  community: PokerCardPublic[];
  /** Current bet to match on this street */
  currentBet: number;
  /** Minimum raise size remaining (last full raise increment) */
  minRaise: number;
  /** Cards remaining (server-only) */
  deck: PokerCardPublic[];
  deckCommitHash: string | null;
  handNumber: number;
  /** Player who must act */
  actionPlayerId: string | null;
  /** Last aggressor this street (for when action closes) */
  lastAggressorId: string | null;
  /** Players who have acted since last aggression (or open) */
  actorsThisStreet: string[];
  lastHandResult: PokerHandResult | null;
  winner: string | null;
  actionLog: PokerActionLog[];
  startingStack: number;
}

// Checkers cells: 0 empty, 1 black man, 2 white man, 3 black king, 4 white king.
export type CheckersCell = 0 | 1 | 2 | 3 | 4;

export interface CheckersMove {
  fromRow: number;
  fromCol: number;
  row: number;
  col: number;
  capture: { row: number; col: number } | null;
}

export interface CheckersGameState extends BaseGameState {
  type: "checkers";
  board: CheckersCell[][];
  seats: Record<string, 1 | 2>;
  scores: Record<1 | 2, number>;
  winner: string | null;
  legalMoves: CheckersMove[];
  forcedPiece: { row: number; col: number } | null;
  lastMove: (CheckersMove & { playerId: string; crowned: boolean }) | null;
  quietTurns: number;
  positionCounts: Record<string, number>;
}

// --- Shared card vocabulary for 跑得快 and 斗地主 ---

/** Shapes both card games recognise; each game enables a subset. */
export type CardComboKind =
  | "single"
  | "pair"
  | "triple"
  | "triple_one"
  | "triple_pair"
  | "straight"
  | "pair_run"
  | "plane"
  | "plane_one"
  | "plane_pair"
  | "four_two"
  | "four_two_pair"
  | "bomb"
  | "rocket";

/**
 * A recognised play.
 *
 * `size` is how many cards it uses (a follower must match it), `key` is the rank
 * that decides which of two shapes of the same kind wins, and `len` is the chain
 * length — 1 for every fixed shape.
 */
export interface CardCombo {
  kind: CardComboKind;
  size: number;
  key: number;
  len: number;
}

/** One play or pass in a trick. `combo` is null for a pass. */
export interface CardActionRecord {
  seat: number;
  cards: string[];
  combo: CardCombo | null;
  n: number;
}

export interface PaodekuaiGameState extends BaseGameState {
  type: "paodekuai";
  turnState: BaseTurnState & { phase: "waiting" | "play" | "ended" };
  /** playerId → seat index 0..N-1. */
  seats: Record<string, number>;
  /** One hand per seat, sorted weakest first. */
  hands: string[][];
  /** Cards set aside unseen in a two-player game; empty with three seats. */
  unused: string[];
  /** Seat that led the first trick. */
  first: number;
  /** A card the next lead must include (♠3 on the first play), else null. */
  mustLead: string | null;
  toPlay: number;
  /** The combination to beat, or null when `toPlay` leads. */
  trick: CardActionRecord | null;
  /** The play that won the previous trick, shown while the next one is led. */
  lastTrick: CardActionRecord | null;
  /** Passes since the last play. */
  passes: number;
  lastPass: number | null;
  /** Each seat's latest action in the current trick. */
  acts: (CardActionRecord | null)[];
  /** Recent actions, newest last. */
  plays: CardActionRecord[];
  tricks: number;
  /** Cards each seat has played, for the spring bonus. */
  played: number[];
  winner: string | null;
}

export interface DoudizhuGameState extends BaseGameState {
  type: "doudizhu";
  turnState: BaseTurnState & { phase: "waiting" | "bid" | "play" | "ended" };
  /** playerId → seat index 0..2. */
  seats: Record<string, number>;
  /** One hand per seat, sorted weakest first. */
  hands: string[][];
  /** The three bottom cards; hidden until a landlord takes them. */
  bottom: string[];
  bottomRevealed: boolean;
  landlord: number | null;
  /** Highest bid so far, 0 while nobody has bid. */
  bid: number;
  bidder: number | null;
  /** Per seat: null until it acts, 0 for a pass, 1-3 for a bid. */
  bids: (number | null)[];
  /** Seat to act, in either phase. */
  toAct: number;
  /** Seat that opens the bidding; rotates when a deal is thrown in. */
  firstBidder: number;
  trick: CardActionRecord | null;
  lastTrick: CardActionRecord | null;
  passes: number;
  lastPass: number | null;
  acts: (CardActionRecord | null)[];
  plays: CardActionRecord[];
  tricks: number;
  /** Cards each seat has played, for the spring bonus. */
  played: number[];
  /** Doubling from bombs and rockets. */
  multiplier: number;
  /** Deals played, so a thrown-in deal is visible in the record. */
  deals: number;
  winner: string | null;
  winnerSide: "landlord" | "farmers" | null;
  /** Hand score: bid × 2^multiplier × spring. */
  score: number;
}

export interface MonopolyGameState extends BaseGameState {
  type: "monopoly";
  turnState: BaseTurnState & { phase: "waiting" | "roll" | "buy" | "end" | "ended" };
  /** playerId → seat index 0..3. */
  seats: Record<string, number>;
  /** Cash per seat; a negative value never survives settlement. */
  cash: number[];
  /** Board index per seat. */
  position: number[];
  jail: boolean[];
  /** Failed doubles attempts while jailed. */
  jailTurns: number[];
  /** Get-out-of-jail cards held per seat. */
  jailCards: number[];
  /** Owner seat per board index, or null; non-property squares stay null. */
  owners: (number | null)[];
  /** House levels per board index, 0-3. */
  houses: number[];
  /** Remaining chance cards, top last. Hidden from every projection. */
  deck: number[];
  /** Doubles rolled so far in this turn. */
  doubles: number;
  /** The dice just rolled, for the board. */
  roll: [number, number] | null;
  /** Chance card drawn this turn. */
  card: number | null;
  /** Board index the mover landed on, for the board highlight. */
  landed: number | null;
  bankrupt: boolean[];
  winner: string | null;
  /** Turns taken in total, and full rounds completed. */
  turns: number;
  rounds: number;
}

// --- Chess (国际象棋) ---

export type ChessColor = "w" | "b";

export interface ChessLastMove {
  /** Square indices 0-63 in FEN order. */
  from: number;
  to: number;
  uci: string;
  san: string;
}

/**
 * Why the match ended: the four drawn outcomes the rules produce, plus the two
 * the clocks do. There is no resign — the turn clock is the only way to lose a
 * game you are still sitting in.
 */
export type ChessEndReason =
  | "checkmate"
  | "stalemate"
  | "fifty_move"
  | "repetition"
  | "insufficient_material"
  | "timeout"
  | "match_timeout";

export interface ChessGameState extends BaseGameState {
  type: "chess";
  turnState: BaseTurnState & { phase: "waiting" | "play" | "ended" };
  /** playerId → seat 1 plays White and moves first, 2 plays Black. */
  seats: Record<string, 1 | 2>;
  /** 64 chars in FEN order: index 0 = a8, 7 = h8, 56 = a1, 63 = h1. "." is empty. */
  board: string;
  turn: ChessColor;
  /** Remaining castling rights, a subset of "KQkq" in that order. */
  castling: string;
  /** En-passant target square (the square a pawn just skipped), or null. */
  ep: number | null;
  /** Plies since the last capture or pawn move; the fifty-move rule fires at 100. */
  halfmove: number;
  /** Full-move number as in FEN: starts at 1, increases after Black moves. */
  fullmove: number;
  plies: number;
  last: ChessLastMove | null;
  /** Letters each side has taken: `w` holds the black pieces White captured. */
  captured: { w: string; b: string };
  /** Repetition keys since the last capture or pawn move; current one last. */
  history: string[];
  /** UCI moves legal for the side to move, recomputed after every move. */
  legal: string[];
  /** The side to move is in check. */
  check: boolean;
  /** Square of the checked king, or null. */
  checkSquare: number | null;
  result: { winner: ChessColor | "draw"; reason: ChessEndReason } | null;
  winner: string | null; // playerId | "draw"
}
