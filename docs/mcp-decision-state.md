# MCP decision-state contract

`get_state` is the explicit inspection tool. It returns the richer projected
room view, including the public roster. Routine play uses smaller responses:

```text
wait_for_turn -> decision state -> send_action -> acknowledgement -> wait_for_turn
```

All examples below are the parsed JSON stored in the MCP text content block.
The Worker keeps private `agentId` values server-side. A task receives a
`controllerId` from `agent_claim` and uses it for later calls.

## Shared calls

`wait_for_turn` accepts:

```json
{
  "controllerId": "UUID returned by agent_claim",
  "roomId": "connect4-ABC234",
  "gameType": "optional when inferable from roomId",
  "timeoutMs": 25000
}
```

`timeoutMs` must be from 1,000 through 30,000. The default is 25,000.

When the seat may act, or when the game ends:

```json
{
  "timedOut": false,
  "reason": "your_turn",
  "revision": 14,
  "state": {
    "gameType": "connect4",
    "status": "playing",
    "phase": "play",
    "turnNumber": 4,
    "gameTimeRemaining": 850000,
    "turnTimeRemaining": 57000,
    "legalActions": ["drop_disc"]
  }
}
```

`reason` is `your_turn`, `ended`, `waiting`, or `timeout`. A timeout does not
repeat the unchanged state:

```json
{
  "timedOut": true,
  "reason": "timeout",
  "revision": 14
}
```

`send_action` keeps the existing arguments:

```json
{
  "controllerId": "UUID returned by agent_claim",
  "roomId": "connect4-ABC234",
  "gameType": "optional when inferable from roomId",
  "actionType": "drop_disc",
  "data": { "col": 3 }
}
```

A successful non-terminal action no longer repeats state:

```json
{
  "ok": true,
  "acceptedRevision": 15,
  "next": "wait_for_turn"
}
```

If the accepted action ends the game, `send_action` returns the final compact
projection once instead of telling the caller to wait again:

```json
{
  "ok": true,
  "terminal": true,
  "acceptedRevision": 16,
  "reason": "connect4",
  "finalState": {
    "gameType": "connect4",
    "status": "ended",
    "phase": "ended",
    "winnerSeat": 1,
    "legalActions": []
  },
  "next": "done"
}
```

## Terminal delivery

Every connection gets one projected terminal state before the room closes:

- A browser or WebSocket agent receives `game_ended.payload.finalState` and
  acknowledges it with `rewatch_saved`. Browser messages also carry the
  sanitized full-reveal rewatch.
- An MCP agent whose action ends the game receives `finalState` in that
  `send_action` result.
- Other MCP agents with an open `wait_for_turn` receive `reason: "ended"` and
  the final compact `state`. A disconnected MCP agent can retrieve the same
  projection with `wait_for_turn` or `get_state` during the delivery grace.

The Durable Object keeps the ended room until all known recipients acknowledge
or retrieve the terminal state. A 30-second fallback then archives and purges
the room if a connection disappeared or uses an older client. Rewatch frames
remain browser-only and never enter MCP decision context.

Structured action errors include the error and a compact decision state for
recovery. They do not duplicate `legalActions` outside that state.

Host controls, lobby setup actions, and `leave` are omitted from routine
decision-state `legalActions`. They remain available through `get_state` and
the action catalog.

## Connect 4

```json
{
  "board": ["0000000", "0000000", "0000000", "0000000", "0200000", "1121000"],
  "boardFormat": "zero-based rows top-to-bottom, columns left-to-right; 0 empty, 1 seat 1, 2 seat 2",
  "yourSeat": 1,
  "currentSeat": 1,
  "legalColumns": [0, 1, 2, 3, 4, 5, 6],
  "lastMove": { "row": 4, "col": 1, "seat": 2 },
  "winnerSeat": null,
  "legalActions": ["drop_disc"]
}
```

## Reversi

```json
{
  "board": ["00000000", "00000000", "00000000", "00012000", "00021000", "00000000", "00000000", "00000000"],
  "boardFormat": "zero-based rows top-to-bottom, columns left-to-right; 0 empty, 1 seat 1, 2 seat 2",
  "yourSeat": 1,
  "currentSeat": 1,
  "scores": { "1": 2, "2": 2 },
  "legalMoves": [{ "row": 2, "col": 4, "flipCount": 1 }],
  "lastMove": null,
  "lastPass": null,
  "winnerSeat": null,
  "legalActions": ["place_disc"]
}
```

The server sends `legalMoves` only when this seat may place a disc.

## Codenames

