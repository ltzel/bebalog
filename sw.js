// bebalog service worker
// Cache-busting + update-friendly strategy.
const CACHE_NAME = "bebalog-cache-v5";
const CORE_URLS = [
  "./",
  "./index.html",
  "./styles.css?v5",
  "./app.js?v5",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith("bebalog-cache-") && k !== CACHE_NAME)
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function isCoreAsset(reqUrl) {
  // Network-first for these (with or without query string)
  return (
    reqUrl.pathname.endsWith("/index.html") ||
    reqUrl.pathname.endsWith("/app.js") ||
    reqUrl.pathname.endsWith("/styles.css") ||
    reqUrl.pathname === "/" ||
    reqUrl.pathname.endsWith("/")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (isCoreAsset(url)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req, { ignoreSearch: false })
                      || await caches.match(req, { ignoreSearch: true });
        return cached || Response.error();
      }
    })());
    return;
  }

  // Cache-first for everything else
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    const res = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone());
    return res;
  })());
});
