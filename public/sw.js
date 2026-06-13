// Running Coach Service Worker.
// Bump CACHE_NAME on any meaningful client-side dep change (new lib added,
// new chunk hashes change behaviour, prior bundle ships a stale renderer).
// The activate handler below deletes any cache with a name that DOESN'T
// match the current — so bumping forces every installed PWA to drop its
// pre-bump cached JS on next page open.
const CACHE_NAME = 'running-coach-v2-gfm';
const OFFLINE_URL = '/offline';

// Assets to cache on install
const STATIC_ASSETS = [
  '/coach',
  '/coach/log',
  '/coach/plan',
  '/coach/ask',
  '/coach/review',
  '/coach/settings',
  '/offline',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.log('[SW] Some assets failed to cache:', err);
      });
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Take control immediately
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests (except for fonts and images)
  if (url.origin !== location.origin) {
    // Allow caching of Google Fonts
    if (!url.hostname.includes('fonts.googleapis.com') &&
        !url.hostname.includes('fonts.gstatic.com')) {
      return;
    }
  }

  // Skip API requests - always go to network
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Skip auth-related requests
  if (url.pathname.includes('auth') || url.pathname.includes('callback')) {
    return;
  }

  // For coach pages - network first, cache fallback
  if (url.pathname.startsWith('/coach')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone the response before caching
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return offline page if no cache
            return caches.match(OFFLINE_URL);
          });
        })
    );
    return;
  }

  // For /_next/static/ — STALE-WHILE-REVALIDATE.
  // Pre-fix this used cache-first with no expiration, so installed PWAs
  // would keep serving old JS bundles forever even after a deploy. Now
  // the cached version is served immediately (still snappy), but the
  // network is hit in the background and the cache is updated. The next
  // page open gets the fresh bundle.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cachedResponse) => {
          const networkFetch = fetch(request)
            .then((response) => {
              if (response && response.ok) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => cachedResponse);
          return cachedResponse || networkFetch;
        })
      )
    );
    return;
  }

  // For images / icons — cache-first is still fine; they don't change
  // behaviour and the network savings on mobile are real.
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        });
      })
    );
    return;
  }

  // Default: network first
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Background sync for offline run logging (future feature)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-runs') {
    event.waitUntil(syncRuns());
  }
});

async function syncRuns() {
  // Future: sync offline-logged runs when back online
  console.log('[SW] Syncing runs...');
}
