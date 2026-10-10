-- Browser sessions have a fixed seven-day lifetime and can be revoked immediately.
-- Legacy JWTs without a registered session ID are deliberately not migrated.
CREATE TABLE web_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  authenticated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_web_sessions_user ON web_sessions(user_id);
CREATE INDEX idx_web_sessions_expiry ON web_sessions(expires_at);
