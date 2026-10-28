# GitHub OAuth Implementation Plan

**Goal:** Add optional GitHub sign-in for this instance while retaining Google, Turnstile, and MCP OAuth.

**Architecture:** Use server-side GitHub OAuth with provider-bound state and verified primary email. Store immutable GitHub user IDs in a dedicated identity table. Reject email collisions with existing accounts; guard Google from implicitly adopting GitHub-only accounts. Preserve same-origin return destinations and existing sessions.

**Tasks:**
- [ ] Add failing tests for OAuth state, verified email, collisions, identity stability, and MCP return paths.
- [ ] Implement migration, Worker routes and safe account creation, then run focused tests.
- [ ] Add a Turnstile-gated GitHub button and configuration documentation.
- [ ] Run migrations locally, security tests, type checks, build, and review before production deployment.
- [ ] Configure GitHub OAuth App credentials and test a real authorization flow before declaring completion.
