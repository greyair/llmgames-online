# Checkers

Checkers is a two-player, server-authoritative American checkers game. The board,
legal moves, captures, kings, winner, and clocks belong to `CheckersRoom`.
The browser selects from the projected legal moves and sends an intent.

## Rules

Each side starts with twelve men on the dark squares of an 8 × 8 board. Seats
are assigned randomly. Seat 1 is black, moves first, and advances toward row 0.
Seat 2 is white and advances toward row 7. Men move and capture diagonally
forward. Kings move and capture in either direction, without flying.

Captures are mandatory. When several captures exist, the player may choose any
of them. Continue jumping with the same piece while a capture remains. Reaching
the far row crowns the piece and ends the turn immediately.

A player loses when they have no pieces or no legal move. The server automatically
draws on threefold repetition with the same side to move, or after 80 individual
turns without a capture or a man moving. These are the playable movement and
endgame rules from the [WCDF rules](https://wcdf.net/rules/rules_of_checkers_english.pdf).
Physical-board touch rules and referee procedures do not apply.

The configured turn clock covers the entire jump chain and does not reset between
jumps. Turn timeout forfeits the match. The shared match clock expiring is a draw.
These clock outcomes are llmgames rules.

## Browser, MCP, and Jev

- Play route: `/checkers`. Public rules: `/games/checkers`.
- MCP game type: `checkers`. The `draughts` alias normalizes to it.
- Action: `move_checker { fromRow, fromCol, row, col }`, zero-based coordinates.
- Use the current projection's `legalMoves`. Each move also describes its capture.
- `forcedPiece` identifies the piece that must continue a jump chain.
- Board values: `0` empty, `1` black man, `2` white man, `3` black king, `4` white king.
- `scores` counts remaining pieces. A king still counts as one piece.
- Spectators and replays cannot submit moves. Broadcast seats use anonymized IDs.
- Internal repetition history is persisted but omitted from player, agent,
  broadcast, and replay projections.
- Jev selects among the server's legal moves through the existing TypeSafe choice
  adapter. Each continuation is a separate decision under the same turn clock.

## Local verification

The implementation was checked with the full Worker suite, browser tests, a
production web build, and an isolated local Worker match using two authenticated
browser contexts and a spectator. The real match covered create, join, start,
reconnect, legal moves through completion, terminal delivery, and saved replay.
Browser checks cover desktop, portrait phone, landscape phone, light/dark themes,
keyboard input, forced continuation, disabled spectator controls, and axe checks.

The rule and room tests also exercise mandatory captures, backward king moves,
crowning, blocked-player wins, repetition, the quiet-move draw, turn timeout,
restoring a jump chain from storage, malformed intents, and Jev option generation.
The hosted TypeSafe service itself is not called by these tests.

Run deterministic tests:

```sh
pnpm --filter @llmgames/game-catalog build
pnpm --filter @llmgames/workers exec vitest run
pnpm --filter @llmgames/web exec playwright test e2e/checkers.spec.ts
```

For the real local multiplayer test, use the local API on port 6787 with
`ENCRYPTION_SECRET` configured in `apps/workers/.dev.vars`. Apply local migrations
and seed disposable accounts with server-backed session IDs. The seed command
writes its session file under `/tmp` with owner-only permissions. These commands
do not modify production data.

```sh
# Terminal 1
pnpm db:migrate
pnpm dev:workers

# Terminal 2. Playwright starts the web dev server if needed.
node apps/workers/scripts/seed-series-test-session.mjs --live
LLMGAMES_LIVE_TEST_SESSIONS=/tmp/llmgames-live-tests/sessions.json pnpm --filter @llmgames/web exec playwright test e2e/checkers-live.spec.ts --workers=1
```

The live test skips unless `LLMGAMES_LIVE_TEST_SESSIONS` is set. Run live tests
sequentially and finish builds before testing a directory served from built files.

## Release requirements

For a new deployment, follow [deployment.md](deployment.md). Apply the complete
D1 migration sequence, including `0042_checkers_active_rooms.sql`. Both supplied
Worker configurations register `CHECKERS_ROOM` in the initial `v1` SQLite
Durable Object migration. Deploy the API Worker and main site. Keep an existing
Worker's applied migration lineage when upgrading an established deployment.
