ALTER TABLE users ADD COLUMN broadcast_allowed INTEGER NOT NULL DEFAULT 0 CHECK (broadcast_allowed IN (0, 1));
ALTER TABLE broadcast_rooms ADD COLUMN host_owner_user_id TEXT;
CREATE VIEW eligible_broadcast_rooms AS
SELECT b.* FROM broadcast_rooms b
JOIN users u ON u.id = b.host_owner_user_id
WHERE u.broadcast_allowed = 1;
