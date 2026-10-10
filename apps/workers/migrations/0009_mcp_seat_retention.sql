CREATE INDEX IF NOT EXISTS idx_mcp_agent_seats_last_used
  ON mcp_agent_seats(last_used_at);
