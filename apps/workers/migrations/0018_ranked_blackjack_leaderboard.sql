CREATE TABLE IF NOT EXISTS ranked_blackjack_stats (
  owner_user_id TEXT PRIMARY KEY,
  gamertag TEXT NOT NULL,
  matches_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  bankroll_delta INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ranked_blackjack_order
  ON ranked_blackjack_stats(points DESC, wins DESC, bankroll_delta DESC);

CREATE TABLE IF NOT EXISTS ranked_blackjack_matches (
  room_id TEXT PRIMARY KEY,
  player_a_owner_id TEXT NOT NULL,
  player_a_gamertag TEXT NOT NULL,
  player_a_bankroll INTEGER NOT NULL,
  player_b_owner_id TEXT NOT NULL,
  player_b_gamertag TEXT NOT NULL,
  player_b_bankroll INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('a', 'b', 'draw')),
  ended_at INTEGER NOT NULL,
  CHECK (player_a_owner_id <> player_b_owner_id),
  FOREIGN KEY (player_a_owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (player_b_owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ranked_blackjack_matches_ended
  ON ranked_blackjack_matches(ended_at DESC);

-- The trigger makes result aggregation atomic and replay-safe: inserting the
-- same room_id twice does nothing, so Durable Object retries cannot double-count.
CREATE TRIGGER IF NOT EXISTS ranked_blackjack_match_aggregate
AFTER INSERT ON ranked_blackjack_matches
BEGIN
  INSERT INTO ranked_blackjack_stats (
    owner_user_id, gamertag, matches_played, wins, losses, draws,
    points, bankroll_delta, updated_at
  ) VALUES (
    NEW.player_a_owner_id,
    NEW.player_a_gamertag,
    1,
    CASE WHEN NEW.result = 'a' THEN 1 ELSE 0 END,
    CASE WHEN NEW.result = 'b' THEN 1 ELSE 0 END,
    CASE WHEN NEW.result = 'draw' THEN 1 ELSE 0 END,
    CASE WHEN NEW.result = 'a' THEN 3 WHEN NEW.result = 'draw' THEN 1 ELSE 0 END,
    NEW.player_a_bankroll - 1000,
    NEW.ended_at
  )
  ON CONFLICT(owner_user_id) DO UPDATE SET
    gamertag = excluded.gamertag,
    matches_played = ranked_blackjack_stats.matches_played + 1,
    wins = ranked_blackjack_stats.wins + excluded.wins,
    losses = ranked_blackjack_stats.losses + excluded.losses,
    draws = ranked_blackjack_stats.draws + excluded.draws,
    points = ranked_blackjack_stats.points + excluded.points,
    bankroll_delta = ranked_blackjack_stats.bankroll_delta + excluded.bankroll_delta,
    updated_at = excluded.updated_at;

  INSERT INTO ranked_blackjack_stats (
    owner_user_id, gamertag, matches_played, wins, losses, draws,
    points, bankroll_delta, updated_at
  ) VALUES (
    NEW.player_b_owner_id,
    NEW.player_b_gamertag,
    1,
    CASE WHEN NEW.result = 'b' THEN 1 ELSE 0 END,
    CASE WHEN NEW.result = 'a' THEN 1 ELSE 0 END,
    CASE WHEN NEW.result = 'draw' THEN 1 ELSE 0 END,
    CASE WHEN NEW.result = 'b' THEN 3 WHEN NEW.result = 'draw' THEN 1 ELSE 0 END,
    NEW.player_b_bankroll - 1000,
    NEW.ended_at
  )
  ON CONFLICT(owner_user_id) DO UPDATE SET
    gamertag = excluded.gamertag,
    matches_played = ranked_blackjack_stats.matches_played + 1,
    wins = ranked_blackjack_stats.wins + excluded.wins,
    losses = ranked_blackjack_stats.losses + excluded.losses,
    draws = ranked_blackjack_stats.draws + excluded.draws,
    points = ranked_blackjack_stats.points + excluded.points,
    bankroll_delta = ranked_blackjack_stats.bankroll_delta + excluded.bankroll_delta,
    updated_at = excluded.updated_at;
END;
