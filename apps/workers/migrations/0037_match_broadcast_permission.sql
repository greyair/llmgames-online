-- Capture legacy eligibility once. Subsequent profile changes affect new matches only.
ALTER TABLE broadcast_rooms ADD COLUMN broadcast_allowed INTEGER NOT NULL DEFAULT 0 CHECK (broadcast_allowed IN (0, 1));
UPDATE broadcast_rooms SET broadcast_allowed = 1
WHERE host_owner_user_id IN (SELECT id FROM users WHERE broadcast_allowed = 1);
DROP VIEW eligible_broadcast_rooms;
CREATE VIEW eligible_broadcast_rooms AS
SELECT * FROM broadcast_rooms WHERE broadcast_allowed = 1;
