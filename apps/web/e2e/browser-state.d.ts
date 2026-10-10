/** Instrumentation installed by browser tests before reading these counters. */
declare global {
  interface HTMLElement {
    __kept?: boolean;
  }

  interface Window {
    pokerCardSounds?: number;
    sinkNotes?: number;
    gameAudioNotes?: number;
    __completeTurnstile?: () => void;
    __pillXs?: number[];
    reviewAnimation?: { cancel: () => void };
  }
}

export {};
