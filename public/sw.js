// Service worker: precache the app shell so a standalone (home-screen) launch
// paints instantly from cache instead of waiting on the network. That closes the
// gap where, as the iOS splash fades, the still-loading page showed a grey/white
// flash. App data is always fetched fresh (API/device endpoints are network-only).

const CACHE = "apf-shell-v14";
// Stable, unhashed shell assets worth precaching on install.
const PRECACHE = [
  "/",
  "/index.html",
  "/fonts/AnalogMonoPlus.ttf",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Server-handled endpoints: never serve the app shell for these — let them hit
  // the network. Covers API + device endpoints AND the OAuth/MCP routes, whose
  // top-level navigations (/authorize, the Google /oauth callback) would
  // otherwise be hijacked by the navigation handler below and render the SPA
  // instead of redirecting.
  if (
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/animation") ||
    url.pathname.startsWith("/poll") ||
    url.pathname.startsWith("/stream") ||
    url.pathname.startsWith("/authorize") ||
    url.pathname.startsWith("/oauth") ||
    url.pathname.startsWith("/token") ||
    url.pathname.startsWith("/register") ||
    url.pathname.startsWith("/revoke") ||
    url.pathname.startsWith("/mcp") ||
    url.pathname.startsWith("/.well-known")
  ) {
    return; // default network handling
  }

  // Navigations: serve the cached shell instantly (so the page is painted before
  // the splash fades), and refresh the cached copy in the background.
  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("/index.html").then((cached) => {
        const network = fetch(request)
          .then((res) => {
            if (res && res.ok) {
              const clone = res.clone();
              caches.open(CACHE).then((c) => c.put("/index.html", clone));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Static assets (hashed JS, fonts, icons, splash): cache-first.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
    )
  );
});
