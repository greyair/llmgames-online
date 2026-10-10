-- Reservations count failed requests too. The index supports atomic daily caps.
CREATE TABLE IF NOT EXISTS jev_usage (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  owner_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jev_usage_day_owner ON jev_usage(day, owner_id);
