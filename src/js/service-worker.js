/* ==========================================================================
   Alfaaz · service-worker.js
   Caches the app shell so the SPA (and IndexedDB-backed downloads) can be
   opened and navigated with no network connection at all.
   ========================================================================== */

const CACHE_NAME = "alfaaz-shell-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./api.js",
  "./manifest.json",
  "./assets/logo/logo.svg",
  "./assets/images/album-placeholder.svg",
  "./assets/images/artist-placeholder.svg",
  "./assets/icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // App shell: cache-first, so the SPA opens instantly and works offline.
  if (isSameOrigin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
          .catch(() => (request.mode === "navigate" ? caches.match("./index.html") : undefined));
      })
    );
    return;
  }

  // Cross-origin (backend API / audio): network-first, falling back to
  // cache when offline. Actual offline playback is served from IndexedDB
  // by app.js, not from this cache — this is just a safety net.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request))
  );
});
