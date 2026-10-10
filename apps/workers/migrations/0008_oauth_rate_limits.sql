-- Bounded application-level rate limiting for public OAuth endpoints.
CREATE TABLE IF NOT EXISTS oauth_rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_oauth_rate_limits_window
  ON oauth_rate_limits(window_start);
