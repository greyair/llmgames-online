-- Globally unique directory for rooms that currently exist in game Durable Objects.
CREATE TABLE IF NOT EXISTS active_rooms (
  room_code TEXT PRIMARY KEY COLLATE NOCASE,
  game_type TEXT NOT NULL CHECK (
    game_type IN (
      'four-in-a-row',
      'reversi',
      'blackjack',
      'blackjack-duel',
      'find-my-ship',
      'poker'
    )
  ),
  room_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'active')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_active_rooms_expires
  ON active_rooms(expires_at);
