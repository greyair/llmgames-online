-- Migration number: 0001 	 2026-03-03T15:31:38.199Z

-- Users table (OAuth users)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- API Keys (encrypted)
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'cloudflare',
  encrypted_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, provider)
);

-- Game history (synced from DO on deletion)
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  game_type TEXT NOT NULL,
  host_user_id TEXT,
  state_snapshot TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  ended_at INTEGER,
  FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Game participants
CREATE TABLE IF NOT EXISTS game_participants (
  game_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT,
  score INTEGER DEFAULT 0,
  PRIMARY KEY (game_id, user_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_games_host ON games(host_user_id);
CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at);
CREATE INDEX IF NOT EXISTS idx_participants_user ON game_participants(user_id);
