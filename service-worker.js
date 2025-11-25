const CACHE_VERSION = 'v1';
const CACHE_NAME = `meditate-${CACHE_VERSION}`;
const SHELL_URLS = [
  '/',           // root (GitHub Pages serves index.html)
  'index.html',
  'playlist.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Pre-cache only the shell (do NOT pre-cache mp3s)
    try {
      await cache.addAll(SHELL_URLS.map(u => new Request(u, { cache: 'no-cache' })));
    } catch (e) {
      // best-effort: ignore failures (e.g., playlist.json might not exist)
      console.warn('SW: pre-cache shell failed', e);
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Delete old caches that don't match CACHE_NAME
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Fetch strategy:
// - GET requests only
// - For .mp3 files: try cache first, if not cached fetch from network, store fetched copy in cache (on-demand)
// - For navigation/html: network-first then fallback to cache
// - For other assets (playlist.json, css, icons): cache-first then network

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Handle mp3 requests: cache-first, but populate cache only when network fetch succeeds
  if (url.pathname.endsWith('.mp3')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      // Try cache first
      const cached = await cache.match(req);
      if (cached) return cached;

      // Not cached: try network, then cache the response for future offline use
      try {
        const fetched = await fetch(req);
        if (fetched && fetched.status === 200) {
          // Clone and store; ignore cache.put errors
          cache.put(req, fetched.clone()).catch(() => {});
        }
        return fetched;
      } catch (err) {
        // Network failed: return fallback if available, otherwise 404-like response
        return cached || new Response('', { status: 503, statusText: 'Service Unavailable' });
      }
    })());
    return;
  }

  // Navigation requests (HTML): network-first, fallback to cache
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith((async () => {
      try {
        const networkResp = await fetch(req);
        // Update cache with fresh copy of navigation/html response
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, networkResp.clone()).catch(()=>{});
        return networkResp;
      } catch (e) {
        const cached = await caches.match('index.html');
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Other requests (JSON, icons, css, etc): cache-first then network
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const response = await fetch(req);
      if (response && response.status === 200) {
        cache.put(req, response.clone()).catch(()=>{});
      }
      return response;
    } catch (e) {
      return cached || new Response(null, { status: 404 });
    }
  })());
});
