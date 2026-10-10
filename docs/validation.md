# Source distribution validation

Validated locally on October 10, 2026 with Node.js 24 and pnpm 11.21.0.

- A fresh source-only copy installed with `pnpm install --frozen-lockfile`.
- A dependency audit including development tooling reported zero advisories
  after updating the ESLint dependency `brace-expansion` to 1.1.21.
- Local setup generated ignored secrets without overwriting existing files.
- All D1 migrations applied to an empty local database.
- The pinned Contexto generator recreated data identical to the original
  vocabulary, targets, norms and quantized embeddings.
- `pnpm lint` passed, including anti-slop, workspace checks, strict type checks
  and the offline AI specification comparison.
  Production Worker compilation also rejects unused locals and parameters.
  The formatting check passed and is now required by CI.
- The current unit suites passed 884 tests across the Worker, web,
  agent client and local MCP bridge.
  Worker test concurrency is limited to two workers. An unbounded local run
  hit three five-second test timeouts; the current 546 Worker tests passed at this limit.
- All six workspace builds passed. Worker builds used Wrangler dry-run;
  the web build used a synthetic public Turnstile value for compilation only.
- The earlier frontend pass covered 206 development browser cases for account pages,
  navigation, rooms, all game boards, final animations, replay and layout.
  Six initial failures passed on retry after completing configuration changes
  and removing an optional-artwork assumption. A separate real Worker-backed
  two-human series test passed seat continuity and archived results after purge.
- Thirteen checks against the compiled site passed sign-in, Checkers lifecycle
  and final screens for all eight games, including desktop/mobile accessibility.
- A real local Worker-backed Checkers match passed create, join, spectate,
  reconnect, completion and replay checks through browser WebSockets.
- The current sync passed 40 isolated development browser checks for account
  flows, public metadata, the retired watch page and Connect AI layout across
  six viewport widths in light and dark themes. Seventeen compiled-site
  checks also passed account flows, the retired watch page and Connect AI;
  the compiled instructions used the configured instance origin.
- Gitleaks 8.30.1 found no secrets in the staged source distribution. A separate
  comparison found no original credential or deployment identifier values.

The source distribution excludes the original Git history, real environment
files, deployment configs, database contents, browser sessions, recordings,
private audit output, proprietary species artwork and third-party embeddings.
Ignored local files generated during validation are not part of the commit.

## Frontend loading

Pages and game boards load their JavaScript on demand. A fresh local compiled
`/login` load fetched 504,186 uncompressed JavaScript bytes, compared with
887,392 before the cleanup, a reduction of 43%. Both checks used Chromium,
empty browser caches, the same mocked unauthenticated API response and a
stubbed Turnstile script. This measures downloaded code, not production latency.
The final login check fetched no room or game-board chunks and had no page errors.

CSS stays in a shared stylesheet because Astro's rendered React components and
lazy imports otherwise produced missing CSS preload URLs in this build.
The web build now checks referenced JavaScript and CSS assets. Its guard was
verified against a missing preload stylesheet and complete output.

These checks do not establish production deployment, real OAuth registration,
email inbox delivery, or custom-domain configuration on another account.
