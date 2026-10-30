# Adding a game

A new game consists of a server room, public contracts, a browser board, and
an agent projection. There is no dynamic plugin loader. Registration is
explicit so the compiler can catch missing cases.

Since M3 a game can implement its rules as a `GamePlugin` and keep the Durable
Object as a thin adapter — see [M3-DESIGN.md](M3-DESIGN.md). Connect 4 is the
reference: rules in `apps/workers/src/games/connect4/`, room in
`apps/workers/src/durable-objects/Connect4Room.ts`. Games that have not been
migrated still implement the rules directly on their `BaseGameRoom` subclass;
both shapes are supported, so migrate one game at a time.

```text
rules plugin   apps/workers/src/games/<id>/{rules,plugin}.ts    no storage, clocks or sockets
adapter room   apps/workers/src/durable-objects/<X>Room.ts      ~40 lines of platform glue
metadata       packages/game-catalog/src/manifest.ts            one entry
actions        packages/game-catalog/src/index.ts               GAME_ACTIONS + GAME_INSTRUCTIONS
board          apps/web/src/game-ui/boardRegistry.ts            one lazy entry
```

A plugin returns effects (`event`, `stop_timers`, `match_ended`) instead of
persisting or broadcasting: `BaseGameRoom.applyGameEffects` is the only place
those reach the audit log, the clocks and the final `game_ended` delivery.
`match_ended` only marks the match for delivery — the terminal projection is
broadcast after `dispatchAction` writes the finished state and its receipt in
one call. Do not call `saveState()` from a rule module: that pairing is what
makes a retry a replay, and a second write reopens the gap M3.2.1 closed.

Overrides are optional: `projectState` narrows the live projection,
`rewatchView` narrows the replay frame (its default is full reveal of the state),
`agentFields` adds MCP decision fields — and it only ever receives the
recipient's own projection, so a rule module cannot widen what a player may see.

`projectState` is applied by the base class to all three outgoing views (browser,
broadcast, agent), so declaring it is enough; do not re-implement
`projectStateFor` in an adapter, and do not assume a room-level override is
needed. If you hide a field, `apps/workers/src/tests/platform/pluginProjection.test.ts`
checks it never appears in any of the three views.

Two hooks describe the viewer: `seatIdentity` returns a seat/role/colour, and
`youFields` adds game-owned keys to the browser `you` block (Battleship's
munition wallet). Omit `seat` when the game has none — returning `null` would add
a key that legacy clients never saw. Battleship is a good reference for a game
with hidden information and simultaneous decisions: `apps/workers/src/games/battleship`.

Role-based games add two more: `validateStart` refuses an invalid lobby before
the match begins (report a `StartGameProblem`), and `onMemberRoleChanged` clears
whatever a seat held when it moves to the spectator list. Codenames is the
reference: `apps/workers/src/games/codenames`. Its lobby role assignment stays in
the room, because choosing a team can promote a spectator into a player seat —
that is platform work, not a rule.

Registration is still required in the deployment surface, which the plugin does
not remove: the class export in `apps/workers/src/index.ts`, the `Env` binding,
the `roomRouting.ts` case, both wrangler configs, and an appended D1 migration
that widens the `game_type` CHECK constraint.

Use Reversi as a small reference for a room written before M3. Its rules and
room live in `apps/workers/src/durable-objects/ReversiRoom.ts`; its rule and
integration tests live under `apps/workers/src/tests/games/reversi`.

## 1. Define the contracts and rules

Choose one stable lowercase game ID. Add it to `GameTypeId`,
`KNOWN_GAME_TYPES`, `GAME_INSTRUCTIONS` and the action definitions in
`packages/game-catalog/src/index.ts`. Define each action's fields, valid ranges,
aliases and legal phases. Add the game to series contracts where those enumerate
game IDs. Check the enabled-game list and route helpers in the same package.

Define authoritative state and projected view types in
`apps/workers/src/durable-objects/types.ts` and browser contracts under
`apps/web/src/domain`. Keep private state separate from a player's projection.

## 2. Implement a server room

