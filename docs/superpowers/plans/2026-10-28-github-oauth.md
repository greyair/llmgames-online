# GitHub OAuth Implementation Plan

**Goal:** Add optional GitHub sign-in for this instance while retaining Google, Turnstile, and MCP OAuth.

**Architecture:** Use server-side GitHub OAuth with provider-bound state and verified primary email. Store immutable GitHub user IDs in a dedicated identity table. Reject email collisions with existing accounts; guard Google from implicitly adopting GitHub-only accounts. Preserve same-origin return destinations and existing sessions.

**Status:** Implemented in `e3894a0` (2026-10-28). Tasks 1–4 verified on 2026-10-30 against the current tree; task 5 still needs a real OAuth App and a live authorization round-trip.

**Tasks:**
- [x] Add failing tests for OAuth state, verified email, collisions, identity stability, and MCP return paths. — `apps/workers/src/tests/auth/github.test.ts`: signed provider-bound state, duplicate/missing state cookies, verified primary email only, unverified email rejection, email-collision refusal, stable GitHub ID reuse, Google cannot adopt a GitHub account, and MCP `returnTo` preserved after a denied authorization.
- [x] Implement migration, Worker routes and safe account creation, then run focused tests. — `migrations/0053_github_identities.sql` (`github_id` primary key, `user_id` unique FK), `auth/github.ts` (state cookie + token exchange + `/user/emails` verification), `auth/routes.ts` wiring, `auth/email.ts` collision guard.
- [x] Add a Turnstile-gated GitHub button and configuration documentation. — `interface/Account.tsx` routes the GitHub button through the same `submit()` path as Google, so both require the Turnstile token; `docs/environment.md` lists `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, `docs/deployment.md` documents the OAuth App callback URL and migration order.
- [x] Run migrations locally, security tests, type checks, build, and review before production deployment. — `pnpm db:migrate` reports no pending migrations (0053 applied), `pnpm test` 604 Worker + 336 web tests green, `tsc -p tsconfig.json` clean for web and workers, `pnpm build` completes (web + workers tasks, then `scripts/copy-web-dist.mjs`).
- [ ] Configure GitHub OAuth App credentials and test a real authorization flow before declaring completion. — Needs a registered OAuth App and production secrets; no authorization round-trip has been performed against a real GitHub account yet. Nothing in CI can close this item.
