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