Create `YourGameRoom.ts` extending `BaseGameRoom` with a typed state. Implement
the required lifecycle methods by following ReversiRoom or Connect4Room.
The shared base supplies seats, host actions, timers, reconnection, persistence,
terminal delivery, replay capture, archives, and room cleanup.

Validate every action, including actor, phase, coordinates, inventory and legal
moves. Use the server's secure randomness helpers in `lib/csprng.ts`.
Choose and test the game's timeout rule. All results must come from server state.

Produce separate views for the acting player, opponents, agents and spectators.
Hidden cards, boards, teams and pending choices must stay private until allowed
by the rules. Finished browser replay may reveal information through the shared
terminal pipeline; live projections and MCP responses must remain restricted.

## 3. Register routing and storage

| File | Change |
| --- | --- |
| `apps/workers/src/index.ts` | Export the Durable Object class |
| `apps/workers/src/types.ts` | Add its namespace binding to `Env` |
| `apps/workers/src/lib/roomRouting.ts` | Map the game ID to the namespace |
| `apps/workers/wrangler.json` | Add the binding and append a SQLite class migration |
| `apps/workers/wrangler-prod.example.json` | Add the same binding and migration |
| `apps/workers/src/durable-objects/BaseGameRoom.ts` | Review explicit game branches for projection, rewatch, Jev and shared behavior |
| `apps/workers/src/lib/activeRooms.ts` | Review public room-directory and game-type contracts |
| `apps/workers/migrations` | Append a migration if SQL CHECK constraints enumerate game types |

Do not rewrite applied D1 or Durable Object migrations. For example, append
`v2` with `new_sqlite_classes: ["YourGameRoom"]` to the supplied clean DO
lineage. Existing tables such as active rooms and series tables may restrict
game IDs. Search all migration constraints before adding a new type.

## 4. Add agent support

Implement a compact, recipient-safe decision view in
`packages/game-catalog/src/agent-state.ts`. Include legal actions and the
information needed to select one. Use Battleship's separate compact-state
module as a reference for larger projections.

Register progressive action schemas in the game catalog. Agents should discover
them through `list_game_tools` and `get_tool_schema`, then act with `send_action`.
Do not add a separate MCP tool for every game action. Test both rich `get_state`
and compact `wait_for_turn` projections, including terminal responses.

Jev support is optional. The new game must work for humans and external MCP
agents without a hosted model or secret. If you add Jev, wire its allowed
decision format and budget handling under `apps/workers/src/agents`.

## 5. Add the browser board

Add the game to `apps/web/src/interface/catalog.ts` and its rules to
`gameRules.ts`. Add a renderer under `apps/web/src/game-ui` and select it in
`GameBoard.tsx`. Use server-provided legal moves and send intents through the
shared socket client. Do not calculate authoritative outcomes in the browser.

Review `GameMark.tsx`, `GameScene.tsx`, room/lobby player limits, final-result
copy, replay components, social metadata and static route generation. Add
mobile layouts and the main site's in-room spectator view.

Search existing integrations to find the remaining typed registries:

```sh
rg -n 'reversi|REVERSI_ROOM|ReversiRoom' apps packages
rg -n 'CHECK|game_type|gameType' apps/workers/migrations
```

## 6. Verify it

Cover legal and illegal actions, rules and wins, turn and match timeouts,
reconnect after persisted state, spectator projection, sealed choices,
terminal delivery and replay sanitation. Use the existing faithful room
runtime and storage fixtures under `apps/workers/src/tests/fixtures`.

Add browser tests for a two-seat game, mobile board, agent turn, and finished
replay. Games with concurrent decisions need tests for both pending seats.
Then run:

```sh
pnpm generate:ai-spec
pnpm lint
pnpm test
pnpm build:all
```

`generate:ai-spec` rebuilds the public examples from offline fictional fixtures.
Add a representative fixture to its inputs when adding a game. The generated
public specification must contain no real credentials or private opponent data.

Submit your rules, registrations, schema migration, board, tests and asset
licenses in one focused pull request.
