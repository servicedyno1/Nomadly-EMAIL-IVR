// CloudIVR ringing alerts: phones (Android Chrome) only show page notifications through a service worker.
// No fetch handler — this worker never touches page requests.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('/'))));
});
