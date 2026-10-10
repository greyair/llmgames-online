-- Searchable metadata for completed games. The full sanitized log is stored as
-- one gzip-compressed JSON object in the GAME_LOGS R2 bucket.

CREATE TABLE IF NOT EXISTS game_logs (
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

CREATE INDEX IF NOT EXISTS idx_game_logs_ended
  ON game_logs(ended_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS game_log_participants (
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

CREATE INDEX IF NOT EXISTS idx_game_log_participants_owner
  ON game_log_participants(owner_user_id, is_agent, game_log_id);
