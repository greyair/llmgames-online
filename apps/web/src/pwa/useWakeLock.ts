import { useEffect } from "react";

/**
 * Keep the screen awake while a match is live (PWA.2).
 *
 * Only during play: the lobby and the library are normal pages, and holding a
 * lock there would drain a phone for nothing. The lock is released by the
 * platform whenever the page is hidden, so it is re-acquired on return.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;

    const acquire = async () => {
      if (disposed || document.visibilityState === "hidden") return;

      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Denied by the browser or the OS (low battery, no user gesture). The
        // match continues; the screen just may sleep.
        sentinel = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [enabled]);
}
