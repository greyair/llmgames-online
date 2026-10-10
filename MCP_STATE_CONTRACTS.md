# Remote MCP state contracts

Remote MCP tools receive a compact, seat-projected decision state. Browser
WebSockets continue to receive the full UI projection. Both views are built from
the same server-owned game state and enforce the same fog-of-war rules.

Successful `room_create`, `room_join`, `get_state`, `start_game`, and
`send_action` responses include `state`. `wait_for_turn` includes `state` when it
wakes for a turn, game end, or another relevant state change. An ordinary wait
timeout is deliberately small:

```json
{ "timedOut": true, "reason": "timeout" }
```

Agents always receive a complete decision state after a successful action; the
state is not a delta and does not need to be merged with an older response.

Every `id`, `playerId`, and `currentPlayerId` in projected state is a public,
room-scoped identifier. These values are deliberately different from the
server-side `agentId` and cannot authenticate an action. MCP tools use a
short-lived `controllerId` returned by `agent_claim`.

## Common contract

Every game state has this base shape. Optional fields are omitted rather than
serialized as `undefined`.

```ts
interface McpGameState {
  type: GameType;
  status: "waiting" | "playing" | "ended";
  players: Array<{ id: string; name: string }>;
  gameTimeRemaining: number;
  turnState: {
    currentPlayerId: string | null;
    turnNumber: number;
    phase: string;
    turnTimeRemaining: number;
  };
  winner?: string | null;
  you: {
    playerId: string;
    isHost: boolean;
    isYourTurn: boolean;
    isSpectator: boolean;
    phase: string;
    legalActions: string[];
    // Game-specific decision fields may follow.
  };
}
```

The MCP projection excludes room IDs and codes, creation/update/expiry
timestamps, timer configuration, spectator lists, owner/environment labels,
channel display fields, UI catalogs, animation data, and descriptive randomness
copy. The DO retains its private activity log, but never includes it in MCP
responses.

## Connect 4

```ts
interface FourInARowMcpState extends McpGameState {
  type: "connect4";
  board: Array<Array<0 | 1 | 2>>;
  seats: Record<string, 1 | 2>;
  lastMove: { col: number; row: number; seat: 1 | 2 } | null;
  you: McpGameState["you"] & { seat: 1 | 2 | null; role: string | null };
}
```

## Reversi

```ts
interface ReversiMcpState extends McpGameState {
  type: "reversi";
  board: Array<Array<0 | 1 | 2>>;
  seats: Record<string, 1 | 2>;
  scores: Record<1 | 2, number>;
  legalMoves: Array<{ row: number; col: number; flipCount: number }>;
  lastMove: object | null;
  lastPass: object | null;
  you: McpGameState["you"] & { seat: 1 | 2 | null; color: string | null };
}
```

## Codenames

```ts
interface CodenamesMcpState extends McpGameState {
  type: "codenames";
  board: Array<{
    index: number;
    word: string;
    affiliation: "red" | "blue" | "neutral" | "assassin" | null;
    revealed: boolean;
    revealedBy: string | null;
  }>;
  assignments: Record<string, {
    team: "red" | "blue";
    role: "spymaster" | "operative";
  }>;
  startingTeam: "red" | "blue";
  activeTeam: "red" | "blue";
  clue: { word: string; count: number | "unlimited"; givenBy: string } | null;
  guessesRemaining: number | null; // null for 0 / unlimited clues
  guessesMade: number;
  remaining: { red: number; blue: number };
  winnerTeam: "red" | "blue" | null;
  lastReveal: object | null;
  you: McpGameState["you"] & {
    team: "red" | "blue" | null;
    role: "spymaster" | "operative" | "spectator" | null;
    canSeeKey: boolean;
  };
}
```

Unrevealed `affiliation` values are `null` for operatives and spectators. Both
spymasters receive the complete key during play; completed rewatch frames are
also full reveal. During the guess phase every operative on the active team may
wake from `wait_for_turn` and submit the team's next guess.

While `status` is `waiting`, `assignments` may be partial. Each member uses
`assign_codenames_role` with their own `playerId` to choose a role; a spectator
claims an open player seat by doing so. The host may arrange any seated player
and can reset or securely randomize the teams. Starting is blocked until every
current player is assigned, both teams have exactly one spymaster and at least
one operative, and team sizes differ by no more than one. The host may call
`set_host_spectating({ spectating: true })` to remain an organizing spectator;
`you.isHost` stays true, the host receives no assignment, and does not count
toward the four-player minimum.

## Battleship

```ts
interface FindMyShipMcpState extends McpGameState {
  type: "battleship";
  boardSize: 10;
  lastAnnouncement: string | null;
  fleet?: FleetShape[]; // Placement phase only.
  munitionEconomy: {
    cannonReward: number;
    costs: Record<string, number>;
    yourPoints: number;
  };
  yourBoard: {
    ships: PlacedShip[];
    ready: boolean;
    munitionPoints: number;
    fleetStatus: object[];
    incomingHits: Shot[];
    incomingMisses: Shot[];
  } | null;
  opponent: {
    playerId: string;
    ready: boolean;
    hits: Shot[];
    misses: Shot[];
    shipsRemaining: number;
    sunkShips: object[];
  } | null;
}
```

The full 10×10 own-board cell matrix, duplicated shot log, weapon catalog,
display notes, and derived UI statistics are excluded. Ship placement data,
known hit/miss coordinates, munition points, costs, and radar announcements
remain available for decisions.
