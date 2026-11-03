/**
 * Service worker registration and update plumbing (PWA.1).
 *
 * The rule that matters: a player in a match is never reloaded underneath. A
 * waiting worker is announced, but swapping it in is the player's decision, and
 * the UI withholds the offer until the match ends.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

let waiting: ServiceWorker | null = null;

let reloading = false;

let started = false;

export function subscribeUpdate(listener: Listener): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function hasUpdate(): boolean {
  return waiting !== null;
}

function announce() {
  listeners.forEach((listener) => listener());
}

/** Reload once the new worker takes over; guard against a reload loop. */
function reloadOnce() {
  if (reloading) return;

  reloading = true;
  window.location.reload();
}

export function registerServiceWorker(): void {
  if (started || typeof window === "undefined") return;

  if (!("serviceWorker" in navigator)) return;

  // Dev serves un-hashed HTML from Vite; a cache in front of that turns every
  // edit into a mystery. Registration is a production-only concern.
  if (import.meta.env.DEV) return;

  // isSecureContext covers https and the local addresses browsers treat as
  // secure, without hard-coding hostnames.
  if (!window.isSecureContext) return;

  started = true;

  const register = () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        track(registration);

        // A worker that already finished installing before this page loaded.
        if (registration.waiting && navigator.serviceWorker.controller) {
          waiting = registration.waiting;
          announce();
        }
      })
      .catch(() => {
        // Registration only adds offline support; the app works without it.
        console.warn("Service worker registration failed; offline support is off.");
      });
  };

  // Hydration can happen after `load` on a fast page; waiting for an event that
  // already fired would silently skip registration for the whole session.
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Only a deliberate `applyUpdate` sets `reloading`; an unexpected takeover
    // still needs the new assets, so reload once.
    reloadOnce();
  });
}

function track(registration: ServiceWorkerRegistration) {
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;

    if (!installing) return;

    installing.addEventListener("statechange", () => {
      if (installing.state !== "installed") return;

      // No controller means this is the first install, not an update.
      if (!navigator.serviceWorker.controller) return;

      waiting = registration.waiting ?? installing;
      announce();
    });
  });

  // Check once per page load; a long match should still see new deployments.
  void registration.update().catch(() => {});
}

/** Swap in the waiting worker. The page reloads on `controllerchange`. */
export function applyUpdate(): void {
  if (!waiting) return;

  waiting.postMessage({ type: "SKIP_WAITING" });
  waiting = null;
  announce();
}

/** Test seam. */
export function resetUpdateForTests() {
  waiting = null;
  reloading = false;
  started = false;
  listeners.clear();
}
