// Service worker: makes the app installable and loads pages from the device
// after the first visit, so they open almost instantly on slow networks.
//
// It only caches the app's own files and versioned CDN libraries. It never
// caches Firestore, Cloud Functions or any other API response.
//
// VERSION is updated by `npm run build` (scripts/stamp-sw.js); a new version
// clears the old cache.
const VERSION = 'asv-dev';
const CACHE = `asv-static-${VERSION}`;

const PRECACHE = [
  'index.html', 'dashboard.html', 'customers.html', 'customer.html', 'register-customer.html',
  'edit-customer.html', 'deposit.html', 'withdraw.html', 'transactions.html', 'statement.html',
  'reports.html', 'report-view.html', 'notifications.html', 'profile.html', 'staff.html',
  'sms.html', 'settings.html', 'audit.html',
  'assets/app.css', 'logo-b.png', 'logo-w.png', 'manifest.webmanifest',
  'js/lib/firebase.js', 'js/lib/session.js', 'js/lib/api.js', 'js/lib/ui.js', 'js/lib/roles.js',
  'js/lib/sms-template.js', 'js/lib/photo.js', 'js/lib/customer-form.js', 'js/lib/customer-search.js', 'js/lib/pwa.js',
  'components/bottom-nav.js', 'components/notifications.js'
];

// Third-party files whose URLs contain a version number never change.
const IMMUTABLE_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('asv-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    event.respondWith(staleWhileRevalidate(req, url));
    return;
  }

  const versionedFirebase = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  const versionedCdn = url.hostname === 'cdnjs.cloudflare.com' && url.pathname.startsWith('/ajax/libs/');
  if (IMMUTABLE_HOSTS.includes(url.hostname) && (versionedFirebase || versionedCdn)) {
    event.respondWith(cacheFirst(req));
  }
  // Everything else (Firestore, Functions, Cloudinary, ...) goes straight to the network.
});

async function staleWhileRevalidate(req, url) {
  const cache = await caches.open(CACHE);
  // Pages are cached without their query string (?id=...), which may hold ids.
  const key = req.mode === 'navigate' ? new Request(url.origin + url.pathname) : req;
  const cached = await cache.match(key);
  const network = fetch(req)
    .then((res) => {
      if (res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  const res = await network;
  return res || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
