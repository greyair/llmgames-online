CREATE TABLE IF NOT EXISTS broadcast_finished (id TEXT PRIMARY KEY, finished_at INTEGER NOT NULL, snapshot TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS broadcast_finished_at ON broadcast_finished(finished_at);
