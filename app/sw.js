/* Family Hub service worker — keeps the wall on its last good screen when the internet drops.
   Shell (html/css/js) = network-first, cached copy offline. Photos = cache-first (immutable ids).
   Other /api/* pass through; app.js already keeps state/events/photo list in localStorage. */
const SHELL = "hub-shell-v1", PHOTOS = "hub-photos-v1";
const FILES = ["./", "index.html", "app.js", "app.css", "data.js", "money-view.js", "money-view.css", "money-history.js", "data/meals.json"];
self.addEventListener("install", e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(self.clients.claim()); });

async function networkFirst(req, key) {
  const c = await caches.open(SHELL);
  try {
    const r = await fetch(req, { cache: "no-store" });
    if (r.ok) c.put(key || req, r.clone());
    return r;
  } catch (err) {
    const hit = await c.match(key || req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
async function photo(req) {
  const c = await caches.open(PHOTOS), hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) c.put(req, r.clone());
  return r;
}
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (req.mode === "navigate") return e.respondWith(networkFirst(req, "index.html"));
  if (/^\/api\/photos\/[^/]+$/.test(url.pathname)) return e.respondWith(photo(req));
  if (url.pathname.startsWith("/api/")) return;
  e.respondWith(networkFirst(req));
});
