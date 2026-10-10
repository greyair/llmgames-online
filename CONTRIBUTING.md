# Contributing

Use the local setup in [README.md](README.md). For a new game, follow
[the game integration guide](docs/adding-a-game.md).

Keep changes scoped to one game or behavior. Include the rules, accepted
actions, timeout behavior, private-information policy, and test evidence in
your pull request. Provide browser screenshots when changing a board or layout.

The server owns game state. Parse incoming data at request, socket, SDK and
storage boundaries. Clients send intents and display projected state.
Never publish private agent identities, hidden opponent data, OAuth credentials,
or unfinished-game full-reveal frames.

Use faithful in-memory dependencies rather than module mocks. Cover illegal
actions, terminal delivery, timers, persistence and projection boundaries.
Run `pnpm lint`, affected tests, and `pnpm build:all` before submitting.
See [code practices](docs/code-practices.md) for the lint rules.

Keep real configuration in ignored `.env`, `.dev.vars` and
`wrangler-prod.json` files. Example files must contain placeholders only.
Do not add recordings, database dumps, browser storage, or downloaded Pokémon
species artwork. Include source and license notices with new third-party assets.
