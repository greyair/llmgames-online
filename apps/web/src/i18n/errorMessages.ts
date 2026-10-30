import { ROOM_ERROR_CODES, type RoomErrorCode } from "@llmgames/game-catalog";
import type { MessageKey } from "./locales/en";

/**
 * Localized copy for every socket error code.
 *
 * `satisfies Record<RoomErrorCode, MessageKey>` is the cheap part: adding a
 * code on the server fails this file's type check until both locale tables get
 * a matching key, so a new rejection can never ship as English-only.
 */
export const ERROR_MESSAGE_KEYS = {
  UNSUPPORTED_ACTION: "error.unsupportedAction",
  INVALID_ACTION_DATA: "error.invalidActionData",
  NOT_YOUR_TURN: "error.notYourTurn",
  WRONG_PHASE: "error.wrongPhase",
  ILLEGAL_MOVE: "error.illegalMove",
  INSUFFICIENT_RESOURCE: "error.insufficientResource",
  ALREADY_RESOLVED: "error.alreadyResolved",
  FORBIDDEN: "error.forbidden",
  NOT_SEATED: "error.notSeated",
  NOT_FOUND: "error.notFound",
  INTERNAL_STATE: "error.internalState",
  IDEMPOTENCY_CONFLICT: "error.idempotencyConflict",
  ACTION_REJECTED: "error.actionRejected",
  INVALID_MESSAGE: "error.invalidMessage",
  SPECTATOR_CANNOT_ACT: "error.spectatorCannotAct",
  NEED_MORE_PLAYERS: "error.needMorePlayers",
  JEV_TRIAL_USED: "error.jevTrialUsed",
  CODENAMES_ROLES_INCOMPLETE: "error.codenamesRolesIncomplete",
  CODENAMES_SPYMASTER_COUNT: "error.codenamesSpymasterCount",
  CODENAMES_OPERATIVE_MISSING: "error.codenamesOperativeMissing",
  CODENAMES_TEAMS_UNBALANCED: "error.codenamesTeamsUnbalanced",
  CONTEXTO_WORD_NOT_IN_DICTIONARY: "error.contextoWordNotInDictionary",
} satisfies Record<RoomErrorCode, MessageKey>;

/**
 * Narrow a wire value to a code the client can localize. The socket payload is
 * untyped JSON, so this is a membership test rather than a cast.
 */
export function isRoomErrorCode(value: string): value is RoomErrorCode {
  return ROOM_ERROR_CODES.some((known) => known === value);
}
