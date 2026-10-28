# Deployment

This repository deploys to your own Cloudflare account. It requires the main
Pages site and API Worker, with D1, R2 and all game Durable Object bindings.
No production credentials are included.

Use [the environment guide](environment.md) to choose the right example file
and see the complete variable checklist for each app.

## Local development

Run `pnpm install --frozen-lockfile`, `pnpm run setup`, `pnpm generate:contexto-ranks`, `pnpm db:migrate`, and
`pnpm dev`. The configuration uses a new local D1 database and local R2 storage.
No local binding points to the original deployment.

For Google sign-in, create a Google OAuth web client. Set `GOOGLE_CLIENT_ID`
in `apps/workers/wrangler.json` and `GOOGLE_CLIENT_SECRET` in the ignored
`apps/workers/.dev.vars`. Register this redirect URI:

```text
http://localhost:6787/api/v1/auth/oauth/google/callback
```

Email-code sign-in uses Wrangler's simulated Email Sending binding locally.
The terminal or local email simulator exposes the message instead of sending
real mail. Set `EMAIL_FROM` and `allowed_sender_addresses` to the same address.

Local Turnstile verification can be omitted only for loopback requests.
The frontend uses Cloudflare's public test key. Production fails closed when
server verification is missing. See [Cloudflare's test-key documentation](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).

Contexto needs the generated, ignored `contextoRanks.json` before lint, tests or
Worker builds. Its upstream embedding dataset has no stated license in the
source repository. Review its separate usage rights for your deployment; the
project MIT license covers the game code, not those embeddings. The generator
pins the upstream revision and uses the original quantization algorithm.

## Provision a new production instance

Authenticate Wrangler, then provision your own resources:

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create llmgames-online-db
pnpm exec wrangler r2 bucket create llmgames-online-game-logs
cp apps/workers/wrangler-prod.example.json apps/workers/wrangler-prod.json
```

Put the returned D1 identifier in `apps/workers/wrangler-prod.json`. Replace
the example domain, routes, frontend origin, Google client ID, email sender and
Turnstile site key with your own. The public repository deploys only the main
site and API Worker.

The `GAME_LOGS` R2 bucket stores completed game and series archives.
The initial SQLite Durable Object migration provisions every game class and
`GameSeries`. Keep those exports and bindings intact. This clean migration
lineage is intended only for a new Worker. D1 retains its complete schema
migration sequence because later migrations depend on earlier tables.
See [Cloudflare's Durable Object migration documentation](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

Set secrets through Wrangler. Commands prompt for each secret:

```sh
cd apps/workers
pnpm exec wrangler secret put ENCRYPTION_SECRET --config wrangler-prod.json
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler-prod.json
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY --config wrangler-prod.json
cd ../..
pnpm db:migrate:prod
pnpm deploy:workers
```

Use a fresh random secret of at least 32 bytes for `ENCRYPTION_SECRET`.
For Google, register `https://games.example.com/api/v1/auth/oauth/google/callback`,
substituting your domain. Add your frontend host to the Turnstile widget.

For real email codes, onboard your sender domain in Cloudflare Email Sending.
The `EMAIL` binding and `EMAIL_FROM` must use an allowed sender. An inbound
Email Routing destination alone does not enable outgoing messages.
See [Cloudflare Email Sending setup](https://developers.cloudflare.com/email-service/get-started/send-emails/).

## Build and deploy the main site

```sh
cp apps/web/.env.production.example apps/web/.env.production
# Edit PUBLIC_SITE_URL and VITE_TURNSTILE_SITE_KEY in the ignored file.
pnpm exec wrangler pages project create llmgames-online --production-branch main
pnpm deploy:web
```

Attach your custom frontend domain to Pages. The API Worker's routes must
intercept `/api/v1/*` and `/.well-known/*` on that same domain. Browser clients
use same-origin cookies and WebSockets. A standalone pages.dev frontend paired
with an unrelated workers.dev API is not this deployment topology.

`PUBLIC_SITE_URL` controls canonical metadata, the sitemap, robots.txt and
llms.txt. The production build requires a real public Turnstile site key.
Only public build configuration belongs in frontend environment variables.

## Optional integrations

Jev is disabled by the zero daily limits in the examples. Follow
[docs/jev.md](jev.md) to enable it with your own server TypeSafe key, budgets,
and independent credential-encryption keys. Webhook credential storage also
needs `JEV_CREDENTIAL_KEYS`; keep it separate from the session secret.

Streaming is retired. New and restored rooms deny broadcast permission.
The legacy operator binding returns an empty directory and rejects board,
socket and feature-report requests. In-room spectators and private replays
remain available.

Review `apps/web/src/interface/content/legal.json` for your operator's privacy
and terms copy. Do not treat the original project's copy as your own policy.

## Validate a deployment

Verify the main homepage, `/api/v1/mcp/info`, OAuth discovery, Google or email
sign-in, a two-browser game with WebSocket updates, and a completed replay.
Connect an MCP host, claim a task controller and play through an end state.
Verify R2 archives and account history. Test every enabled game, including
in-room spectator privacy.

Build and dry-run checks establish local compatibility. They do not prove
custom-domain routing, email delivery, OAuth registration, or production play.

## Optional GitHub sign-in

Register a GitHub OAuth App using the site URL and callback `https://YOUR_HOST/api/v1/auth/oauth/github/callback`. Set `GITHUB_CLIENT_ID` in the ignored Worker configuration and `GITHUB_CLIENT_SECRET` using Wrangler Secrets. Apply the D1 migration before deploying the Worker. GitHub requires a verified primary email. Accounts with an email already used by another sign-in method are not linked automatically.
