-- Reject two simultaneous wait_for_turn calls that copied one controller.

ALTER TABLE mcp_agent_controllers ADD COLUMN active_wait_token TEXT;
ALTER TABLE mcp_agent_controllers ADD COLUMN active_wait_expires_at INTEGER;
