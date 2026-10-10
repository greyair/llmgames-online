-- Retire both Blackjack games and their ranked infrastructure.
CREATE TABLE active_rooms_next (
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
INSERT INTO active_rooms_next SELECT * FROM active_rooms
WHERE game_type NOT IN ('blackjack', 'blackjack-duel');
DROP TABLE active_rooms;
ALTER TABLE active_rooms_next RENAME TO active_rooms;
CREATE INDEX idx_active_rooms_expires ON active_rooms(expires_at);
DELETE FROM broadcast_rooms WHERE game_type IN ('blackjack', 'blackjack-duel');
DROP TRIGGER IF EXISTS ranked_blackjack_match_aggregate;
DROP TABLE ranked_blackjack_matches;
DROP TABLE ranked_blackjack_stats;
