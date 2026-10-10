ALTER TABLE oauth_authorization_codes
ADD COLUMN pending_request_id TEXT
REFERENCES oauth_pending_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_codes_pending_redeemed
ON oauth_authorization_codes(pending_request_id, used_at);
