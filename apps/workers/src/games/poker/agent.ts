import {
  agentFields,
  arrayValue,
  isString,
  numberValue,
  projectedEntries,
  projectionPart,
  stringValue,
  type WireObject,
  type ProjectionPart,
} from "@llmgames/game-catalog";

/** Long enough to read the street, short enough to keep the state cheap. */
const ACTION_HISTORY_CAP = 24;

function compactSeats(value: readonly unknown[], playerId: string | undefined) {
  return value.flatMap((entry) => {
    const seat = projectionPart(entry);

    if (!seat) return [];

    const isYou = isString(playerId) && seat.playerId === playerId;
    const hole = arrayValue(seat.hole);
    const visibleHole = hole.some((card) => projectionPart(card)?.rank !== "?");

    return [
      agentFields({
        playerId: seat.playerId,
        isYou,
        stack: seat.stack,
        streetBet: seat.streetBet,
        contributed: seat.handContributed,
        folded: seat.folded,
        allIn: seat.allIn,
        sittingOut: seat.sittingOut,
        hole: isYou || visibleHole ? seat.hole : undefined,
      }),
    ];
  });
}

function compactActions(value: readonly unknown[], handNumber: number | undefined) {
  const entries = value.filter((entry) => {
    const actionHand = projectionPart(entry)?.handNumber;

    return handNumber === undefined || actionHand === undefined || actionHand === handNumber;
  });

  const kept = entries.slice(-ACTION_HISTORY_CAP).flatMap((entry) => {
    const action = projectionPart(entry);

    if (!action) return [];

    return [
      agentFields({
        playerId: action.playerId,
        action: action.action,
        amount: action.amount,
        street: action.street,
      }),
    ];
  });

  return { entries: kept, omitted: Math.max(0, entries.length - kept.length) };
}

/**
 * Poker keeps the table math and the current hand's history.
 *
 * Hole cards belong to their owner, or to everyone once they are face up; a
 * rival's hand stays absent rather than hidden, because an absent field costs
 * nothing and a `hidden: true` field costs a token on every seat.
 */
export function pokerAgentDecision(view: ProjectionPart): WireObject {
  const state = view;
  const playerId = stringValue(projectionPart(state.you)?.playerId);
  const handNumber = numberValue(state.handNumber);

  return agentFields({
    handNumber: state.handNumber,
    community: state.community,
    pot: state.pot,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    toCall: state.toCall,
    canCheck: state.canCheck,
    seats: compactSeats(projectedEntries(state.seats), playerId),
    buttonPlayerId: state.buttonPlayerId,
    smallBlindPlayerId: state.smallBlindPlayerId,
    bigBlindPlayerId: state.bigBlindPlayerId,
    blinds: state.blinds,
    actionHistory: compactActions(projectedEntries(state.actionLog), handNumber),
    lastHandResult: state.lastHandResult,
    winner: state.winner,
  });
}
