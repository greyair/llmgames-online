import { gameRoute, getGame } from "./interface/catalog";
import { LoadingPanel } from "./components/ui/loading-panel";
import { useBrowserHref } from "./lib/navigate";
import { lazy, Suspense, useEffect, type ReactNode } from "react";

const Series = lazy(() => import("./interface/Series").then(({ Series }) => ({ default: Series })));

const Archive = lazy(() =>
  import("./interface/Archive").then(({ Archive }) => ({ default: Archive })),
);

const Room = lazy(() => import("./interface/Room").then(({ Room }) => ({ default: Room })));

const Account = lazy(() =>
  import("./interface/Account").then(({ Account }) => ({ default: Account })),
);

const Library = lazy(() =>
  import("./interface/Library").then(({ Library }) => ({ default: Library })),
);

export default function App() {
  useEffect(() => {
    try {
      const replayKeys = Array.from({ length: localStorage.length }, (_, index) =>
        localStorage.key(index),
      ).filter((key): key is string => key !== null && key.startsWith("llmgames-rewatch:"));

      replayKeys.forEach((key) => localStorage.removeItem(key));
    } catch {
      /* Browser storage is optional. */
    }
  }, []);
  const href = useBrowserHref();
  const pathname = href.split("?")[0] || "/";
  const routeGame = getGame(pathname.slice(1));
  useEffect(() => {
    if (routeGame && pathname !== gameRoute(routeGame.id))
      history.replaceState(null, "", gameRoute(routeGame.id) + href.slice(pathname.length));
  }, [href, pathname, routeGame]);

  let page: ReactNode;

  if (pathname === "/agent-log") page = <Archive kind="agents" />;
  else if (pathname === "/history") page = <Archive kind="history" />;
  else if (["/login", "/profile", "/onboarding"].includes(pathname))
    page = <Account key={pathname} />;
  else if (pathname === "/series") page = <Series />;
  else if (pathname === "/play") page = <Library />;
  else page = routeGame ? <Room key={routeGame.id} gameType={routeGame.id} /> : null;

  return (
    <Suspense
      fallback={
        <main className="site-content">
          <LoadingPanel label="Loading page…" />
        </main>
      }
    >
      {page}
    </Suspense>
  );
}
