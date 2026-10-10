-- Canonical game names. Retired active rooms are not carried into the new version.
CREATE TABLE active_rooms_next (
  room_code TEXT PRIMARY KEY COLLATE NOCASE,
  game_type TEXT NOT NULL CHECK (
    game_type IN (
      'connect4',
      'reversi',
      'checkers',
      'pokemon',
      'codenames',
      'blackjack',
      'blackjack-duel',
      'battleship',
      'poker',
      'contexto'
    )
  ),
  room_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'active')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO active_rooms_next (
  room_code,
  game_type,
  room_id,
  status,
  expires_at,
  created_at
)
SELECT
  room_code,
  CASE game_type
  WHEN 'four-in-a-row' THEN 'connect4'
  WHEN 'connect-four' THEN 'connect4'
  WHEN 'find-my-ship' THEN 'battleship'
  WHEN 'semantic-race' THEN 'contexto'
  WHEN 'guess-the-word' THEN 'contexto'
  ELSE game_type END,
  room_id,
  status,
  expires_at,
  created_at
FROM active_rooms
WHERE game_type NOT IN ('four-in-a-row', 'find-my-ship', 'semantic-race');

DROP TABLE active_rooms;
ALTER TABLE active_rooms_next RENAME TO active_rooms;

CREATE INDEX idx_active_rooms_expires ON active_rooms(expires_at);

-- Remove live broadcasts for retired rooms. Finished snapshots keep their new labels.
DELETE FROM broadcast_rooms
WHERE game_type IN ('four-in-a-row', 'find-my-ship', 'semantic-race') AND snapshot IS NULL;

-- Retain historical metadata and immutable archive keys under the new names.
UPDATE game_logs SET game_type = CASE game_type
  WHEN 'four-in-a-row' THEN 'connect4'
  WHEN 'connect-four' THEN 'connect4'
  WHEN 'find-my-ship' THEN 'battleship'
  WHEN 'semantic-race' THEN 'contexto'
  WHEN 'guess-the-word' THEN 'contexto'
  ELSE game_type END;
UPDATE broadcast_rooms SET game_type = CASE game_type
  WHEN 'four-in-a-row' THEN 'connect4'
  WHEN 'connect-four' THEN 'connect4'
  WHEN 'find-my-ship' THEN 'battleship'
  WHEN 'semantic-race' THEN 'contexto'
  WHEN 'guess-the-word' THEN 'contexto'
  ELSE game_type END;
UPDATE broadcast_rooms SET
  summary = json_set(summary, '$.type', game_type),
  snapshot = CASE WHEN snapshot IS NOT NULL
    THEN json_set(snapshot, '$.type', game_type) ELSE NULL END;
