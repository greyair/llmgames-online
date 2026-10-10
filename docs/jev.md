# Hosted Jev player

Private Connect 4, Pokémon, Reversi, Checkers, Battleship, Poker, and Contexto lobbies let the host add or remove one Jev
player. It occupies a regular player seat. The server enforces the game allowlist,
host permission, lobby-only changes, capacity, and one Jev across players and
spectators. Jev cannot inherit host ownership. Other games do
not offer this control.

The room's durable alarm dispatches one decision to the hosted adapter in
`apps/workers/src/agents/jev.ts`. The adapter sends the existing compact agent
projection to TypeSafe's remote `jev-latest` model, then maps the returned Choice
to an exact server-generated intent. Normal game validation applies. It does not
run an MCP polling loop or require a user's browser to remain open.

Connect 4 options are the open columns. Reversi uses the server's legal placements. Checkers uses the legal source and destination pairs, including forced jump continuations.
Battleship offers six valid, randomly generated fleet layouts, persisted with the
seat so a restart preserves the same choices. During battle it offers all legal
cannon targets, bomb zones, radar centers, mine locations, and inward torpedo paths
that can reach an unattacked cell before a known hit. TypeSafe limits each Choice
to 255 options, so battle requests ask for a weapon and independently ask for a
target for each available weapon in the same call. Only the selected weapon's
target is submitted. Its own radar observations are retained for future decisions.
MCP and Jev share the same compact seat projection. `ownGrid` includes own ships,
armed mines and incoming hits or misses; `targetGrid` contains only known enemy
hits and misses. Shape IDs and offsets appear once, without display names or
duplicate fleet-status records. Both remaining clocks are included in milliseconds;
clock ticks alone do not invalidate a pending answer. Opponent unhit ship positions
and armed mines remain hidden. Fleet candidates are structured objects, not JSON strings.
Both projections include `fleetFormat` beside the shapes. It defines row and
column offsets, the downward row and rightward column axes, the fixed placement
anchor, and all four clockwise rotation formulas. Rotated shapes are never
shifted to a new origin.

Poker sends Jev its private hole cards, the public board, position, pot, stack and
recent action history. It offers only server-legal fold, check, call, all-in and
next-hand actions. Bets and raise-to totals follow the table's 10-chip house rule.
At ordinary stack sizes Jev sees every legal total. If a long-running table grows
beyond TypeSafe's 255-option Choice limit, the adapter keeps the minimum and maximum
non-all-in totals, common pot-relative sizes, and an even spread of legal totals.
The exact all-in action remains separate.

Pokémon options include every enabled
move and legal switch from the seat's decision. Only revealed opponent Pokémon
are sent to TypeSafe. Opponent choices remain sealed. Raw battle snapshots,
billing owner IDs, room codes, API keys, and private opponent teams are excluded
from model inputs. The TypeSafe credential is never sent to a browser, saved in
rewatches, or logged.

## Local setup

Store `TYPESAFE_API_KEY` in the ignored `apps/workers/.dev.vars` file, then run:

```sh
pnpm --filter @llmgames/workers db:migrate
pnpm --filter @llmgames/workers dev
pnpm --filter @llmgames/web dev
```

The supplied key has been configured locally. Production deployment is a separate
step: provision `TYPESAFE_API_KEY` with Wrangler secrets, apply migration
`0038_jev_usage.sql`, and deploy the Worker and frontend together. Do not put a
credential in Wrangler `vars`, source files, or frontend environment variables.

## Limits and failures

### Personal TypeSafe connections

Profile settings supports an optional personal TypeSafe API key. Adding Jev pins
the host owner's current credential ID to that seat. A sponsored lobby seat also
adopts a credential connected before the match starts. Personal requests use that
key and do not consume sponsored quotas. Existing sponsored seats stay sponsored;
connect the key before adding Jev. Removing or replacing a key stops future calls
for seats using the old credential. Already submitted calls may still complete.
There is no automatic fallback to the site's key.

Keys are validated against TypeSafe's fixed `/v1/models` endpoint, then encrypted
with AES-256-GCM and a random 96-bit nonce. Authenticated associated data binds
each ciphertext to its owner, credential ID, and encryption version. Only the
request adapter decrypts credentials. D1 stores ciphertext; room storage contains
only a credential ID. API responses expose metadata, never keys or ciphertext.
Management requires a browser session, checks write origins, limits request size,
and rate-limits validation. Responses are not cached. Provider redirects are disabled.

Apply migration `0039_jev_credentials.sql` before releasing the Worker. Provision
the dedicated Worker secret `JEV_CREDENTIAL_KEYS` as a JSON object mapping `v1`
to a base64-encoded, cryptographically random 32-byte key. Never commit this value
or reuse `ENCRYPTION_SECRET`. `JEV_CREDENTIAL_KEY_VERSION` selects the write
version, defaulting to `v1`. For rotation, retain old versions until their saved
credentials have been replaced or re-encrypted. Without a valid keyring, new
connections fail closed and Profile shows them as unavailable. Local development
uses the same secret in the ignored `.dev.vars` file. Production provisioning and
deployment are separate from the local implementation.

