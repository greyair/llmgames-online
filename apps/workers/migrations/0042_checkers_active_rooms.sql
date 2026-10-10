-- Expand the active-room directory to accept Checkers rooms.
-- SQLite cannot alter a CHECK constraint in place, so preserve active rows.
CREATE TABLE active_rooms_next (
  room_code TEXT PRIMARY KEY COLLATE NOCASE,
  game_type TEXT NOT NULL CHECK (
    game_type IN (
      'four-in-a-row',
      'reversi',
      'checkers',
      'pokemon',
      'codenames',
      'blackjack',
      'blackjack-duel',
      'find-my-ship',
      'poker',
      'semantic-race'
    )
  ),
  room_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'active')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO active_rooms_next (
  room_code,
  game_type,
  room_id,
  status,
  expires_at,
  created_at
)
SELECT
  room_code,
  game_type,
  room_id,
  status,
  expires_at,
  created_at
FROM active_rooms;

DROP TABLE active_rooms;
ALTER TABLE active_rooms_next RENAME TO active_rooms;

CREATE INDEX idx_active_rooms_expires ON active_rooms(expires_at);
