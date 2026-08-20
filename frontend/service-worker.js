/* ===========================================================
   service-worker.js — Alfaaz
   Caches the app shell so the UI (and last-known song list) loads
   offline. Actual audio for offline playback is handled explicitly
   by the Downloads feature via IndexedDB, not by this cache.
   =========================================================== */

const CACHE_NAME = 'alfaaz-shell-v1';
const API_CACHE_NAME = 'alfaaz-api-v1';

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

  // Backend song list: network-first, falling back to last known cache when offline
  if (url.pathname.startsWith('/music/song_list/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(API_CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }
  // All other requests (audio/lyrics streaming, other API calls): network as normal.
});