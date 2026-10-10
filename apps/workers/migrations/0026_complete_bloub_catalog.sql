-- Add the complete 16-expression Bloub catalog without changing the check on
-- the legacy avatar_expression column created by migration 0025.
ALTER TABLE users ADD COLUMN avatar_expression_v2 INTEGER NOT NULL DEFAULT 0
  CHECK (avatar_expression_v2 BETWEEN 0 AND 15);

UPDATE users
SET avatar_expression_v2 = avatar_expression,
    avatar_palette_v2 = avatar_palette_v2 % 12;
