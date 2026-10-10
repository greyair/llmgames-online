# Environment configuration

The main web app and API Worker read their own configuration. The root `.env` is only for the optional
CLI or stdio MCP client. The web app does not load Worker secrets.

## Choose the right example

| Example | Where to put real values | Purpose |
| --- | --- | --- |
| `.env.example` | Root `.env` | Optional CLI / stdio MCP access token |
| `apps/web/.env.example` | `apps/web/.env.development` | Local public web configuration |
| `apps/web/.env.production.example` | `apps/web/.env.production` | Public production web configuration |
| `apps/workers/.env.example` | Wrangler `vars` | API public/runtime variable checklist |
| `apps/workers/.dev.vars.example` | `apps/workers/.dev.vars` | Local API secrets |

All real files above are ignored by Git. Example files contain placeholders,
empty values, or a public testing site key.

For the main site's local configuration, run `pnpm run setup`. It creates a
random `ENCRYPTION_SECRET` and public web defaults while preserving existing
files. Manual copies are an alternative, not a way to overwrite configured files.

For manual main-site setup, copy the examples without replacing existing files:

```sh
cp -n apps/web/.env.example apps/web/.env.development
cp -n apps/workers/.dev.vars.example apps/workers/.dev.vars
```

Replace the session-secret placeholder before starting the API. Use the
Worker variable checklist to edit local Wrangler vars for Google sign-in.

Wrangler loads local secrets from `.dev.vars` next to that app's config.
It excludes `.env` values when `.dev.vars` exists. Frontend Vite/Astro env files
are separate build inputs. See [Cloudflare's local env documentation](https://developers.cloudflare.com/workers/local-development/environment-variables/).

## Main web

| Variable | Required | Meaning |
| --- | --- | --- |
| `PUBLIC_SITE_URL` | Production | Absolute main-site URL for metadata, crawler files and shared links. Local default is `http://localhost:3000`. |
| `PUBLIC_MCP_URL` | Optional | Main web's MCP setup URL. Defaults to `PUBLIC_SITE_URL` plus `/api/v1/mcp`. Local setup uses `http://localhost:6787/api/v1/mcp`. |
| `VITE_TURNSTILE_SITE_KEY` | Main web production | Public Turnstile site key matching the API's verification secret. Local development uses Cloudflare's public test key. |

These variables are visible to browsers. The API is same-origin in production;
there is no separate browser `VITE_API_URL` setting. Development proxies requests
to the local Worker. Configure your main domain's Worker routes before deploying.

## API Worker

Put non-secret values in the `vars` object of `apps/workers/wrangler.json` for
local development or your ignored `wrangler-prod.json` for production.
`apps/workers/.env.example` lists these values without secrets.

| Variable | Where | Required / purpose |
| --- | --- | --- |
| `FRONTEND_URL` | Wrangler vars | Main site origin for authentication redirects and room links. |
| `ALLOWED_ORIGINS` | Wrangler vars | Optional comma-separated extra permitted browser origins. |
| `GOOGLE_CLIENT_ID` | Wrangler vars | Required for Google OAuth sign-in. |
| `TURNSTILE_SITE_KEY` | Wrangler vars | Public site-key configuration; use the same widget as the main web build. |
| `EMAIL_FROM` | Wrangler vars | Required for email-code sign-in; must match an allowed sender in the `EMAIL` binding. |
| `ENCRYPTION_SECRET` | Secret | Required for account sessions, MCP OAuth and email-code hashing. Generate a fresh random value. |
| `GOOGLE_CLIENT_SECRET` | Secret | Required for Google OAuth sign-in. |
| `TURNSTILE_SECRET_KEY` | Secret | Required for production sign-in verification. Omission works only on local loopback. |
| `TYPESAFE_API_KEY` | Secret | Optional site-funded Jev calls. Humans and external MCP agents do not need it. |
| `JEV_DAILY_CALL_LIMIT` | Wrangler vars | Global daily site-funded Jev budget. The examples set `0` to disable it. |
| `JEV_USER_DAILY_CALL_LIMIT` | Wrangler vars | Per-host daily site-funded Jev budget. Examples set `0`. Personal keys use their own account limits. |
| `JEV_CREDENTIAL_KEYS` | Secret | Optional version-to-key JSON map for personal Jev and authenticated webhook credentials. Each key decodes to exactly 32 bytes. |
| `JEV_CREDENTIAL_KEY_VERSION` | Wrangler vars | Version used to encrypt new credentials; defaults to `v1`. Keep old keys while their encrypted records still exist. |
| `TWITCH_CLIENT_ID` | Legacy only | Streaming is retired; the operator binding does not use this value. Leave unset. |
| `TWITCH_BROADCASTER_ID` | Legacy only | Streaming is retired; the operator binding does not use this value. Leave unset. |
| `TWITCH_CLIENT_SECRET` | Legacy only | Streaming is retired; the operator binding does not use this value. Leave unset. |

Generate separate keys for separate jobs:

```sh
# Session signing: generate an independent random value.
openssl rand -hex 32
# Credential encryption: use the output as the v1 value in the JSON key map.
openssl rand -base64 32
```

For production, provision secrets with Wrangler's prompts, not `vars` or
frontend files:

```sh
pnpm --filter @llmgames/workers exec wrangler secret put ENCRYPTION_SECRET --config wrangler-prod.json
pnpm --filter @llmgames/workers exec wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler-prod.json
pnpm --filter @llmgames/workers exec wrangler secret put TURNSTILE_SECRET_KEY --config wrangler-prod.json
```

Only set optional secrets for integrations you enable. See
[Cloudflare's secrets documentation](https://developers.cloudflare.com/workers/configuration/secrets/)
and [Jev configuration](jev.md).

## Optional CLI and stdio MCP

The root `.env.example` contains `LLMGAMES_API` and `LLMGAMES_ACCESS_TOKEN`.
Use an MCP OAuth access token from your own instance, not an API key or a
browser session cookie. Remote MCP hosts use their own OAuth flow and do not
need this file.

To load the optional root file explicitly with Node:

```sh
cp -n .env.example .env
# Fill in your MCP OAuth access token in the ignored .env.
pnpm --filter @llmgames/game-catalog --filter @llmgames/agent-client --filter @llmgames/cli --filter @llmgames/mcp-server build
node --env-file=.env apps/cli/dist/main.js --help
# For stdio MCP, launch this as your host's server command:
node --env-file=.env packages/mcp-server/dist/index.js
```

## Bindings and deployment credentials

D1 `DB`, R2 `GAME_LOGS`, game/series Durable Object namespaces
and `EMAIL` are Cloudflare bindings, not `.env` strings.
Configure them using each app's Wrangler deployment example.

Wrangler deployment authentication is also separate from app runtime secrets.
Use `pnpm exec wrangler login` interactively, or provide your own
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your deployment environment.
Do not put deployment credentials in browser env files or source control.

For resource provisioning, domains, Google redirect URIs and Email Sending,
continue with [deployment.md](deployment.md).
