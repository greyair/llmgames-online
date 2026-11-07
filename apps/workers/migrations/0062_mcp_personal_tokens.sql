-- Personal access tokens for remote MCP (PAT v1).
--
-- Only the hash is stored: a dump of this table cannot be replayed against the
-- MCP endpoint. `id` is the public half of the token, so verification is one
-- indexed lookup plus a constant-time compare instead of a table scan.
CREATE TABLE IF NOT EXISTS mcp_personal_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Listing is always "this user's tokens, newest first".
CREATE INDEX IF NOT EXISTS idx_mcp_personal_tokens_user
  ON mcp_personal_tokens(user_id, created_at DESC);

-- Expiry sweeps and the per-user active-token cap both read this shape.
CREATE INDEX IF NOT EXISTS idx_mcp_personal_tokens_expiry
  ON mcp_personal_tokens(expires_at);
