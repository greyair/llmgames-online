-- Agent API keys (Bearer tokens for bots / local agent processes)
-- Bearer tokens for external agent seats (MCP / agent-client / CLI).

ALTER TABLE users ADD COLUMN user_type TEXT NOT NULL DEFAULT 'human';
-- user_type: 'human' | 'agent'

CREATE TABLE IF NOT EXISTS agent_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'default',
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER DEFAULT (unixepoch()),
  last_used_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_keys_user_id ON agent_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_keys_prefix ON agent_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_users_type ON users(user_type);
