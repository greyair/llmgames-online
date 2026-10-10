-- Small start/close summaries. Board snapshots are stored only after closing.
CREATE TABLE broadcast_rooms (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  listed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  summary TEXT NOT NULL,
  snapshot TEXT,
  UNIQUE(room_id, created_at)
);
CREATE INDEX broadcast_rooms_listing ON broadcast_rooms(listed_at DESC, id DESC);
CREATE INDEX broadcast_rooms_expiry ON broadcast_rooms(expires_at);
