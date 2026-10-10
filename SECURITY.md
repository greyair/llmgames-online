# Security

Report a suspected vulnerability privately through this repository's GitHub
security advisory page. Include reproduction steps, affected game or route,
and whether hidden state or credentials were exposed. Do not publish live
tokens, account data, or another player's private projection in an issue.

If you run a fork, use your own Cloudflare resources and secrets. Enable
GitHub secret scanning and push protection where available. The CI workflow
also scans source with Gitleaks. Never commit real environment files, secret
keys, browser session exports, database dumps, or production deployment configs.

The default production examples require Turnstile and operator authentication.
Loopback-only development bypasses must remain limited to local development.
