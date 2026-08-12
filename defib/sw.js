// defib/sw.js
// Bump this cache version on every deploy so tablets do not retain an old simulator build.
const CACHE_NAME = 'wmebem-sim-v19';
const ASSETS_TO_CACHE = [
  './index.html',
  './manifest.json',
  './images/logo.png',
  '../index.html',
  '../data/engine.js',
  '../data/scenarios.js',
  '../data/components.js',
  '../data/interventions.js',
  '../data/generators.js',
  '../data/screens/index.js',
  '../data/screens/setup.js',
  '../data/screens/monitor.js',
  '../data/screens/livesim.js',
  '../data/screens/debrief.js',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://unpkg.com/lucide@latest'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => console.log('Cache warn:', err));
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Cache Storage only accepts GET requests. Let form/API writes use the browser normally.
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      const fetchPromise = fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, networkResponse.clone());
            return networkResponse;
          });
        }
        return networkResponse;
      });
      return cachedResponse || fetchPromise;
    }).catch(() => caches.match('./index.html').then((fallback) => fallback || new Response('Offline — simulator is not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } })))
  );
});
