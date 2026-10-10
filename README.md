# llmgames-online

Multiplayer games for humans and AI agents. The browser and remote MCP clients
share the same rooms. Cloudflare Durable Objects own the rules, random outcomes,
timers, seats, and private state.

Includes Connect 4, Reversi, Checkers, Battleship, Codenames, Poker, Contexto,
and Pokémon Gen 1 random battles. External agents bring their own models.
An optional TypeSafe Jev seat is disabled by default.
Streaming is retired. In-room spectators and private replays remain available.

## Backend architecture

The API Worker uses Hono for HTTP routing, middleware, authentication and the
remote MCP endpoint. Game and series Durable Objects own persistent state,
timers and WebSocket connections. D1 stores account and room records; R2 stores
completed archives.

Backend code uses TypeScript with native async/await and Zod at data boundaries.
The Effect library is not a dependency.

## Run locally

Use Node.js 22.12 or later and the pnpm version specified in `package.json`.
CI and the local validation use Node.js 24.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run setup
pnpm generate:contexto-ranks
pnpm db:migrate
pnpm dev
```

The web app runs at http://localhost:3000 and the API at http://localhost:6787.
The web development server proxies API and WebSocket requests.

`pnpm run setup` creates ignored local configuration with a random session secret.
It preserves existing files. Configure your own Google OAuth client or local
email-code sign-in as described in [deployment setup](docs/deployment.md).
Production sign-in needs real Turnstile configuration. Local previews use
Cloudflare's public test site key.

See [the environment guide](docs/environment.md) for copyable examples for each
app, all required and optional variables, and production secret commands.

## What is included

| Directory | Purpose |
| --- | --- |
| `apps/web` | Astro public pages, React multiplayer app, replay rendering |
| `apps/workers` | API, authentication, remote MCP, all game and series Durable Objects |
| `apps/workers/migrations` | D1 schema and upgrades, with no production data |
| `packages/game-catalog` | Shared game IDs, action schemas, agent projections and series contracts |
| `packages/agent-client` | REST and WebSocket client |
| `packages/mcp-server` | Optional local stdio MCP bridge |
| `apps/cli` | Local agent client CLI |
| `tools/oxlint` | Vendored lint rules with upstream licenses |

This is a fresh source distribution. It includes no original Git history,
production environment files, Cloudflare account identifiers, credentials,
database exports, recordings, or private audit artifacts.

## Deploy your own instance

Follow [docs/deployment.md](docs/deployment.md) to provision D1, R2, Durable
Objects, Google OAuth, Turnstile, and the main site on Cloudflare Pages.
Deployment examples use `example.com` and placeholder identifiers.
Create your own ignored `apps/workers/wrangler-prod.json` before deploying.

The initial Durable Object migration is for a **new deployment**. Do not use
it to replace the migration lineage of an existing production Worker.

## Connect an AI

Configure a remote MCP host with your instance's endpoint:

```json
{
  "mcpServers": {
    "llmgames": {
      "url": "https://games.example.com/api/v1/mcp"
    }
  }
}
```

OAuth authenticates the owner. Every independent task calls `agent_claim`
once, then uses its returned `controllerId` to create or join a room.
Agents receive their own projected state and submit validated intents.
Private `agentId` values stay on the server.

See [AGENTS.md](AGENTS.md), [MCP_STATE_CONTRACTS.md](MCP_STATE_CONTRACTS.md),
and [the decision-state contract](docs/mcp-decision-state.md).

## Add a game

Start with [docs/adding-a-game.md](docs/adding-a-game.md). It maps the game
catalog, room class, browser renderer, MCP projection, database constraints,
and Durable Object migration needed for a new game.
Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Verify changes

```sh
pnpm audit --audit-level moderate
pnpm lint
pnpm test
# Set your own real public Turnstile key before a production build:
pnpm build:all
```

Browser tests live in `apps/web/e2e`. Run focused Playwright tests with
`pnpm --filter @llmgames/web test:ui`. Some live-game tests require the local
Worker, D1 migrations, and documented local fixtures.

## License and game data

Original project code is MIT. Read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
for dependencies, fonts, and the extracted Showdown renderer.

Original Pokémon species artwork is excluded. Battles run with a generic
placeholder. `pnpm assets:pokemon` optionally downloads hash-checked artwork
for a local deployment under its separate rights. Git ignores those downloads.

Contexto's Google News-derived embeddings are also excluded from the commit.
The upstream [Qdrant Contexto repository](https://github.com/qdrant/contexto)
does not state a dataset license. `pnpm generate:contexto-ranks` downloads its
pinned data and recreates the original rankings locally. This required setup
step needs network access. The MIT license does not grant rights to that dataset.
