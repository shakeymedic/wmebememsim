// Shared service-worker logic for the app (sw.js) and the defib tablet (defib/sw.js).
//
// NETWORK FIRST: online, every request goes to the network and the fresh copy is also stored, so a
// device always runs the latest deploy; offline, the stored copy is used. (The old defib worker was
// cache-first, which kept tablets on a stale clinical device until its version was bumped by hand.)
// The build stamps each worker with a version and the list of files to store at install, so the
// app works offline from the first visit.
//
// Each worker only ever deletes its OWN old caches: both share this origin's cache storage, and
// the previous defib worker deleted every cache that was not its own.
/* global self, caches, fetch, Response */
self.installServiceWorker = function (name, version, precache) {
  var PREFIX = 'emsim-' + name + '-';
  var CACHE = PREFIX + version;
  var LEGACY = /^wmebem-sim-v\d+$/;          // the old cache-first defib worker's caches

  self.addEventListener('install', function (e) {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE).then(function (cache) {
      // One missing file must not stop the rest being stored.
      return Promise.all(precache.map(function (url) { return cache.add(url).catch(function () {}); }));
    }));
  });

  self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return (k.indexOf(PREFIX) === 0 && k !== CACHE) || LEGACY.test(k);
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
  });

  self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;
    var url = new URL(req.url);
    // Only this site's own files. Never the live session (Firebase long-polls with GETs when
    // WebSockets are blocked, and a cached answer would freeze a device on a stale patient).
    if (url.origin !== self.location.origin) return;
    e.respondWith(fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('index.html', { ignoreSearch: true });
        return new Response('Offline, and this file has not been stored yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      });
    }));
  });
};
