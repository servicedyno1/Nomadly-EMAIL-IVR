// CloudIVR service worker: ringing alerts (phones only show page notifications through a worker) and, for the
// installed app, an offline page when a CloudIVR screen can't load. Other pages on this host are never touched.
const CACHE = 'civr-offline-v1';
const OFFLINE = '/civr/offline.html';
const CIVR_HOST = /(^|\.)cloudivr\.net$/.test(self.location.hostname);
const isCivr = (path) => CIVR_HOST || /^\/cloudivr(\/|$)/.test(path);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)).catch(() => null).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('civr-offline-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.mode !== 'navigate' || !isCivr(new URL(req.url).pathname)) return;
  e.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((r) => r || Response.error())));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('/'))));
});
