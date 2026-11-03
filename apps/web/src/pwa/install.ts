/**
 * Installability state for the PWA (PWA.0).
 *
 * Browsers disagree about installation, so the app treats it as a small state
 * machine instead of a button: Chromium hands us a deferred prompt event, iOS
 * and macOS Safari have to be talked through a menu, and Firefox desktop has no
 * install path at all. Everything here is observable so the UI can hide itself
 * the moment the app already runs in its own window.
 */

export type InstallPlatform = "chromium" | "ios" | "macos-safari" | "unsupported";

/** A `beforeinstallprompt` event; only Chromium fires it, and only once. */
type DeferredPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export interface InstallState {
  /** A native prompt is waiting; the button can call `prompt()` directly. */
  canPrompt: boolean;
  /** Running inside an installed window (standalone, WCO, or iOS home screen). */
  standalone: boolean;
  /** `appinstalled` fired in this session, or standalone was already true. */
  installed: boolean;
  platform: InstallPlatform;
}

const UNSUPPORTED: InstallState = {
  canPrompt: false,
  standalone: false,
  installed: false,
  platform: "unsupported",
};

const listeners = new Set<() => void>();

let prompt: DeferredPrompt | null = null;

let state: InstallState = UNSUPPORTED;

let monitoring = false;

export const installPlatforms = ["chromium", "ios", "macos-safari", "unsupported"] as const;

/**
 * Which install story this browser has.
 *
 * iPadOS reports a desktop Mac user agent, so touch points are the only
 * reliable way to tell an iPad from a MacBook.
 */
export function detectPlatform(input: {
  userAgent: string;
  maxTouchPoints?: number;
  platform?: string;
  vendor?: string;
}): InstallPlatform {
  const ua = input.userAgent;

  const ipad =
    /iPad|iPhone|iPod/.test(ua) ||
    (input.platform === "MacIntel" && (input.maxTouchPoints ?? 0) > 1);

  if (ipad) return "ios";

  const chromium = /Chrome|Chromium|Edg\//.test(ua) || input.vendor === "Google Inc.";

  if (chromium) return "chromium";

  const safari = /Safari/.test(ua) && !/Firefox|FxiOS/.test(ua);

  if (safari && /Macintosh|Mac OS X/.test(ua)) return "macos-safari";

  // Firefox, desktop Safari on iOS, and everything else have no install entry.
  return safari ? "macos-safari" : "unsupported";
}

/** Standalone means the tab is gone: the app owns its window. */
export function detectStandalone(input: {
  displayModes?: readonly string[];
  navigatorStandalone?: boolean;
}): boolean {
  const modes = input.displayModes ?? [];

  if (modes.includes("standalone") || modes.includes("window-controls-overlay")) return true;

  return input.navigatorStandalone === true;
}

/**
 * Whether to show the install entry at all.
 *
 * Every platform except "unsupported" has *some* install path, even when no
 * prompt event arrives: Chromium exposes it in the address bar, Safari in a
 * menu. Hiding the entry because the event is missing would hide the only
 * instruction the user can act on.
 */
export function offersInstall(platform: InstallPlatform): boolean {
  return platform !== "unsupported";
}

function readWindow(): InstallState {
  if (typeof window === "undefined") return UNSUPPORTED;

  const nav = window.navigator;
  // SAFETY: `platform` is a deprecated-but-present string; the `in` check is
  // only there because TypeScript's Navigator type omits it.
  const navigatorPlatform = "platform" in nav ? (nav.platform as string | undefined) : undefined;

  const platform = detectPlatform({
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    platform: navigatorPlatform,
    vendor: nav.vendor,
  });

  const displayModes = ["standalone", "window-controls-overlay", "minimal-ui"].filter((mode) =>
    window.matchMedia(`(display-mode: ${mode})`).matches,
  );

  // SAFETY: `standalone` exists only on iOS Safari's navigator; no lib declares it.
  const iosStandalone = (nav as Navigator & { standalone?: boolean }).standalone;

  const standalone = detectStandalone({ displayModes, navigatorStandalone: iosStandalone });

  return {
    canPrompt: prompt !== null && !standalone,
    standalone,
    installed: standalone || state.installed,
    platform,
  };
}

function publish(next: InstallState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function refresh() {
  publish(readWindow());
}

/**
 * Start watching install signals.
 *
 * `beforeinstallprompt` can fire before React mounts, so the layout also stashes
 * it on `window.__llmgamesPwa`; this picks that up on the first read.
 */
export function watchInstall(): () => void {
  if (typeof window === "undefined" || monitoring) return () => {};

  monitoring = true;

  // SAFETY: the layout's inline script creates exactly this shape before hydration.
  const stash = window as Window & {
    __llmgamesPwa?: { prompt?: DeferredPrompt | null; installed?: boolean };
  };

  if (stash.__llmgamesPwa?.prompt) prompt = stash.__llmgamesPwa.prompt;

  if (stash.__llmgamesPwa?.installed) state = { ...state, installed: true };

  const onPrompt = (event: Event) => {
    event.preventDefault();

    // SAFETY: `beforeinstallprompt` is the only event with this shape; Chromium
    // defines `prompt()` and `userChoice` on it.
    prompt = event as DeferredPrompt;
    refresh();
  };

  const onInstalled = () => {
    prompt = null;
    publish({ ...readWindow(), canPrompt: false, installed: true });
  };

  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  window.addEventListener("llmgames:installable", refresh);

  const media = window.matchMedia("(display-mode: standalone)");
  const onDisplayMode = () => refresh();

  media.addEventListener("change", onDisplayMode);
  refresh();

  return () => {
    monitoring = false;
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
    window.removeEventListener("llmgames:installable", refresh);
    media.removeEventListener("change", onDisplayMode);
  };
}

export function getInstallState(): InstallState {
  return state;
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/** Ask the browser to install. Returns "unavailable" when no prompt was stored. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = prompt;

  if (!event) return "unavailable";

  // A deferred prompt is single-use: drop it before awaiting so a double click
  // cannot call prompt() twice.
  prompt = null;
  publish({ ...state, canPrompt: false });

  await event.prompt();

  const outcome = (await event.userChoice)?.outcome ?? "dismissed";

  if (outcome === "accepted") publish({ ...getInstallState(), installed: true, canPrompt: false });

  return outcome;
}

/** Test seam: reset module state between cases. */
export function resetInstallForTests(next: InstallState = UNSUPPORTED) {
  prompt = null;
  listeners.clear();
  monitoring = false;
  state = next;
}
