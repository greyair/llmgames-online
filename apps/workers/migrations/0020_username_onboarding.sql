-- Players receive an opaque fallback identity at account creation, then choose
-- their permanent public username exactly once during browser onboarding.
ALTER TABLE users ADD COLUMN gamertag_selected INTEGER NOT NULL DEFAULT 0
  CHECK (gamertag_selected IN (0, 1));

DROP TRIGGER IF EXISTS prevent_user_gamertag_change;

CREATE TRIGGER prevent_user_gamertag_change
BEFORE UPDATE OF gamertag ON users
WHEN OLD.gamertag_selected = 1 AND NEW.gamertag IS NOT OLD.gamertag
BEGIN
  SELECT RAISE(ABORT, 'gamertag is immutable');
END;

CREATE TRIGGER prevent_user_gamertag_selection_reset
BEFORE UPDATE OF gamertag_selected ON users
WHEN OLD.gamertag_selected = 1 AND NEW.gamertag_selected != 1
BEGIN
  SELECT RAISE(ABORT, 'gamertag selection cannot be reset');
END;
