CREATE TABLE agent_webhooks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hostname TEXT NOT NULL,
  header_name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  key_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_attempt_at INTEGER,
  last_delivery TEXT CHECK(last_delivery IN ('sending', 'delivered', 'failed', 'unknown'))
);
CREATE INDEX idx_agent_webhooks_owner ON agent_webhooks(owner_id);
