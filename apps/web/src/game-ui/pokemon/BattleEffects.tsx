import { useEffect, type RefObject } from "react";
import type { Cue } from "@/features/pokemon/playback";

const loadRenderer = () => import("./showdown/renderer.js");

export function BattleEffects({
  cue,
  stage,
  bottomSeat,
  onComplete,
}: {
  cue: Cue | null;
  stage: RefObject<HTMLElement | null>;
  bottomSeat: string;
  onComplete: (id: number) => void;
}) {
  useEffect(() => {
    void loadRenderer()
      .then((renderer) => renderer.preloadEffects())
      .catch(console.error);
  }, []);
  useEffect(() => {
    if (!cue || !stage.current || ["exit", "enter", "faint", "message"].includes(cue.kind)) return;
    const arena = stage.current;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void loadRenderer()
      .then(async (renderer) => {
        await renderer.preloadEffects();

        if (cancelled) return;
        const animation = renderer.playEffect(arena, cue, bottomSeat);
        stop = animation.cancel;
        await animation.finished;

        if (!cancelled) onComplete(cue.id);
      })
      .catch((error) => {
        console.error("Showdown animation failed", error);

        if (!cancelled) onComplete(cue.id);
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [cue, stage, bottomSeat, onComplete]);

  return null;
}
