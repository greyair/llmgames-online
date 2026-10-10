export type ActionErrorCode =
  | "UNSUPPORTED_ACTION"
  | "INVALID_ACTION_DATA"
  | "NOT_YOUR_TURN"
  | "WRONG_PHASE"
  | "ILLEGAL_MOVE"
  | "INSUFFICIENT_RESOURCE"
  | "ALREADY_RESOLVED"
  | "FORBIDDEN"
  | "NOT_SEATED"
  | "NOT_FOUND"
  | "INTERNAL_STATE"
  | "ACTION_REJECTED";

export type ActionErrorCategory =
  | "scope"
  | "input"
  | "state"
  | "rule"
  | "resource"
  | "permission"
  | "not_found"
  | "internal";

export type ActionErrorRecovery =
  | "correct_action"
  | "correct_input"
  | "wait_for_turn"
  | "wait_for_phase"
  | "refresh_state"
  | "retry"
  | "none";

export interface ActionError {
  code: ActionErrorCode;
  category: ActionErrorCategory;
  message: string;
  actionType: string;
  recovery: ActionErrorRecovery;
}

export interface ActionRejection extends ActionError {
  httpStatus: number;
}

const includesAny = (message: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => message.includes(pattern));

/**
 * Converts legacy game-rule rejection strings into the stable agent-facing
 * action error contract. Keeping this mapping centralized lets individual game
 * engines stay focused on rules while every transport exposes the same shape.
 */
export function classifyActionError(message: string, actionType: string): ActionRejection {
  const normalized = message.toLowerCase();
  const base = { message, actionType };

  if (
    includesAny(normalized, [
      "unknown action",
      "unsupported action",
      "update_data is rejected",
      "fixed bet is auto-posted",
    ])
  ) {
    return {
      ...base,
      code: "UNSUPPORTED_ACTION",
      category: "scope",
      recovery: "correct_action",
      httpStatus: 400,
    };
  }

  if (
    includesAny(normalized, [
      "shoe empty",
      "residual empty",
      "deck empty",
      "no game state",
      "no state",
      "no board",
      "no opponent",
      "server could not complete",
    ])
  ) {
    return {
      ...base,
      code: "INTERNAL_STATE",
      category: "internal",
      recovery: "retry",
      httpStatus: 500,
    };
  }

  if (includesAny(normalized, ["not your turn", "not current player"])) {
    return {
      ...base,
      code: "NOT_YOUR_TURN",
      category: "state",
      recovery: "wait_for_turn",
      httpStatus: 409,
    };
  }

  if (
    includesAny(normalized, [
      "not seated",
      "not a seated player",
      "no seat assigned",
      "not in room",
      "cannot act — watch only",
      "spectators cannot act",
    ])
  ) {
    return {
      ...base,
      code: "NOT_SEATED",
      category: "permission",
      recovery: "none",
      httpStatus: 403,
    };
  }

  if (
    includesAny(normalized, [
      "only the host",
      "host cannot",
      "the host cannot",
      "cannot move yourself",
    ])
  ) {
    return {
      ...base,
      code: "FORBIDDEN",
      category: "permission",
      recovery: "none",
      httpStatus: 403,
    };
  }

  if (includesAny(normalized, ["room not found", "player not found"])) {
    return {
      ...base,
      code: "NOT_FOUND",
      category: "not_found",
      recovery: "refresh_state",
      httpStatus: 404,
    };
  }

  if (
    includesAny(normalized, [
      "not enough",
      "insufficient",
      "no chips",
      "munition point",
      "limit reached",
    ])
  ) {
    return {
      ...base,
      code: "INSUFFICIENT_RESOURCE",
      category: "resource",
      recovery: "correct_input",
      httpStatus: 422,
    };
  }

  if (
    normalized.includes("already") ||
    includesAny(normalized, [
      "column full",
      "column is full",
      "hand is over",
      "hand over",
      "hand folded",
      "hand has ended",
      "hand is already",
      "seat has no active",
      "sitting out",
    ])
  ) {
    return {
      ...base,
      code: "ALREADY_RESOLVED",
      category: "state",
      recovery: "refresh_state",
      httpStatus: 409,
    };
  }

  if (
    (normalized.startsWith("not ") && includesAny(normalized, ["phase", "street"])) ||
    includesAny(normalized, [
      "game not playing",
      "game is not playing",
      "not play phase",
      "not player phase",
      "not betting phase",
      "not placement phase",
      "not battle phase",
      "not betting street",
      "cannot bet now",
      "cannot start now",
      "finish current",
      "hand still in progress",
      "need at least",
      "not in waiting status",
      "before the game starts",
      "wrong phase",
    ])
  ) {
    return {
      ...base,
      code: "WRONG_PHASE",
      category: "state",
      recovery: "wait_for_phase",
      httpStatus: 409,
    };
  }

  if (
    includesAny(normalized, [
      "required",
      "must be",
      "must include",
      "invalid",
      "out of bounds",
      "outside board",
      "overlap",
      "duplicate",
      "missing ship",
      "need exactly",
      "provide either",
      "top-left",
      "edge cell",
      "integer",
      "only valid for",
    ])
  ) {
    return {
      ...base,
      code: "INVALID_ACTION_DATA",
      category: "input",
      recovery: "correct_input",
      httpStatus: 400,
    };
  }

  if (
    includesAny(normalized, [
      "illegal move",
      "cannot check",
      "cannot call",
      "can only",
      "only with",
      "only on first",
      "nothing to call",
      "minimum bet",
      "minimum raise",
      "min bet",
      "min raise",
      "max ",
      "raise must",
      "bet must",
      "not legal",
    ])
  ) {
    return {
      ...base,
      code: "ILLEGAL_MOVE",
      category: "rule",
      recovery: "correct_input",
      httpStatus: 422,
    };
  }

  return {
    ...base,
    code: "ACTION_REJECTED",
    category: "rule",
    recovery: "refresh_state",
    httpStatus: 422,
  };
}

export function publicActionError(rejection: ActionRejection): ActionError {
  const { httpStatus: _httpStatus, ...error } = rejection;

  return error;
}

export function internalActionError(actionType: string): ActionRejection {
  return {
    code: "INTERNAL_STATE",
    category: "internal",
    message: "The server could not complete this action.",
    actionType,
    recovery: "retry",
    httpStatus: 500,
  };
}
