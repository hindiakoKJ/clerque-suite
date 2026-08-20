/* eslint-disable no-restricted-globals */
/**
 * Clerque service worker — keeps the till usable through a connectivity drop.
 *
 * Why this exists: the POS queues offline sales in IndexedDB, but without a
 * service worker nothing was cached, so offline only survived inside a tab
 * that stayed open. A refresh, a tablet sleeping and evicting the tab, or a
 * browser restart during an outage left the cashier on a blank error page —
 * exactly the situation offline mode is for.
 *
 * Strategy, deliberately conservative:
 *   • navigations      → network-first, fall back to the cached copy of that
 *                        page, then to /offline. Online users therefore always
 *                        get fresh HTML; there is no stale-shell class of bug.
 *   • /_next/static/*  → cache-first. These filenames are content-hashed, so a
 *                        cached entry can never be the wrong version.
 *   • everything else  → straight to the network, never cached. In particular
 *                        API calls (a different origin) are untouched, so no
 *                        sale, price, or receipt is ever served from cache.
 *
 * Bump CACHE_VERSION to retire old caches on the next activation.
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `clerque-static-${CACHE_VERSION}`;
const PAGES_CACHE = `clerque-pages-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGES_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      // A failed precache must not block installation — the worker is still
      // useful for static assets and previously visited pages.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('clerque-') && k !== STATIC_CACHE && k !== PAGES_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Escape hatch: the page can tell the worker to remove itself. Without this a
 * broken worker is painful to clear from a tablet that is not in front of you.
 */
self.addEventListener('message', (event) => {
  if (event.data === 'CLERQUE_SW_UNREGISTER') {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith('clerque-')).map((k) => caches.delete(k))))
        .then(() => self.registration.unregister()),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only ever touch same-origin GETs. The API lives on another origin, so
  // this alone keeps every sale, price and receipt off the cache path.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Hashed build assets: safe to serve from cache indefinitely.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(request, copy)).catch(() => undefined);
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Cache only real, final pages — never a redirect (the auth
          // redirect to /login would otherwise be cached as the app itself).
          if (res && res.ok && res.type === 'basic' && !res.redirected) {
            const copy = res.clone();
            caches.open(PAGES_CACHE).then((c) => c.put(request, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() =>
          caches
            .match(request)
            .then((hit) => hit || caches.match(OFFLINE_URL))
            .then((hit) => hit || Response.error()),
        ),
    );
  }
});
