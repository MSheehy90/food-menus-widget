/* Offline-first service worker for Food Menus PWA */
const CACHE = 'food-menus-v21';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/stars.js',
  './js/five-star.js',
  './js/config.js',
  './js/sync.js',
  './js/process.js',
  './js/drive-save.js',
  './fonts/figtree.css',
  './fonts/figtree-0.woff2',
  './fonts/figtree-1.woff2',
  './fonts/figtree-2.woff2',
  './fonts/figtree-3.woff2',
  './fonts/figtree-4.woff2',
  './fonts/figtree-5.woff2',
  './fonts/figtree-6.woff2',
  './fonts/figtree-7.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './data/catalog.json',
  './data/process-catalog.json',
  './data/dish-star-scoring.csv',
  './data/restaurant-menus-v1.json',
  './data/food-master-v2.json',
  './data/five-star-art.json',
  './data/art-files.txt'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // Precache shell; ingredient art is cached on first use.
      await cache.addAll(PRECACHE);
      const artReq = await fetch('./data/catalog.json').then((r) => r.json()).catch(() => null);
      if (artReq?.ingredients) {
        const urls = [...new Set(artReq.ingredients.map((i) => i.art).filter(Boolean))];
        await Promise.all(urls.map((u) => cache.add(u).catch(() => null)));
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
