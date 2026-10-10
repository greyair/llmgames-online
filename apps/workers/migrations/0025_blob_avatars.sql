-- Replace third-party character icons with locally rendered blob avatars.
-- Keep avatar_icon in place so older rows and rolled-back clients remain readable.
ALTER TABLE users ADD COLUMN avatar_shape INTEGER NOT NULL DEFAULT 0
  CHECK (avatar_shape BETWEEN 0 AND 7);

ALTER TABLE users ADD COLUMN avatar_expression INTEGER NOT NULL DEFAULT 0
  CHECK (avatar_expression BETWEEN 0 AND 11);

UPDATE users
SET avatar_shape = coalesce(avatar_icon, 0) % 8,
    avatar_expression = coalesce(avatar_icon, 0) % 12;