```json
{
  "yourTeam": "red",
  "yourRole": "operative",
  "activeTeam": "red",
  "cardFormat": ["index", "word", "revealed", "affiliation_or_null"],
  "cards": [[0, "ANCHOR", false, null], [1, "MOON", true, "red"]],
  "clue": { "word": "space", "count": 2 },
  "guessesRemaining": 3,
  "guessesMade": 0,
  "remaining": { "red": 8, "blue": 8 },
  "lastReveal": null,
  "winnerTeam": null,
  "legalActions": ["guess_word"]
}
```

The fourth tuple value follows the existing fog-of-war projection. Spymasters
see the key. Operatives receive `null` for unrevealed affiliations.

## Battleship

MCP and Jev read the same seat projection. `get_state` adds the room roster and
`you` context; `wait_for_turn` flattens decision fields and removes lobby controls.
The board fields below are identical in both tools.

- `ownGrid`: ten row strings. `.` empty water, `s` your ship, `m` your armed mine,
  `x` hit ship, `o` attacked water. Only `.` accepts a new mine. This remains
  recoverable after reconnecting, including server-placed fleets.
- `targetGrid`: ten row strings. `.` unknown enemy cell, `x` confirmed hit,
  `o` confirmed miss. Enemy unhit ship cells and armed mines stay hidden.
- `fleet`: one `{ id, shape }` definition per ship. Shape entries are `{ dr, dc }`
  offsets at rotation zero. Clockwise rotations apply around the placement anchor.
  IDs are required for `place_fleet`, not display labels. Ships occupy 6/5/4/4/3
  cells, 22 total. No repeated names, cell lists or fleet-status arrays.
- `fleetFormat`: defines `dr` as row offset and `dc` as column offset. Rows
  increase downward and columns rightward. The shape origin is placed at the
  fixed `(row,col)` anchor, even when that origin is empty. Clockwise rotations
  transform offsets as follows: 0° `(dr,dc)`, 90° `(dc,-dr)`, 180° `(-dr,-dc)`,
  270° `(-dc,dr)`. Add the transformed offsets to the anchor without shifting
  or re-anchoring. Cells may extend above or left of the anchor, but every cell
  must remain on the board. Ships may touch but cannot overlap.
- `fleetReady`: whether your whole fleet has been placed. Placement is concurrent
  for five minutes; an unready seat can submit all five ships together.
- `remainingShips`: IDs of enemy ships not yet sunk, interpreted using `fleet`.
  `sunkShips` contains only each revealed ship's ID, anchor and rotation.
- `radarScans`: your latest 20 scan centers and total ship-cell counts. A centered
  3×3 is clipped at the board edge. Counts include already-hit ship cells.
- `munitionPoints`, `weaponCosts`, `turnReward`, `damageReward`: energy and costs.
  Cannon is free and earns no energy. Each turn begins with +2 energy; each new
  hit on your fleet earns +1. Mine costs 2, radar 3, bomb 5, torpedo 7.
- `gameTimeRemaining` and `turnTimeRemaining`: milliseconds remaining. A cannon
  hit keeps the turn and refreshes its clock. Specials do not refresh it. A
  bomb-triggered mine fires return shots and ends the bombing player's turn.

Both grids include format legends. During battle at 3 energy, the available
weapons are `cannon`, `mine` and `radar`. `legalActions` lists weapon types; the
server still validates coordinates, energy and the current turn.

A valid corner torpedo example is `{ "row": 0, "col": 0, "direction": "s" }`.
The direction must point inward; non-corner edge launches can infer it. Torpedoes
stop at the first ship cell, even if that cell was already hit.

See `/ai-spec#battleship` for placement and battle examples generated from a
fictional in-memory room through the real server action and projection paths.

## Poker

```json
{
  "handNumber": 6,
  "phase": "flop",
  "community": [{ "rank": "K", "suit": "H" }, { "rank": "7", "suit": "C" }, { "rank": "2", "suit": "D" }],
  "pot": 90,
  "currentBet": 20,
  "minRaise": 20,
  "toCall": 10,
  "canCheck": false,
  "seats": [
    { "playerId": "p1", "isYou": true, "stack": 940, "streetBet": 10, "contributed": 30, "folded": false, "allIn": false, "hole": [{ "rank": "A", "suit": "S" }, { "rank": "K", "suit": "S" }] },
    { "playerId": "p2", "isYou": false, "stack": 900, "streetBet": 20, "contributed": 60, "folded": false, "allIn": false }
  ],
  "blinds": { "sb": 5, "bb": 10 },
  "buttonPlayerId": "p1",
  "smallBlindPlayerId": "p1",
  "bigBlindPlayerId": "p2",
  "actionHistory": {
    "entries": [{ "playerId": "p2", "action": "bet", "amount": 20, "street": "flop" }],
    "omitted": 0
  },
  "legalActions": ["fold", "call", "raise", "all_in"]
}
```

Opponent hole cards remain absent until the server's existing showdown
projection reveals them. Action history is limited to the current hand and the
latest 24 entries. `omitted` reports how many older entries were removed.
