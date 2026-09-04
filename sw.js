/* Offline-first service worker for Food Menus PWA */
const CACHE = 'food-menus-v33';
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
      await Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => null)));
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

function isShellData(url) {
  try {
    const p = new URL(url).pathname;
    return /\.(json|txt|js|css)$/i.test(p) || /\/sw\.js$/i.test(p);
  } catch {
    return false;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const networkFirst = isShellData(req.url);
  event.respondWith(
    (networkFirst ? fetch(req) : caches.match(req)).then((first) => {
      if (networkFirst) {
        if (first && first.ok) {
          const copy = first.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return first;
        }
        return caches.match(req).then((cached) => cached || first);
      }
      const fetched = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => first);
      return first || fetched;
    }).catch(() => caches.match(req))
  );
});
