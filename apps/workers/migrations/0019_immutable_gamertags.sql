-- Existing accounts predate public gamertags. Assign an opaque random-looking
-- identity without exposing any part of the user's Google name or email.
UPDATE users
SET gamertag = 'Player' || substr(lower(hex(randomblob(16))), 1, 14),
    updated_at = unixepoch()
WHERE gamertag IS NULL OR trim(gamertag) = '';

-- Gamertags are permanent once assigned. NULL-to-value remains allowed so the
-- application can recover an anomalous legacy row without exposing an editor.
CREATE TRIGGER IF NOT EXISTS prevent_user_gamertag_change
BEFORE UPDATE OF gamertag ON users
WHEN OLD.gamertag IS NOT NULL AND NEW.gamertag IS NOT OLD.gamertag
BEGIN
  SELECT RAISE(ABORT, 'gamertag is immutable');
END;
