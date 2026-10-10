-- The primary/unique keys already serve room lookups, and current queries do
-- not filter by these standalone columns.
DROP INDEX IF EXISTS idx_active_rooms_expires;
DROP INDEX IF EXISTS idx_mcp_agent_controllers_expiry;
DROP INDEX IF EXISTS idx_mcp_agent_seats_client;
DROP INDEX IF EXISTS idx_mcp_agent_seats_last_used;
DROP INDEX IF EXISTS idx_mcp_room_players_room;
DROP INDEX IF EXISTS idx_ranked_blackjack_matches_ended;

-- Match the expressions and column order used by live queries.
DROP INDEX IF EXISTS idx_mcp_agent_seats_codename;
CREATE INDEX idx_mcp_agent_seats_codename
  ON mcp_agent_seats(lower(codename));

DROP INDEX IF EXISTS idx_oauth_clients_last_used;
CREATE INDEX idx_oauth_clients_last_used
  ON oauth_clients(COALESCE(last_used_at, created_at));

DROP INDEX IF EXISTS idx_game_log_participants_owner;
CREATE INDEX idx_game_log_participants_owner
  ON game_log_participants(owner_user_id, game_log_id);

DROP INDEX IF EXISTS idx_ranked_blackjack_order;
CREATE INDEX idx_ranked_blackjack_order
  ON ranked_blackjack_stats(points DESC, wins DESC, bankroll_delta DESC, matches_played ASC);

-- Client retention checks active refresh tokens by client and expiry. The
-- client_id prefix also supports the client foreign-key cascade.
CREATE INDEX idx_oauth_refresh_client_active
  ON oauth_refresh_tokens(client_id, revoked_at, expires_at);

-- A stream may feature many archived games. Only unresolved VOD rows need
-- this lookup when a recording appears.
CREATE INDEX idx_game_broadcast_stream_pending
  ON game_broadcast_features(broadcaster_id, stream_id)
  WHERE vod_id IS NULL;
