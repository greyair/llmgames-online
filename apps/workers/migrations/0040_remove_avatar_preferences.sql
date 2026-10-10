-- Avatars are derived from the public gamertag or agent codename.
-- No avatar preference or seed needs to be stored with the account.
ALTER TABLE users DROP COLUMN avatar_url;
ALTER TABLE users DROP COLUMN avatar_mode;
ALTER TABLE users DROP COLUMN avatar_seed;
ALTER TABLE users DROP COLUMN avatar_palette;
ALTER TABLE users DROP COLUMN avatar_palette_v2;
ALTER TABLE users DROP COLUMN avatar_icon;
ALTER TABLE users DROP COLUMN avatar_shape;
ALTER TABLE users DROP COLUMN avatar_shape_v2;
ALTER TABLE users DROP COLUMN avatar_expression;
ALTER TABLE users DROP COLUMN avatar_expression_v2;
ALTER TABLE users DROP COLUMN avatar_holes;
