import { useEffect, useSyncExternalStore } from "react";

/**
 * Browser connectivity, as a small observable.
 *
 * `navigator.onLine` is only a hint — it says "there is an interface", not "the
 * server is reachable" — so nothing here treats it as truth. It is used to stop
 * queueing moves and to explain why the board went quiet; the socket remains the
 * real source of connection state.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

let online = typeof navigator === "undefined" ? true : navigator.onLine;

let started = false;

function publish(next: boolean) {
  if (next === online) return;

  online = next;
  listeners.forEach((listener) => listener());
}

function start() {
  if (started || typeof window === "undefined") return;

  started = true;
  window.addEventListener("online", () => publish(true));
  window.addEventListener("offline", () => publish(false));
  publish(navigator.onLine);
}

export function subscribeConnectivity(listener: Listener): () => void {
  start();
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function isOnline(): boolean {
  start();

  return online;
}

/** React binding; `true` during SSR so nothing renders "offline" before hydration. */
export function useOnline(): boolean {
  useEffect(start, []);

  return useSyncExternalStore(subscribeConnectivity, isOnline, () => true);
}
