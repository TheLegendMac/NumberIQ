/**
 * NumberIQ service worker.
 *
 * Two caching strategies, chosen per resource type:
 *
 *  - App shell and build assets: cache-first. They are content-hashed, so a
 *    cached copy is never stale, and this is what makes the installed app open
 *    instantly and work with no connection.
 *
 *  - API responses: network-first with a cache fallback. Drawing history is
 *    append-only and safe to serve stale when offline; tickets and settings must
 *    never be served stale when the network is available, or you would see a
 *    budget or net position that isn't real.
 *
 * Mutations are never cached or replayed — a queued POST could double-save a
 * ticket, which would silently corrupt spending totals.
 */
const VERSION = 'numberiq-v1';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;

const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;              // never cache mutations
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Tickets, tracker and settings must reflect reality when online.
    const cacheable = url.pathname.startsWith('/api/draws')
      || url.pathname.startsWith('/api/games');

    event.respondWith(
      fetch(request)
        .then((res) => {
          if (cacheable && res.ok) {
            const copy = res.clone();
            caches.open(DATA).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(request);
          if (hit) return hit;
          return new Response(
            JSON.stringify({ error: 'offline', message: 'You are offline and this data has not been cached yet.' }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          );
        }),
    );
    return;
  }

  // Build assets are content-hashed, so a cache hit is always correct.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (res.ok && (url.pathname.startsWith('/assets/') || SHELL_URLS.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => caches.match('/index.html'));
    }),
  );
});
