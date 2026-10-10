import { isFunction, isString } from "@llmgames/game-catalog";

import { useEffect, useState } from "react";

const NAV_EVENT = "llmgames:navigate";

function currentHref(): string {
  return typeof location === "undefined" ? "/" : `${location.pathname}${location.search}`;
}

function hrefFrom(value: string): string {
  const url = new URL(
    value,
    typeof location === "undefined" ? "https://llmgames.local" : location.origin,
  );

  return `${url.pathname}${url.search}`;
}

function notify(href?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NAV_EVENT, { detail: href ?? currentHref() }));
}

if (typeof history !== "undefined" && !history.llmgamesPatched) {
  history.llmgamesPatched = true;
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (data, unused, url) => {
    const result = push(data, unused, url);
    notify();

    return result;
  };

  history.replaceState = (data, unused, url) => {
    const result = replace(data, unused, url);
    notify();

    return result;
  };
}

export function go(path: string, historyMode: "push" | "replace" = "push"): void {
  const url = new URL(path, location.origin);

  if (url.origin !== location.origin) {
    location.assign(url.href);

    return;
  }

  const href = `${url.pathname}${url.search}${url.hash}`;
  const nav = window.llmgamesNavigate;

  if (isFunction(nav)) {
    // History and Astro page events notify subscribers once the URL changes.
    // An early notification unmounts the room while location still points to it,
    // allowing an intervening page event to remount and rejoin the old room.
    nav(href, { history: historyMode });

    return;
  }

  if (historyMode === "replace") location.replace(href);
  else location.assign(href);
}

export function useBrowserHref(): string {
  const [href, setHref] = useState(currentHref);
  useEffect(() => {
    const sync = (event?: Event) => {
      if (event instanceof CustomEvent && isString(event.detail)) {
        setHref(hrefFrom(event.detail));

        return;
      }

      setHref(currentHref());
    };

    document.addEventListener("astro:page-load", sync);
    document.addEventListener("astro:after-swap", sync);
    window.addEventListener("popstate", sync);
    window.addEventListener(NAV_EVENT, sync);

    return () => {
      document.removeEventListener("astro:page-load", sync);
      document.removeEventListener("astro:after-swap", sync);
      window.removeEventListener("popstate", sync);
      window.removeEventListener(NAV_EVENT, sync);
    };
  }, []);

  return href;
}
