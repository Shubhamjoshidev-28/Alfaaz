/* ===========================================================
   service-worker.js — Alfaaz
   Caches the app shell so the UI (and last-known song list) loads
   offline. Actual audio for offline playback is handled explicitly
   by the Downloads feature via IndexedDB, not by this cache.
   =========================================================== */

const CACHE_NAME = 'alfaaz-shell-v1';
const API_CACHE_NAME = 'alfaaz-api-v2';
const API_ORIGIN = 'https://80.225.231.54';

const SHELL_FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/api.js',
  './js/app.js',
  './manifest.json',
  './assets/logo/Alfaaz_logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        SHELL_FILES.map((file) => cache.add(file).catch(() => { /* logo may not exist yet — ignore */ }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME && key !== API_CACHE_NAME)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // App shell: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        return res;
      }).catch(() => cached))
    );
    return;
  }

  // Backend song list: network-first, with a valid offline fallback.
  // Match the exact API origin so unrelated hosts with the same path are ignored.
  if (url.origin === API_ORIGIN && url.pathname.startsWith('/music/song_list/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE_NAME)
              .then((cache) => cache.put(req, clone))
              .catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;

          // A fetch handler must always resolve to a Response, never undefined.
          return new Response(
            JSON.stringify({
              success: false,
              message: 'The API is unavailable and no cached song list exists.'
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json; charset=utf-8' }
            }
          );
        })
    );
    return;
  }
  // All other requests (audio/lyrics streaming, other API calls): network as normal.
});