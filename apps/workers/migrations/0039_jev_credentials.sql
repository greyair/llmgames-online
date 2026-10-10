CREATE TABLE jev_credentials (
  owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  key_version TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  daily_limit INTEGER NOT NULL CHECK (daily_limit BETWEEN 1 AND 100000)
);
CREATE TABLE jev_personal_usage (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, day)
);
