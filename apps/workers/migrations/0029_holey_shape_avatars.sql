-- Store the complete Holey Shapes catalog and a direct hole count while
-- retaining the old Bloub fields for compatibility with older clients.
ALTER TABLE users ADD COLUMN avatar_shape_v2 INTEGER NOT NULL DEFAULT 0
  CHECK (avatar_shape_v2 BETWEEN 0 AND 14);

ALTER TABLE users ADD COLUMN avatar_holes INTEGER NOT NULL DEFAULT 1
  CHECK (avatar_holes BETWEEN 1 AND 8);

UPDATE users
SET avatar_shape_v2 = avatar_shape,
    avatar_holes = (avatar_expression_v2 % 8) + 1;
