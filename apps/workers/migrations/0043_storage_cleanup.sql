-- Retire tables that have had no runtime readers or writers since game_logs/R2
-- and broadcast_rooms became the completed-game and spectator stores.
DROP TABLE IF EXISTS game_participants;
DROP TABLE IF EXISTS games;
DROP TABLE IF EXISTS broadcast_finished;
-- This ad hoc email counter is absent from migrations and current code.
DROP TABLE IF EXISTS email_send_stats;

-- Agent users and their lookup were removed with the old API-key model.
DROP INDEX IF EXISTS idx_users_type;
ALTER TABLE users DROP COLUMN user_type;

-- Match permission has been frozen in broadcast_allowed since migration 0037.
ALTER TABLE broadcast_rooms DROP COLUMN host_owner_user_id;

-- The sponsored Jev rule only asks whether the owner has claimed a game.
ALTER TABLE jev_trial_games DROP COLUMN room_id;
ALTER TABLE jev_trial_games DROP COLUMN claimed_at;

-- Daily limits only inspect the current UTC day.
DELETE FROM jev_usage WHERE day < strftime('%Y-%m-%d', 'now');
DELETE FROM jev_personal_usage WHERE day < strftime('%Y-%m-%d', 'now');

-- Registration accepts only one grant/response/scope combination. These
-- values and the optional URLs were written but never read after registration.
ALTER TABLE oauth_clients DROP COLUMN grant_types;
ALTER TABLE oauth_clients DROP COLUMN response_types;
ALTER TABLE oauth_clients DROP COLUMN scope;
ALTER TABLE oauth_clients DROP COLUMN client_uri;
ALTER TABLE oauth_clients DROP COLUMN logo_uri;
ALTER TABLE oauth_clients DROP COLUMN client_id_issued_at;

-- The owner is required by the FK; the leaderboard can read the current
-- immutable gamertag from users instead of copying it into every match.
DROP TRIGGER ranked_blackjack_match_aggregate;
ALTER TABLE ranked_blackjack_stats DROP COLUMN gamertag;
ALTER TABLE ranked_blackjack_matches DROP COLUMN player_a_gamertag;
ALTER TABLE ranked_blackjack_matches DROP COLUMN player_b_gamertag;
CREATE TRIGGER ranked_blackjack_match_aggregate
AFTER INSERT ON ranked_blackjack_matches
BEGIN
  INSERT INTO ranked_blackjack_stats (
    owner_user_id, matches_played, wins, losses, draws,
    points, bankroll_delta, updated_at
  ) VALUES (
    NEW.player_a_owner_id, 1,
    CASE WHEN NEW.result = 'a' THEN 1 ELSE 0 END,
    CASE WHEN NEW.result = 'b' THEN 1 ELSE 0 END,
    CASE WHEN NEW.result = 'draw' THEN 1 ELSE 0 END,
    CASE WHEN NEW.result = 'a' THEN 3 WHEN NEW.result = 'draw' THEN 1 ELSE 0 END,
    NEW.player_a_bankroll - 1000, NEW.ended_at
  )
  ON CONFLICT(owner_user_id) DO UPDATE SET
    matches_played = ranked_blackjack_stats.matches_played + 1,
    wins = ranked_blackjack_stats.wins + excluded.wins,
    losses = ranked_blackjack_stats.losses + excluded.losses,
    draws = ranked_blackjack_stats.draws + excluded.draws,
    points = ranked_blackjack_stats.points + excluded.points,
    bankroll_delta = ranked_blackjack_stats.bankroll_delta + excluded.bankroll_delta,
    updated_at = excluded.updated_at;

  INSERT INTO ranked_blackjack_stats (
    owner_user_id, matches_played, wins, losses, draws,
    points, bankroll_delta, updated_at
  ) VALUES (
    NEW.player_b_owner_id, 1,
    CASE WHEN NEW.result = 'b' THEN 1 ELSE 0 END,
    CASE WHEN NEW.result = 'a' THEN 1 ELSE 0 END,
    CASE WHEN NEW.result = 'draw' THEN 1 ELSE 0 END,
    CASE WHEN NEW.result = 'b' THEN 3 WHEN NEW.result = 'draw' THEN 1 ELSE 0 END,
    NEW.player_b_bankroll - 1000, NEW.ended_at
  )
  ON CONFLICT(owner_user_id) DO UPDATE SET
    matches_played = ranked_blackjack_stats.matches_played + 1,
    wins = ranked_blackjack_stats.wins + excluded.wins,
    losses = ranked_blackjack_stats.losses + excluded.losses,
    draws = ranked_blackjack_stats.draws + excluded.draws,
    points = ranked_blackjack_stats.points + excluded.points,
    bankroll_delta = ranked_blackjack_stats.bankroll_delta + excluded.bankroll_delta,
    updated_at = excluded.updated_at;
END;
