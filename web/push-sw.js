/* Количка — push service worker.
   Intentionally has NO fetch handler, so it never caches or intercepts page
   loads — it only receives push messages and handles notification clicks.
   This lets the OS wake it to show a notification while the phone is asleep /
   the browser is closed. */
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) {}
  const title = d.title || 'Количка';
  const opts = {
    body: d.body || '',
    icon: d.icon || '/favicon-192.png',
    badge: '/favicon-32.png',
    tag: d.tag || 'kolichka-deal',
    renotify: true,
    data: { url: d.url || '/v2.html' },
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/v2.html';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('/v2.html') && 'focus' in c) { try { await c.navigate(url); } catch (_) {} return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
