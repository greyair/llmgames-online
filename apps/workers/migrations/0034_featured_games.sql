ALTER TABLE broadcast_rooms ADD COLUMN game_log_id TEXT;
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
