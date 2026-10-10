-- Operator cookies must have a live server-side record. Legacy sessions require login.
CREATE TABLE spectator_sessions (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_spectator_sessions_expiry ON spectator_sessions(expires_at);
CREATE TABLE spectator_login_limits (
  id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_spectator_login_limits_expiry ON spectator_login_limits(expires_at);
