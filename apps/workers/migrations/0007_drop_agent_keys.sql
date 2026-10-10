-- Remove API-key bot seats (never used in production; MCP uses ephemeral agent seats).

DROP INDEX IF EXISTS idx_agent_keys_user_id;
DROP INDEX IF EXISTS idx_agent_keys_prefix;
DROP TABLE IF EXISTS agent_keys;

-- user_type column kept (all rows are human); agent bots no longer exist.
