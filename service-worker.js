const CACHE_NAME = 'style-studio-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './cloud.js',
  './outfits.js',
  './taxonomy.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Only manage the app's own files. Firebase/Firestore/gstatic requests (auth,
  // sync, SDK CDN) and the Open-Meteo forecast must go straight to the network
  // unintercepted — Firestore's live connections and offline queue manage
  // themselves, and a cached forecast is worse than none.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  // Network-first: whenever online, serve the freshest deployed code and refresh
  // the cache from it. Only fall back to cache when the network fails, so
  // offline use works but a live connection never shows a stale version.
  //
  // cache: 'reload' bypasses the browser's own HTTP cache as well as ours.
  // GitHub Pages serves with max-age=600, so without this a deploy takes up to
  // ten minutes to reach the phone however hard you refresh — and you end up
  // debugging code that is no longer running. (Learned the hard way in
  // couch-to-novel; don't remove it.)
  event.respondWith(
    fetch(event.request.url, { cache: 'reload' })
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
