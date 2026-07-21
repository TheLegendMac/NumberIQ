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
const VERSION = 'numberiq-v2';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;

// Precached for offline boot only — the document is still fetched network-first
// on every navigation, so these are a fallback, never the source of truth.
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

  // Content-hashed build assets: cache-first. The hash guarantees a hit is correct.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit ?? fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy));
        }
        return res;
      })),
    );
    return;
  }

  /**
   * The HTML document is network-first, and this is load-bearing.
   *
   * index.html names the content-hashed bundles. Serving it cache-first would
   * pin anyone who has visited once to that build forever — every future deploy
   * would be invisible to them until the cache name changed. Cache-first is
   * correct for hashed assets and actively wrong for the document that points
   * at them.
   */
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(request)) ?? (await caches.match('/index.html')) ??
        new Response('You are offline.', { status: 503, headers: { 'content-type': 'text/plain' } })),
  );
});
