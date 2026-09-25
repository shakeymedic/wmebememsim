// defib/sw.js
// Bump this cache version on every deploy so tablets do not retain an old simulator build.
// WAVE 4b / D7 — bumped so tablets cannot keep serving a pre-Wave-4b build from cache. This SW is
// cache-FIRST, so a stale cache means a stale clinical device: without this bump a tablet would keep
// running the old defibrillator page (with the dead GHOST_PRESS receiver) and, worse, an old
// ../data/engine.js without the Quick Sim, runId and pupil-guard changes, against a controller that
// has them. Bump this on EVERY deploy.
const CACHE_NAME = 'wmebem-sim-v28';
const ASSETS_TO_CACHE = [
  './index.html',
  './manifest.json',
  './images/logo.png',
  '../index.html',
  '../data/rhythms.js',
  '../data/firebase-config.js',
  '../data/engine.js',
  '../data/scenarios.js',
  '../data/components.js',
  '../data/interventions.js',
  '../data/generators.js',
  // WAVE 4b: the auth/entitlements module. Cached so the Restricted section degrades identically
  // offline (locked, with a message) instead of throwing on a missing script.
  '../data/auth.js',
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
  // Never cache the live session: Firebase falls back to long-polling GETs when WebSockets are
  // blocked, and serving those from cache would freeze the device on a stale patient.
  const host = new URL(e.request.url).hostname;
  if (/firebaseio\.com$|firebasedatabase\.app$|googleapis\.com$/.test(host)) return;
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
