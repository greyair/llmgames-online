import { useSyncExternalStore, type ReactNode } from "react";
import type { User } from "@/services/auth";
import { SiteBar } from "./site-bar/SiteBar";

export { SiteBar } from "./site-bar/SiteBar";

export { Logo, LogoMark } from "./site-bar/SiteBrand";

function layoutOwnsBar() {
  return typeof document !== "undefined" && document.body.hasAttribute("data-app-shell");
}

function defaultShowBar(operator: boolean) {
  if (operator) return true;

  if (layoutOwnsBar()) return false;

  return typeof location !== "undefined" && location.pathname.startsWith("/design-preview");
}

function subscribeLayoutBar(onChange: () => void) {
  document.addEventListener("astro:after-swap", onChange);
  document.addEventListener("astro:page-load", onChange);

  return () => {
    document.removeEventListener("astro:after-swap", onChange);
    document.removeEventListener("astro:page-load", onChange);
  };
}

export function Chrome({
  children,
  active,
  actions,
  operator = false,
  authenticated,
  user,
  bar,
  fitViewport = false,
}: {
  children: ReactNode;
  active?: string;
  actions?: ReactNode;
  operator?: boolean;
  authenticated?: boolean;
  user?: User;
  bar?: boolean;
  fitViewport?: boolean;
}) {
  const defaultBar = useSyncExternalStore(
    subscribeLayoutBar,
    () => defaultShowBar(operator),
    () => operator,
  );

  const showBar = bar ?? defaultBar;

  const content = (
    <>
      {showBar && (
        <SiteBar
          active={active}
          actions={actions}
          operator={operator}
          authenticated={authenticated}
          user={user}
        />
      )}
      <main
        id="main"
        tabIndex={-1}
        className="site-content"
        data-preview-ready={defaultBar || undefined}
      >
        {children}
      </main>
    </>
  );

  return fitViewport ? <div className="site-viewport">{content}</div> : content;
}
