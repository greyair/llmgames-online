-- Optional explicit catalog selection. NULL keeps the deterministic seed-based icon.
ALTER TABLE users ADD COLUMN avatar_icon INTEGER
  CHECK (avatar_icon BETWEEN 0 AND 49);
