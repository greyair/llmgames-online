/*
 * Offline support for llmgames (PWA.1).
 *
 * The board is server-owned, so the cache is only ever allowed to make the
 * *shell* faster and the *offline* case honest. Nothing here caches:
 *   - /api/*, /.well-known/*  (state, auth, MCP — must never be stale)
 *   - /room, /series          (a cached live room would hide a dead socket)
 *   - anything non-GET or cross-origin.
 *
 * Everything else follows the table in docs/PWA.md: hashed assets cache-first,
 * images stale-while-revalidate, HTML network-first with an offline fallback.
 */

const VERSION = "llmgames-v3";

const SHELL_CACHE = `${VERSION}-shell`;

const ASSET_CACHE = `${VERSION}-assets`;

const IMAGE_CACHE = `${VERSION}-images`;

const PRECACHE = [
  "/offline.html",
  "/site.webmanifest",
  "/llmgames-icon-192-v3.png",
  "/llmgames-mark-v5.svg",
  // The lobby shell, so the very first install can reopen without a network.
  "/play",
];

const IMAGE_LIMIT = 400;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // One missing file must not fail the whole install; the offline page is
      // the only entry that actually matters.
      .then((cache) => Promise.allSettled(PRECACHE.map((path) => cache.add(path))))
      .then(() => undefined),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE, IMAGE_CACHE]);
      const names = await caches.keys();

      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));

      // Take over open tabs so the first deploy after this one is live without
      // asking every visitor to close the app.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

const isNavigation = (request) => request.mode === "navigate";

const isLiveRoute = (pathname) => /^\/(room|series)(\/|$)/.test(pathname);

const isAsset = (pathname) => pathname.startsWith("/_astro/");

const isImage = (pathname) =>
  /\.(png|gif|jpg|jpeg|webp|avif|svg|ico)$/.test(pathname) || pathname.startsWith("/pokemon/");

async function put(cacheName, request, response) {
  if (!response || response.status !== 200 || response.type !== "basic") return response;

  const cache = await caches.open(cacheName);

  await cache.put(request, response.clone());

  return response;
}

async function fromCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);

  if (hit) return hit;

  return cacheName === SHELL_CACHE ? caches.match(request) : undefined;
}

async function cacheFirst(request, cacheName) {
  const hit = await fromCache(request, cacheName);

  if (hit) return hit;

  try {
    return await put(cacheName, request, await fetch(request));
  } catch {
    return Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const hit = await fromCache(request, cacheName);

  const revalidate = fetch(request)
    .then((response) => put(cacheName, request, response))
    .catch(() => undefined);

  if (hit) {
    // Trim in the background; images are the only unbounded cache.
    void revalidate.then(() => trim(cacheName));

    return hit;
  }

  const fresh = await revalidate;

  return fresh ?? Response.error();
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);

    // Misses are not worth keeping; a cached 404 would outlive the deploy.
    if (response.ok) await put(cacheName, request, response);

    return response;
  } catch {
    const hit = await fromCache(request, cacheName);

    return hit ?? Response.error();
  }
}

/** Keep the image cache bounded: a player can meet hundreds of species. */
async function trim(cacheName) {
  if (cacheName !== IMAGE_CACHE) return;

  const cache = await caches.open(cacheName);
  const keys = await cache.keys();

  if (keys.length <= IMAGE_LIMIT) return;

  await Promise.all(keys.slice(0, keys.length - IMAGE_LIMIT).map((key) => cache.delete(key)));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (url.pathname === "/sw.js") return;

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.well-known/")) return;

  if (isNavigation(request)) {
    // A live room must come from the network or not at all: serving a cached
    // room shell would look connected while every move fails.
    if (isLiveRoute(url.pathname)) {
      event.respondWith(fetch(request).catch(async () => (await caches.match("/offline.html")) ?? Response.error()));

      return;
    }

    event.respondWith(
      networkFirst(request, SHELL_CACHE).then(async (response) => {
        if (response.type !== "error" || response.status !== 0) return response;

        return (await caches.match("/offline.html")) ?? response;
      }),
    );

    return;
  }

  if (isAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));

    return;
  }

  if (isImage(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));

    return;
  }

  event.respondWith(networkFirst(request, ASSET_CACHE));
});
