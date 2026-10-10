import { useEffect, useState } from "react";
import type { ClientView } from "@/domain/game-state";

/** Use the server's time origin so an incorrect device clock cannot shift a match. */
export function receiveClock<T extends ClientView>(state: T): T {
  return { ...state, clockReceivedAt: performance.now() };
}

export function remainingAt(state: ClientView, now: number) {
  const clock = state.clock;

  if (
    !clock ||
    state.clockReceivedAt === undefined ||
    state.status !== "playing" ||
    state.replayReadOnly
  ) {
    return { game: state.gameTimeRemaining, turn: state.turnState?.turnTimeRemaining };
  }

  const serverNow = clock.serverTime + Math.max(0, now - state.clockReceivedAt);

  return {
    game:
      clock.gameEndsAt === null
        ? state.gameTimeRemaining
        : Math.max(0, clock.gameEndsAt - serverNow),
    turn:
      clock.turnEndsAt === null
        ? state.turnState?.turnTimeRemaining
        : Math.max(0, clock.turnEndsAt - serverNow),
  };
}

export function useMatchClock(state: ClientView) {
  const [now, setNow] = useState(() => performance.now());
  const running = Boolean(state.clock && state.status === "playing" && !state.replayReadOnly);
  useEffect(() => {
    if (!running) return;
    const update = () => setNow(performance.now());
    const timer = window.setInterval(update, 100);
    document.addEventListener("visibilitychange", update);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [running]);

  return remainingAt(state, Math.max(now, state.clockReceivedAt ?? now));
}
