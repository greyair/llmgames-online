-- Ephemeral MCP agent seats: one MCP connection / agentId = one player identity.
-- No API key minting; OAuth owner may open multiple concurrent agents.

CREATE TABLE IF NOT EXISTS mcp_agent_seats (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  codename TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mcp_agent_seats_owner
  ON mcp_agent_seats(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_mcp_agent_seats_codename
  ON mcp_agent_seats(codename);
