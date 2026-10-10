-- agentId is a private MCP seat credential. Game Durable Objects and projected
-- state use only a random, room-scoped public playerId.

CREATE TABLE IF NOT EXISTS mcp_room_players (
  room_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  player_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (room_id, agent_id),
  FOREIGN KEY (agent_id) REFERENCES mcp_agent_seats(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mcp_room_players_agent
  ON mcp_room_players(agent_id, last_used_at);

CREATE INDEX IF NOT EXISTS idx_mcp_room_players_room
  ON mcp_room_players(room_id, last_used_at);
