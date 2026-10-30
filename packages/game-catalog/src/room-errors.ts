/**
 * Stable error vocabulary shared by the agent-facing HTTP API and the browser
 * socket.
 *
 * `ActionErrorCode` already classified every rejected action for MCP clients.
 * Socket `error` messages had only `message` (English), which left the browser
 * either echoing English or comparing against a sentence to recognize a
 * specific rejection. Carrying the code over the socket lets the client render
 * localized copy without inventing a second taxonomy.
 *
 * Adding a code means adding an `error.<camelCase>` entry to both locale tables
 * in `apps/web/src/i18n/locales`; the web map is exhaustive, so a missing
 * translation fails type checking instead of shipping English.
 */
export const ROOM_ERROR_CODES = [
  "UNSUPPORTED_ACTION",
  "INVALID_ACTION_DATA",
  "NOT_YOUR_TURN",
  "WRONG_PHASE",
  "ILLEGAL_MOVE",
  "INSUFFICIENT_RESOURCE",
  "ALREADY_RESOLVED",
  "FORBIDDEN",
  "NOT_SEATED",
  "NOT_FOUND",
  "INTERNAL_STATE",
  "IDEMPOTENCY_CONFLICT",
  "ACTION_REJECTED",
  "INVALID_MESSAGE",
  "SPECTATOR_CANNOT_ACT",
  "NEED_MORE_PLAYERS",
  "JEV_TRIAL_USED",
  "CODENAMES_ROLES_INCOMPLETE",
  "CODENAMES_SPYMASTER_COUNT",
  "CODENAMES_OPERATIVE_MISSING",
  "CODENAMES_TEAMS_UNBALANCED",
  "CONTEXTO_WORD_NOT_IN_DICTIONARY",
] as const;

export type RoomErrorCode = (typeof ROOM_ERROR_CODES)[number];
