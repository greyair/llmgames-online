import { useEffect, useRef, useState } from "react";
import type { ClientView } from "@/domain/game-state";
import { PokerPlayback, pokerFrameKey } from "./pokerPlayback";

export function usePokerPlayback(live: ClientView) {
  const enabled = live.type === "poker" && !live.replayReadOnly;
  const engine = useRef<PokerPlayback | null>(null);
  const [frame, setFrame] = useState(live);

  const [resultRemainingMs, setResultRemainingMs] = useState(
    live.type === "poker" && live.lastHandResult ? PokerPlayback.resultHoldMs : 0,
  );

  useEffect(() => {
    if (!enabled) return;
    engine.current = new PokerPlayback(live, performance.now());

    const timer = window.setInterval(() => {
      const playback = engine.current;

      if (playback) {
        const now = performance.now();
        setFrame(playback.tick(now));
        setResultRemainingMs(playback.resultRemainingMs(now));
      }
    }, 100);

    return () => {
      window.clearInterval(timer);
      engine.current = null;
    };
    // A new room starts a new playback queue; ordinary snapshots are enqueued below.
  }, [enabled, live.roomCode]);
  useEffect(() => {
    if (enabled) engine.current?.push(live);
  }, [live, enabled]);
  const state = enabled && frame.roomCode === live.roomCode ? frame : live;

  const goLive = () => {
    engine.current = new PokerPlayback(live, performance.now());
    setFrame(live);
    setResultRemainingMs(live.lastHandResult ? PokerPlayback.resultHoldMs : 0);
  };

  return {
    state,
    catchingUp: enabled && pokerFrameMismatch(state, live),
    goLive,
    resultRemainingMs: enabled ? resultRemainingMs : 0,
  };
}

function pokerFrameMismatch(frame: ClientView, live: ClientView) {
  return pokerFrameKey(frame) !== pokerFrameKey(live);
}
