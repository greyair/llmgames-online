/**
 * "A match is in progress" — the one bit other layers need to behave politely.
 *
 * The service worker, the update prompt and the wake lock all care about this,
 * and none of them should reach into the room's state to find it out.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

let active = 0;

export function subscribeMatch(listener: Listener): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function isMatchActive(): boolean {
  return active > 0;
}

/**
 * Mark the room as in play. Returns the matching release function; counting
 * instead of a boolean keeps a remount from clearing a still-running match.
 */
export function holdMatch(): () => void {
  active += 1;
  listeners.forEach((listener) => listener());

  let released = false;

  return () => {
    if (released) return;

    released = true;
    active = Math.max(0, active - 1);
    listeners.forEach((listener) => listener());
  };
}
