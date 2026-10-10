-- Current empty-database bootstrap. Production upgrades use migrations/.
-- Generated from the complete migration sequence through 0046.

CREATE TABLE "active_rooms" (
  room_code TEXT PRIMARY KEY COLLATE NOCASE,
  game_type TEXT NOT NULL CHECK (
    game_type IN (
      'connect4',
      'reversi',
      'checkers',
      'pokemon',
      'codenames',
      'battleship',
      'poker',
      'contexto'
    )
  ),
  room_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'active')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE broadcast_rooms (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  listed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  summary TEXT NOT NULL,
  snapshot TEXT, game_log_id TEXT, broadcast_allowed INTEGER NOT NULL DEFAULT 0 CHECK (broadcast_allowed IN (0, 1)),
  UNIQUE(room_id, created_at)
);
CREATE TABLE email_login_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    browser_hash TEXT NOT NULL,
    return_to TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL
);
CREATE TABLE game_broadcast_features (
  game_log_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  channel_login TEXT NOT NULL,
  broadcaster_id TEXT NOT NULL,
  featured_at INTEGER NOT NULL,
  offset_seconds INTEGER NOT NULL,
  vod_id TEXT,
  checked_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE game_log_participants (
  game_log_id TEXT NOT NULL,
  participant_ref TEXT NOT NULL,
  owner_user_id TEXT,
  is_agent INTEGER NOT NULL DEFAULT 0,
  codename TEXT,
  environment_label TEXT,
  display_name TEXT NOT NULL,
  owner_gamertag TEXT,
  PRIMARY KEY (game_log_id, participant_ref),
  FOREIGN KEY (game_log_id) REFERENCES game_logs(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE game_logs (
  id TEXT PRIMARY KEY,
  game_type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  end_reason TEXT NOT NULL,
  winner_ref TEXT,
  event_count INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE jev_credentials (
  owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  key_version TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  daily_limit INTEGER NOT NULL CHECK (daily_limit BETWEEN 1 AND 100000)
);
CREATE TABLE jev_personal_usage (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, day)
);
CREATE TABLE jev_trial_games (
  owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE jev_usage (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  owner_id TEXT NOT NULL
);
CREATE TABLE mcp_agent_controllers (
  controller_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL UNIQUE,
  client_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL, active_wait_token TEXT, active_wait_expires_at INTEGER,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES mcp_agent_seats(id) ON DELETE CASCADE
);
CREATE TABLE mcp_agent_seats (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  codename TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER, client_id TEXT, environment_label TEXT NOT NULL DEFAULT 'MCP Agent',
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE mcp_room_players (
  room_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  player_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (room_id, agent_id),
  FOREIGN KEY (agent_id) REFERENCES mcp_agent_seats(id) ON DELETE CASCADE
);
CREATE TABLE oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  scopes TEXT NOT NULL DEFAULT 'mcp',
  resource TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()), pending_request_id TEXT
REFERENCES oauth_pending_requests(id) ON DELETE SET NULL,
  FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  client_secret_expires_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
, last_used_at INTEGER);
CREATE TABLE oauth_pending_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  scopes TEXT NOT NULL DEFAULT 'mcp',
  resource TEXT,
  state TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE TABLE oauth_rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'mcp',
  resource TEXT,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
, gamertag TEXT, gamertag_selected INTEGER NOT NULL DEFAULT 0
  CHECK (gamertag_selected IN (0, 1)), broadcast_allowed INTEGER NOT NULL DEFAULT 0 CHECK (broadcast_allowed IN (0, 1)));
CREATE INDEX broadcast_rooms_expiry ON broadcast_rooms(expires_at);
CREATE INDEX broadcast_rooms_listing ON broadcast_rooms(listed_at DESC, id DESC);
CREATE VIEW eligible_broadcast_rooms AS
SELECT * FROM broadcast_rooms WHERE broadcast_allowed = 1;
CREATE INDEX email_login_codes_expiry ON email_login_codes(expires_at);
CREATE INDEX idx_active_rooms_expires ON active_rooms(expires_at);
CREATE INDEX idx_game_broadcast_stream_pending
  ON game_broadcast_features(broadcaster_id, stream_id)
  WHERE vod_id IS NULL;
CREATE INDEX idx_game_log_participants_owner
  ON game_log_participants(owner_user_id, game_log_id);
CREATE INDEX idx_game_logs_ended
  ON game_logs(ended_at DESC, id DESC);
CREATE INDEX idx_jev_usage_day_owner ON jev_usage(day, owner_id);
CREATE INDEX idx_mcp_agent_controllers_owner
  ON mcp_agent_controllers(owner_user_id, expires_at);
CREATE INDEX idx_mcp_agent_seats_codename
  ON mcp_agent_seats(lower(codename));
CREATE INDEX idx_mcp_agent_seats_owner
  ON mcp_agent_seats(owner_user_id);
CREATE INDEX idx_mcp_room_players_agent
  ON mcp_room_players(agent_id, last_used_at);
CREATE INDEX idx_oauth_clients_last_used
  ON oauth_clients(COALESCE(last_used_at, created_at));
CREATE INDEX idx_oauth_codes_client ON oauth_authorization_codes(client_id);
CREATE INDEX idx_oauth_codes_expires ON oauth_authorization_codes(expires_at);
CREATE INDEX idx_oauth_codes_pending_redeemed
ON oauth_authorization_codes(pending_request_id, used_at);
CREATE INDEX idx_oauth_pending_expires ON oauth_pending_requests(expires_at);
CREATE INDEX idx_oauth_rate_limits_window
  ON oauth_rate_limits(window_start);
CREATE INDEX idx_oauth_refresh_client_active
  ON oauth_refresh_tokens(client_id, revoked_at, expires_at);
CREATE INDEX idx_oauth_refresh_user ON oauth_refresh_tokens(user_id);
CREATE UNIQUE INDEX idx_users_gamertag_nocase
  ON users(lower(gamertag))
  WHERE gamertag IS NOT NULL;
CREATE TRIGGER prevent_user_gamertag_change
BEFORE UPDATE OF gamertag ON users
WHEN OLD.gamertag_selected = 1 AND NEW.gamertag IS NOT OLD.gamertag
BEGIN
  SELECT RAISE(ABORT, 'gamertag is immutable');
END;
CREATE TRIGGER prevent_user_gamertag_selection_reset
BEFORE UPDATE OF gamertag_selected ON users
WHEN OLD.gamertag_selected = 1 AND NEW.gamertag_selected != 1
BEGIN
  SELECT RAISE(ABORT, 'gamertag selection cannot be reset');
END;
CREATE TABLE agent_webhooks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hostname TEXT NOT NULL,
  header_name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  key_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_attempt_at INTEGER,
  last_delivery TEXT CHECK(last_delivery IN ('sending', 'delivered', 'failed', 'unknown'))
);
CREATE INDEX idx_agent_webhooks_owner ON agent_webhooks(owner_id);

-- Browser sessions have a fixed seven-day lifetime and can be revoked immediately.
-- Legacy JWTs without a registered session ID are deliberately not migrated.
CREATE TABLE web_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  authenticated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_web_sessions_user ON web_sessions(user_id);
CREATE INDEX idx_web_sessions_expiry ON web_sessions(expires_at);

-- Operator cookies must have a live server-side record. Legacy sessions require login.
CREATE TABLE spectator_sessions (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_spectator_sessions_expiry ON spectator_sessions(expires_at);
CREATE TABLE spectator_login_limits (
  id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_spectator_login_limits_expiry ON spectator_login_limits(expires_at);

CREATE TABLE game_series (
  code TEXT PRIMARY KEY,
  host_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX game_series_host ON game_series(host_user_id, created_at DESC);

-- Keep controller leasing and identity deletion aware of a whole active series.
CREATE VIEW mcp_live_rooms AS
SELECT room_id, status, expires_at FROM active_rooms
UNION ALL
SELECT 'series-' || code AS room_id, 'active' AS status, expires_at
FROM game_series WHERE status IN ('waiting', 'preparing', 'playing', 'break');
