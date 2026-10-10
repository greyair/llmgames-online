-- One sponsored Jev match per account. Personal TypeSafe credentials do not use this table.
CREATE TABLE jev_trial_games (
  owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL
);
