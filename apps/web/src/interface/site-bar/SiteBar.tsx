import { useEffect, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { getCurrentUser, logout, peekCurrentUser, type User } from "@/services/auth";
import { useBrowserHref } from "@/lib/navigate";
import { SiteBrand } from "./SiteBrand";
import { SiteNav } from "./SiteNav";
import { SiteAccount, SiteTools } from "./SiteAccount";
import { activeFromPath, guestLinks, memberLinks, operatorLinks } from "./navigation";

function subscribeSession(onChange: () => void) {
  window.addEventListener("llmgames:session", onChange);

  return () => window.removeEventListener("llmgames:session", onChange);
}

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const sync = () => setScrolled(window.scrollY > 8);
    sync();
    window.addEventListener("scroll", sync, { passive: true });

    return () => window.removeEventListener("scroll", sync);
  }, []);

  return scrolled;
}

/** The path the client router is heading to, from the moment a navigation starts until the new page is swapped in.
    Marking it current right away lets the nav pill travel while the next page loads, instead of after it arrives. */
function usePendingPath() {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    const start = (event: Event) => {
      const to = "to" in event && event.to instanceof URL ? event.to : undefined;
      setPending(to && to.origin === location.origin ? to.pathname : null);
    };

    const settle = () => setPending(null);
    document.addEventListener("astro:before-preparation", start);
    document.addEventListener("astro:after-swap", settle);
    document.addEventListener("astro:page-load", settle);

    return () => {
      document.removeEventListener("astro:before-preparation", start);
      document.removeEventListener("astro:after-swap", settle);
      document.removeEventListener("astro:page-load", settle);
    };
  }, []);

  return pending;
}

// Pages render their own <main> (some inside client-only islands), so find it at click time rather than relying on an id.
function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
  const main = document.querySelector<HTMLElement>("main");

  if (!main) return;
  event.preventDefault();

  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  main.focus({ preventScroll: true });
  main.scrollIntoView({ block: "start" });
}

export type SiteBarProps = {
  active?: string;
  actions?: ReactNode;
  operator?: boolean;
  authenticated?: boolean;
  user?: User;
  serverPath?: string;
};

export function SiteBar({
  active,
  actions,
  operator = false,
  authenticated,
  user,
  serverPath,
}: SiteBarProps) {
  const browserPath = useBrowserHref().split("?")[0] || "/";
  const pendingPath = usePendingPath();
  // The server has no location; without its request path, SSR marks Home current and hydration keeps that attribute.
  const path = typeof window === "undefined" && serverPath ? serverPath : browserPath;
  const cached = useSyncExternalStore(subscribeSession, peekCurrentUser, () => undefined);
  const [confirmed, setConfirmed] = useState<User | null | undefined>(undefined);

  const session =
    user ??
    (operator || authenticated === false ? null : confirmed !== undefined ? confirmed : cached);

  const [signingOut, setSigningOut] = useState(false),
    [signOutError, setSignOutError] = useState("");

  const scrolled = useScrolled();
  useEffect(() => {
    if (authenticated !== undefined || user || operator) return;
    let current = true;

    const load = () => {
      getCurrentUser()
        .then((found) => {
          if (current) setConfirmed(found);
        })
        .catch(() => {
          if (current && peekCurrentUser() === undefined) setConfirmed(null);
        });
    };

    load();
    window.addEventListener("llmgames:session", load);

    return () => {
      current = false;
      window.removeEventListener("llmgames:session", load);
    };
  }, [authenticated, user, operator]);

  const status =
    user || authenticated === true || session
      ? "in"
      : authenticated === false || session === null || operator
        ? "out"
        : "pending";

  const isSignedIn = status === "in";
  const current = active ?? activeFromPath(path);

  async function signOut() {
    setSigningOut(true);
    setSignOutError("");

    try {
      await logout(
        location.pathname.startsWith("/design-preview") ? "/design-preview/public/landing" : "/",
      );
    } catch (error) {
      setSignOutError(
        error instanceof Error ? error.message : "Could not sign out. Please try again.",
      );
      setSigningOut(false);
    }
  }

  const links = operator ? operatorLinks : isSignedIn ? memberLinks : guestLinks;
  const navId = (id: string) => (!isSignedIn && id === "play" ? "home" : id);
  const currentId = navId(current);
  // aria-current waits for the new page; only the pill moves ahead of it.
  const highlightId = pendingPath && !active ? navId(activeFromPath(pendingPath)) : currentId;

  return (
    <div className="site-bar-slot" data-dither-touch="off">
      <a className="site-skip" href="#main" onClick={skipToContent}>
        Skip to content
      </a>
      <header className="site-bar" data-scrolled={scrolled || undefined}>
        <div className="site-bar-inner">
          <SiteBrand href={isSignedIn ? "/play" : "/"} />
          <SiteNav links={links} current={currentId} highlight={highlightId} variant="bar" />
          <div className="site-controls">
            <SiteTools />
            <SiteAccount
              status={status}
              gamertag={(user ?? session)?.gamertag}
              profileCurrent={current === "account"}
              actions={actions}
              signingOut={signingOut}
              onSignOut={signOut}
            />
            {signOutError && (
              <span role="alert" className="site-signout-error">
                {signOutError}
              </span>
            )}
          </div>
        </div>
      </header>
      {links.length > 1 && (
        <SiteNav links={links} current={currentId} highlight={highlightId} variant="dock" />
      )}
    </div>
  );
}
