// defib/sw.js
const CACHE_NAME = 'wmebem-sim-v18';
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
  // Corrected: specific screen files instead of missing screens.js
  '../data/screens/index.js',
  '../data/screens/setup.js',
  '../data/screens/monitor.js',
  '../data/screens/livesim.js',
  '../data/screens/debrief.js',
  // External dependencies
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@17/umd/react.development.js',
  'https://unpkg.com/react-dom@17/umd/react-dom.development.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://unpkg.com/lucide@latest'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // We try to cache, but don't fail if external CDNs block CORS opaque responses
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
  // Stale-while-revalidate strategy
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      const fetchPromise = fetch(e.request).then((networkResponse) => {
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, networkResponse.clone());
        });
        return networkResponse;
      });
      return cachedResponse || fetchPromise;
    })
  );
});
