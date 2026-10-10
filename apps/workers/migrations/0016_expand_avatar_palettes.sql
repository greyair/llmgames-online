-- Expanded palette field preserves compatibility with databases that already
-- applied the original 8-palette constraint.
ALTER TABLE users ADD COLUMN avatar_palette_v2 INTEGER NOT NULL DEFAULT 0
  CHECK (avatar_palette_v2 BETWEEN 0 AND 15);

UPDATE users SET avatar_palette_v2 = avatar_palette;
