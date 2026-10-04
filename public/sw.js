/* Toshkent Drive v1.8 offline cache (hand-written, no Workbox).
 * - _next/static (content-hashed): cache-first, kept forever
 * - models / textures / images / audio / wasm: stale-while-revalidate, so a
 *   second visit loads the city from disk and still picks up updated models
 * - pages (navigations): network-first, cached copy when offline
 * Not registered inside the Android APK (assets are already on the device). */
const VERSION = "td-v1.8";
const STATIC = VERSION + "-static";
const ASSETS = VERSION + "-assets";
const PAGES = VERSION + "-pages";
const SCOPE = new URL(self.registration.scope).pathname; // e.g. /toshkent-drive/

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.add(SCOPE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("td-") && !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

const ASSET_RE = /\.(glb|gltf|bin|webp|png|jpe?g|ktx2|hdr|wasm|mp3|ogg|wav|json|woff2?)$/i;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  const path = url.pathname.slice(SCOPE.length - 1);
  if (path.startsWith("/_next/static/")) {
    e.respondWith(caches.open(STATIC).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) caches.open(PAGES).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(async () => (await caches.match(req, { ignoreSearch: true })) || (await caches.match(SCOPE)) || Response.error()));
    return;
  }
  if (ASSET_RE.test(url.pathname)) {
    e.respondWith(caches.open(ASSETS).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok && res.status === 200) c.put(req, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || Response.error();
    }));
  }
});

// the page that registered us already loaded its scripts/models before the
// worker existed — it posts those URLs so they are on disk for the next visit
self.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.type !== "td-cache" || !Array.isArray(d.urls)) return;
  e.waitUntil(Promise.all(d.urls.map(async (u) => {
    try {
      const url = new URL(u, self.location.origin);
      if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
      const isStatic = url.pathname.slice(SCOPE.length - 1).startsWith("/_next/static/");
      if (!isStatic && !ASSET_RE.test(url.pathname)) return;
      const c = await caches.open(isStatic ? STATIC : ASSETS);
      if (await c.match(url.href, { ignoreSearch: !isStatic })) return;
      const res = await fetch(url.href);
      if (res.ok && res.status === 200) await c.put(url.href, res);
    } catch { /* offline / quota */ }
  })));
});