Personal accounts choose a daily request cap from 1 to 100,000, default 10,000.
An atomic reservation checks credential identity and the cap before each request,
including retries and Contexto batches. Usage survives key replacement or
deletion and resets at midnight UTC. Rooms retain a 2,000-request runaway cap.
These caps measure requests, not spend; TypeSafe balance and rate limits apply.
The settings form explains billing and projected game data sharing and requires
consent before saving. No live customer keys are used by the test suite.

### Sponsored seats

Each account gets one sponsored Jev match. The trial is claimed atomically when
the match starts, so adding or removing Jev in a lobby does not consume it. A
connected personal TypeSafe credential is used instead and does not consume the
trial. Existing global and per-room request limits remain as runaway-cost safeguards.

Defaults are 1,000 API attempts per UTC day globally, 200 per host account per UTC
day, and 200 per room. Optional Worker variables `JEV_DAILY_CALL_LIMIT` and
`JEV_USER_DAILY_CALL_LIMIT` override the daily limits; zero disables calls.
Invalid limits fail closed. An atomic D1 reservation checks both daily limits
before each request, including retries. Host billing identity is captured when
Jev joins. Removing and re-adding Jev does not reset daily usage.

Requests are limited to 30,000 UTF-8 bytes, or 60,000 for Contexto group batches, and time out after 12 seconds per request. Transient
errors may retry once after two seconds. Persisted attempts survive room restarts.
A reply is discarded if the decision or room changed while it was pending. Limits
and provider failures are visible to connected players. There is no substitute
strategy on failure: normal game timeout rules apply.

These are request and payload limits, not a dollar-denominated billing cap.
Provider prices can change. Tune the daily limits to the account's budget.
The `jev_usage` table contains reservation IDs, UTC dates, and private host IDs;
it contains no prompts, responses, or credentials. Older days can be pruned with
`DELETE FROM jev_usage WHERE day < date('now', '-7 days')` without affecting limits.

## Verification

Worker tests cover actual game-room decisions, admission races, removal, privacy,
sealed Pokémon choices, Reversi flips, fleet placement, every naval weapon,
radar history, stale replies, restart/retry bounds, and SQL quota caps.
Browser tests in `apps/web/e2e/jev.spec.ts` cover all six games at desktop and mobile
sizes using mocked transport, including exact add/remove intents and failure UI.
Live API smoke checks are separate from those deterministic tests.

Poker live smoke check, 2026-09-18: a preflop small-blind decision with ace-king
suited offered 101 exact legal actions. Jev selected `call` in 1.24 seconds, and
the returned action matched one of the supplied server-generated options. This
checks the request and response path; it is not a poker-strength benchmark.

## Contexto

Each decision considers all 9,354 canonical dictionary words except previously guessed
words. Reviewed aliases resolve to those canonical words and never occupy their own
rank. Jev receives only its own word/rank history. The adapter never sends the
secret, ranking table, embeddings, target shortlist, or opponents' words.

Words are grouped into at most 255 candidates per Choice question, yielding 37
questions initially. Independent group questions are packed below 58,000 UTF-8
bytes per request; state plus any individual question stays below 28,000 bytes.
These conservative byte ceilings leave headroom under the published 64k total and
32k state-plus-question token budgets. Jev nominates one word per group, then a
separate request selects among the nominees. Group probabilities are never compared
against one another. The current dictionary uses three concurrent group requests followed by one
final request per guess. Quota reservations remain sequential. All in-flight
group requests settle before a failure can trigger a retry. Every request reserves quota and checks that the decision
is still current. A quota failure midway through selection submits no guess.

The existing 200-request room/host limits accommodate 50 four-request guesses when
no quota was previously used and no retries occur. Existing usage or retries can
stop Jev earlier; the visible play-limit status explains this. Selection quality
is heuristic: covering all words does not guarantee finding the hidden word.

Live smoke check, 2026-09-18: two separate projected decisions used four requests
and about 73,000 input tokens each. An opening selected `thing` in 8.5 seconds.
Given `animal` rank 8, `cat` rank 3, `car` rank 158, and `pet` rank 4, Jev selected
`dog` in 4.2 seconds, the test target at rank 1. The target and rank table were used
only by the local evaluator and were absent from provider requests. These two
samples verify the workflow, not a win-rate benchmark. At the published $0.042 per
million input tokens, the samples cost about $0.0031 per guess, or $0.15 for 50
similar guesses. Actual usage, retries, and future pricing can change that cost.

Parallel-batch smoke check, 2026-09-18: three independent samples took 4.60 seconds
for the opening, then 2.56 and 1.28 seconds for the same warm-history fixture.
Each reached three concurrent group requests and used four requests total, about
73,000 input tokens. The warm-history samples both selected `dog`. These are
observed samples rather than a latency guarantee or a controlled speed benchmark.

Credential creation, replacement and deletion now require a browser login from the last 15 minutes. Profile offers **Sign in again** when needed. Browser logout revokes the stored session, with a separate Profile action for all browsers. Deploy this behavior only after applying `0048_revocable_web_sessions.sql`; existing browser sessions will need to sign in again. Browser sessions have an absolute seven-day lifetime. MCP OAuth connections are unaffected by browser logout.
