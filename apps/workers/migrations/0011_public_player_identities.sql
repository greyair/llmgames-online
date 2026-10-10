-- Public multiplayer identity: a user-owned gamertag plus the MCP environment
-- that created each ephemeral agent seat.
ALTER TABLE users ADD COLUMN gamertag TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_gamertag_nocase
  ON users(lower(gamertag))
  WHERE gamertag IS NOT NULL;

ALTER TABLE mcp_agent_seats ADD COLUMN client_id TEXT;
ALTER TABLE mcp_agent_seats ADD COLUMN environment_label TEXT NOT NULL DEFAULT 'MCP Agent';

CREATE INDEX IF NOT EXISTS idx_mcp_agent_seats_client
  ON mcp_agent_seats(client_id);
