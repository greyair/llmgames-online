import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { useOnline } from "./connectivity";
import { isMatchActive, subscribeMatch } from "./matchGuard";
import { QUEUE_DROPPED_EVENT } from "./events";
import { applyUpdate, hasUpdate, registerServiceWorker, subscribeUpdate } from "./serviceWorker";
import "./pwa.css";

/**
 * Runtime chrome for the installed app: offline notice, reconnection note and
 * the "new version" offer.
 *
 * Mounted once in the layout and persisted across client-side navigation, so a
 * match never loses it mid-turn.
 */
export function PwaRuntime() {
  const online = useOnline();
  const t = useT();
  const [reconnected, setReconnected] = useState(false);
  const [dropped, setDropped] = useState(false);
  const wasOffline = useRef(!online);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  // A queued move that expired during a background stint is not replayed; say so
  // instead of letting the player believe it landed.
  useEffect(() => {
    let timer = 0;

    const onDropped = () => {
      setDropped(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setDropped(false), 6000);
    };

    window.addEventListener(QUEUE_DROPPED_EVENT, onDropped);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(QUEUE_DROPPED_EVENT, onDropped);
    };
  }, []);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;

      return;
    }

    if (!wasOffline.current) return;

    wasOffline.current = false;
    setReconnected(true);

    const timer = window.setTimeout(() => setReconnected(false), 3200);

    return () => window.clearTimeout(timer);
  }, [online]);

  return (
    <>
      {!online && (
        <div className="pwa-bar" data-tone="warning" role="status">
          <span>{t("pwa.offline")}</span>
          <span className="pwa-bar-actions">{t("pwa.offlineHint")}</span>
        </div>
      )}
      {online && reconnected && (
        <div className="pwa-bar" role="status">
          <span>{t("pwa.reconnected")}</span>
        </div>
      )}
      {dropped && (
        <div className="pwa-bar" data-tone="warning" role="status">
          <span>{t("pwa.staleActions")}</span>
          <span className="pwa-bar-actions">
            <Button size="sm" variant="ghost" onClick={() => setDropped(false)}>
              {t("pwa.close")}
            </Button>
          </span>
        </div>
      )}
      <UpdateChip />
    </>
  );
}

function UpdateChip() {
  const t = useT();
  const [ready, setReady] = useState(hasUpdate);
  const [hidden, setHidden] = useState(false);
  const inMatch = useSyncExternalStore(subscribeMatch, isMatchActive, () => false);

  useEffect(() => subscribeUpdate(() => setReady(hasUpdate())), []);

  if (!ready || hidden) return null;

  return (
    <div className="pwa-bar" role="status">
      <span>{inMatch ? t("pwa.updateDuringMatch") : t("pwa.updateReady")}</span>
      {/* During a match the offer is information only: reloading would drop the
          player out of a live, server-timed room. */}
      {!inMatch && (
        <span className="pwa-bar-actions">
          <Button size="sm" onClick={() => applyUpdate()}>
            {t("pwa.updateNow")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>
            {t("pwa.updateLater")}
          </Button>
        </span>
      )}
    </div>
  );
}
