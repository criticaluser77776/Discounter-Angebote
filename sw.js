// Service Worker: App-Gerüst aus dem Cache, API-Daten "network first" mit Offline-Fallback.
// Pfade relativ zum Ort des Service Workers, damit die App auch unter …github.io/<repo>/ läuft.
const SHELL = 'shell-v3';
const DATA = 'data-v1';
const BASE = new URL('./', self.location).pathname;
const SHELL_FILES = ['./', 'index.html', 'app.js', 'cloud.js', 'list.js', 'config.js', 'style.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith(BASE + 'api/')) {
    if (url.pathname === BASE + 'api/status') return;  // immer live
    e.respondWith(fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(DATA).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request)));
    return;
  }
  // Gerüst: erst Netz (damit Updates sofort da sind), sonst Cache
  e.respondWith(fetch(e.request)
    .then(r => { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match(BASE))));
});
