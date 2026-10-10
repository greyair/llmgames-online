# Code practices

LLM Games vendors [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at `tools/oxlint/anti-slop`. The source revision is `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`. `UPSTREAM.md` records provenance; the upstream README and licenses remain with the source.

All 18 generic rules and `oxc/no-accumulating-spread` run as errors. Effect rules are available in the copied source but are not registered because no workspace declares Effect. The rule implementation has no local changes. Build output, generated Showdown code, installed agent assets, and third-party vendor files are excluded. Owned adapters, generators, application code, and tests are checked.

## Boundaries and state

Decode request bodies, socket messages, storage documents, and provider responses with their domain schema before reading fields. `jsonValueSchema` describes JSON tool input. `WireValue` also supports JavaScript's undefined value for optional in-process fields; it must not be used as a JSON Schema tool contract.

Keep precise types inferred. Use `satisfies` to verify a declared contract without discarding known keys. Use a named contract for mutable objects with optional fields, then assign a field when it belongs in the result. Preserve the difference between an omitted field and a present field whose value is undefined.

Assertions must explain a checked invariant in a nearby `SAFETY:` comment. Do not add an assertion through unknown or a broad dictionary to bypass the contract. JSON values and opaque SDK values require parsing at their own boundary.

The browser validates projected game state while retaining the original validated frame. This preserves new nested public replay fields. The server still owns rules, random outcomes, seats, hidden information, and permission decisions. A parser cannot make authoritative or private state safe to publish; project state for the recipient first.

## Test dependencies

Tests use the actual router or game class and dependencies implementing its interfaces. `RoomRuntime` describes the persistence and socket operations used by rooms. Fixtures provide memory storage, sockets with attachments, real SQLite through D1's interface, and an R2 implementation.

Use `testEnv` when every used service is configured explicitly; an unconfigured service throws. Use `roomTestEnv` when a room test needs real local archive storage and indexing. HTTP fetch adapters bridge Node and Workers DOM declarations and reject unsupported WebSocket upgrades.

Do not replace a module or construct a prototype object to bypass its constructor and types. Keep fixture payloads representative of actual server projections. Shortened fixture data must still satisfy the fields needed by the behavior under test.

## Checks

- `pnpm lint:anti-slop` checks all owned JavaScript and TypeScript.
- `pnpm lint:anti-slop:fix` applies the upstream spacing fix.
- `pnpm format:code` formats owned code; `pnpm format:code:check` checks formatting.
- `pnpm lint` also runs existing workspace lint, strict type checks, and AI-spec verification.
- Worker lint checks test types and separately rejects unused production declarations.
- The web build verifies that generated pages and preload maps reference existing assets.
- Run the relevant game, protocol, privacy, UI, or archive tests for behavioral changes. The migration uses offline tests and documentation export.

After cleanup, a second spacing and formatting pass must leave the code unchanged. Keep vendored rules and their provenance intact when updating upstream.
