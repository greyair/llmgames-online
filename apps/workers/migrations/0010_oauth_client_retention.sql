ALTER TABLE oauth_clients ADD COLUMN last_used_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_oauth_clients_last_used
  ON oauth_clients(last_used_at);
