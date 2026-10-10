-- MCP callers receive a short-lived controller handle. The server assigns the
-- underlying persistent agent identity and never exposes agent_id to the host.

CREATE TABLE IF NOT EXISTS mcp_agent_controllers (
  controller_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL UNIQUE,
  client_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES mcp_agent_seats(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mcp_agent_controllers_owner
  ON mcp_agent_controllers(owner_user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_mcp_agent_controllers_expiry
  ON mcp_agent_controllers(expires_at);
