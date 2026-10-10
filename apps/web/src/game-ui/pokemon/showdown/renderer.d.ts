import type { Cue } from "@/features/pokemon/playback";

export function preloadEffects(): Promise<void>;
export function playEffect(
  stage: HTMLElement,
  cue: Cue,
  bottomSeat: string,
): {
  finished: Promise<void>;
  cancel(): void;
};
