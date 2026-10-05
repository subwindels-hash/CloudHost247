/**
 * CloudHost247 service worker — makes the public site installable and usable offline.
 *
 * Strategy by request type:
 *   - Static shell (HTML/CSS/JS/icons): cache-first with background refresh, so the site opens
 *     instantly offline and self-updates when online.
 *   - API (/api/*): network-first with a short-lived cache fallback for GETs, so account data is
 *     never served stale beyond the current offline session.
 *   - POST/PUT/PATCH/DELETE: always pass through to the network untouched.
 *
 * The SPA shell is served by the backend at /app; it is cached opportunistically on first visit.
 */

const VERSION = 'v1';
const SHELL_CACHE = `ch247-shell-${VERSION}`;
const DATA_CACHE = `ch247-data-${VERSION}`;

const PRECACHE = [
  '/',
  '/web-hosting.html',
  '/vps-hosting.html',
  '/domains.html',
  '/login.html',
  '/register.html',
  '/assets/css/site.css',
  '/assets/js/site.js',
  '/assets/js/api.js',
  '/assets/js/auth-forms.js',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // mutations always go to the network

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, DATA_CACHE, 5 * 60 * 1000));
    return;
  }

  if (request.mode === 'navigate') {
    // Navigation requests: network-first, falling back to the cached shell when offline.
    event.respondWith(networkFirst(request, SHELL_CACHE, 24 * 60 * 60 * 1000));
    return;
  }

  // Static assets: cache-first with background refresh.
  event.respondWith(cacheFirst(request, SHELL_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) {
    // Refresh in the background so the next visit gets the new version.
    event_refresh(cache, request);
    return hit;
  }
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirst(request, cacheName, ttlMs) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      copy.headers.set('sw-cached-at', String(Date.now()));
      await cache.put(request, copy);
    }
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) {
      const cachedAt = Number(hit.headers.get('sw-cached-at') ?? 0);
      // Only serve cached data if it is fresh enough; otherwise fall through to the shell.
      if (Date.now() - cachedAt < ttlMs) return hit;
    }
    // Offline navigation falls back to the app shell rather than a blank error.
    if (request.mode === 'navigate') {
      const shell = await cache.match('/');
      if (shell) return shell;
    }
    return new Response(JSON.stringify({ error: 'OFFLINE', message: 'You are offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function event_refresh(cache, request) {
  try {
    const fresh = await fetch(request);
    if (fresh.ok) await cache.put(request, fresh);
  } catch {
    // Offline refresh silently ignored.
  }
}
