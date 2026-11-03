import { useEffect, useSyncExternalStore } from "react";

import { getInstallState, subscribeInstall, watchInstall, type InstallState } from "./install";

/** A stable snapshot for SSR: nothing is installable until a browser says so. */
const SERVER_STATE: InstallState = {
  canPrompt: false,
  standalone: false,
  installed: false,
  platform: "unsupported",
};

/**
 * Subscribe to installability.
 *
 * The store lives outside React because `beforeinstallprompt` can fire before
 * the first component mounts; watching from an effect would then always read an
 * empty state and hide the button on browsers that do support installs.
 */
export function useInstallState(): InstallState {
  useEffect(() => watchInstall(), []);

  return useSyncExternalStore(subscribeInstall, getInstallState, () => SERVER_STATE);
}
