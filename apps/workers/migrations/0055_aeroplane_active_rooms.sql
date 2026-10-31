-- Admit aeroplane rooms to the public room directory.
-- Same rebuild pattern as 0054 (and 0024, 0030, 0042, 0045, 0046 before it):
-- SQLite cannot alter a CHECK constraint, and `mcp_live_rooms` has to be dropped
-- before the table it reads can be renamed.
DROP VIEW IF EXISTS mcp_live_rooms;
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
      'contexto',
      'gomoku',
      'aeroplane'
    )
  ),
  room_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'active')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO active_rooms_next SELECT * FROM active_rooms;
DROP TABLE active_rooms;
ALTER TABLE active_rooms_next RENAME TO active_rooms;
CREATE INDEX idx_active_rooms_expires ON active_rooms(expires_at);
CREATE VIEW mcp_live_rooms AS
SELECT room_id, status, expires_at FROM active_rooms
UNION ALL
SELECT 'series-' || code AS room_id, 'active' AS status, expires_at
FROM game_series WHERE status IN ('waiting', 'preparing', 'playing', 'break');
