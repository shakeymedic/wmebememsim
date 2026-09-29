// The app's service worker (controller, room monitor, setup). See sw-shared.js.
// The build replaces the next two lines with the deploy's version and file list.
const VERSION = 'dev';
const PRECACHE = [];
importScripts('sw-shared.js');
self.installServiceWorker('app', VERSION, PRECACHE);
