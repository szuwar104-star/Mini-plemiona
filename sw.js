/* Service Worker Mini Plemiona: tryb offline. Po zmianie plików gry podnieś wersję CACHE. */
const CACHE = 'mini-plemiona-v73';
const FILES = ['./', 'index.html', 'style.css', 'theme-medieval.css', 'manifest.json', 'config.js', 'engine.js', 'diplomacy.js', 'ai.js', 'pilot.js', 'database.js', 'cloud.js',
  'sprites.js', 'art.js', 'map.js', 'ui.js', 'game.js',
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png', 'assets/favicon.png',
  'assets/fonts/alegreya-latin-700-normal.woff2', 'assets/fonts/alegreya-latin-ext-700-normal.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Najpierw sieć (nowe pliki od razu), a bez sieci – kopia z pamięci podręcznej.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).pathname.startsWith('/api/')) return; // synchronizacja: zawsze prosto z sieci
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && new URL(e.request.url).origin === location.origin) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
