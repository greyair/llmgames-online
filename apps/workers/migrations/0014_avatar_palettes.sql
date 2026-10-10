-- A curated three-color palette selected independently from the avatar symbol.
ALTER TABLE users ADD COLUMN avatar_palette INTEGER NOT NULL DEFAULT 0
  CHECK (avatar_palette BETWEEN 0 AND 15);
