/* SafeSips service worker — generated at build time from web/sw.template.js
 * by the offline-precache plugin in vite.config.ts. Do not edit dist/sw.js.
 *
 * Goal: the spiking first-aid page (/help) must open with no connection.
 *  - On install, precache the app shell plus every file /help needs (entry
 *    chunk, the lazy FirstAidPage chunk and their imports, CSS, Latin fonts).
 *  - Navigations: network first (always fresh when online), falling back to
 *    the cached shell offline, so client-side routes like /help still render.
 *  - Hashed /assets/* files: cache first (they never change), cached as used.
 *  - Cross-origin requests (the API, map tiles, Clerk) are never touched.
 */
const BUILD_ID = "__BUILD_ID__";
const PRECACHE_URLS = __PRECACHE_URLS__;

const SHELL_CACHE = `safesips-shell-${BUILD_ID}`;
const ASSET_CACHE = "safesips-assets";
const MAX_RUNTIME_ASSETS = 80;
// Hosts send `Vary: Origin`; module scripts carry an Origin header that the
// precache requests didn't, so without this every lookup misses and assets get
// cached twice. Safe here: we only handle same-origin static files.
const MATCH = { ignoreVary: true };

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // No skipWaiting(): an open tab keeps the worker (and assets) it loaded with,
  // so a deploy can't strand it with chunks that no longer exist.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith("safesips-") && !keep.has(name)) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })()
  );
});

async function trimAssets() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_RUNTIME_ASSETS; i++) {
    await cache.delete(keys[i]);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            // Every route serves the same SPA shell; keep it current.
            const cache = await caches.open(SHELL_CACHE);
            await cache.put("/", fresh.clone());
          }
          return fresh;
        } catch {
          return (
            (await caches.match(request, MATCH)) ||
            (await caches.match("/", MATCH)) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, MATCH);
        if (cached) return cached;
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(ASSET_CACHE);
          await cache.put(request, fresh.clone());
          void trimAssets();
        }
        return fresh;
      })()
    );
    return;
  }

  // Icons, manifest: serve from cache when offline.
  event.respondWith(
    fetch(request).catch(async () => (await caches.match(request, MATCH)) || Response.error())
  );
});
