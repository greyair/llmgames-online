-- Let players opt out of their Google profile photo and use a locally rendered,
-- deterministic game avatar instead. The seed is opaque and safe to expose.
ALTER TABLE users ADD COLUMN avatar_mode TEXT NOT NULL DEFAULT 'generated'
  CHECK (avatar_mode = 'generated');

ALTER TABLE users ADD COLUMN avatar_seed TEXT;
