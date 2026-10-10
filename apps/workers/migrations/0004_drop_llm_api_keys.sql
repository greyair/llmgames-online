-- Drop legacy encrypted LLM provider keys (OpenRouter / in-app AI).
-- Seats are external agents (agent_keys) or browser humans only.

DROP INDEX IF EXISTS idx_api_keys_user_id;
DROP TABLE IF EXISTS api_keys;
