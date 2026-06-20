/*
 * Freeport service worker — installability + Web Push.
 *
 * Push is content-blind: the sender (a relay watcher) only knows "you have a
 * new message", never the contents (DMs are NIP-04 encrypted). Tapping the
 * notification focuses/opens the app.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Minimal fetch handler so the app registers as an installable PWA. We don't
// cache app code here (the bundle is hash-versioned and served by Cloudflare);
// this just lets the SW qualify and stay out of the way.
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Freeport';
  const options = {
    body: data.body || 'You have a new message',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'freeport',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientsArr) {
        if ('focus' in client) {
          try { await client.navigate(url); } catch (_) {}
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
});
