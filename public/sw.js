// ─── DataFlow Service Worker ───
// Network-first for API, cache-first for static assets, update notification.

const CACHE_VERSION = 'v1-20260406';
const CACHE_NAME = 'dataflow-' + CACHE_VERSION;

const STATIC_ASSETS = [
  '/',
  '/styles.css',
  '/app.js',
  '/js/utils.js',
  '/js/api.js',
  '/store.js',
  '/manifest.json',
];

// Install: cache critical static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => {
        self.clients.matchAll().then(clients => {
          clients.forEach(c => c.postMessage({ type: 'sw-update-available' }));
        });
      })
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.map(name => {
        if (name !== CACHE_NAME) return caches.delete(name);
      }))
    ).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', event => {
  var request = event.request;

  // Skip cross-origin requests
  if (!request.url.startsWith(self.location.origin)) return;

  // API calls: network-first, notify on offline mutation failures
  if (request.url.includes('/api/')) {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
      event.respondWith(
        fetch(request).catch(() => {
          self.clients.matchAll().then(cls => {
            cls.forEach(c => c.postMessage({
              type: 'mutation-failed',
              method: request.method,
              url: request.url,
            }));
          });
          return new Response(JSON.stringify({ error: 'Offline — please retry' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        })
      );
      return;
    }
    // GET API: network only (don't cache dynamic data)
    return;
  }

  // Static assets: network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          var cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, cloned));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(cached => {
          if (cached) return cached;
          if (request.destination === 'document') return caches.match('/');
        })
      )
  );
});
