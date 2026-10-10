import type { ClientView } from "@/domain/game-state";

export function pokerFrameKey(state: ClientView) {
  return JSON.stringify([
    state.handNumber,
    state.actionLog?.length,
    state.turnState?.phase,
    state.turnState?.currentPlayerId,
    state.community,
    state.seats,
    state.lastHandResult,
    state.status,
  ]);
}

/** Queue only public/projected snapshots, never infer a move or a card. */
export class PokerPlayback {
  static readonly resultHoldMs = 5000;
  current: ClientView;
  private pending: ClientView[] = [];
  private shownAt: number;
  constructor(state: ClientView, now: number) {
    this.current = state;
    this.shownAt = now;
  }
  push(state: ClientView) {
    const tail = this.pending.at(-1) ?? this.current;

    if (pokerFrameKey(tail) === pokerFrameKey(state)) {
      if (this.pending.length) this.pending[this.pending.length - 1] = state;
      else this.current = state;
    } else this.pending.push(state);
  }
  tick(now: number) {
    const hold = this.current.lastHandResult ? PokerPlayback.resultHoldMs : 1400;

    if (this.pending.length && now - this.shownAt >= hold) {
      this.current = this.pending.shift()!;
      this.shownAt = now;
    }

    return this.current;
  }
  resultRemainingMs(now: number) {
    return this.current.lastHandResult
      ? Math.max(0, PokerPlayback.resultHoldMs - (now - this.shownAt))
      : 0;
  }
  get catchingUp() {
    return this.pending.length > 0;
  }
}
