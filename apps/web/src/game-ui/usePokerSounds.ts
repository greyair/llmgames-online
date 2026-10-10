import { useEffect, useRef } from "react";
import type { ClientView } from "@/domain/game-state";
import { playCardSound, unlockCardAudio, type CardSound } from "@/interface/Feedback";

export function pokerSound(previous: ClientView, next: ClientView): CardSound | null {
  if (previous.roomCode !== next.roomCode) return null;

  if (next.lastHandResult && !previous.lastHandResult) return "reveal";

  if (next.handNumber !== previous.handNumber) return "deal";

  if (
    (Array.isArray(next.community) ? next.community : undefined)?.length !==
    (Array.isArray(previous.community) ? previous.community : undefined)?.length
  )
    return "deal";

  if ((next.actionLog?.length ?? 0) > (previous.actionLog?.length ?? 0))
    return next.actionLog?.at(-1)?.action === "fold" ? "fold" : "chips";

  return null;
}

export function usePokerSounds(state: ClientView) {
  const previous = useRef(state);
  const enabled = state.type === "poker" && !state.replayReadOnly;
  useEffect(() => {
    if (!enabled) return;

    const unlock = (event: Event) => {
      if (event.isTrusted) unlockCardAudio();
    };

    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });

    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [enabled]);
  useEffect(() => {
    if (state.type === "poker" && !state.replayReadOnly) {
      const sound = pokerSound(previous.current, state);

      if (sound) playCardSound(sound);
    }

    previous.current = state;
  }, [state]);
}
