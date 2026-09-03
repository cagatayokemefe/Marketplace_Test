/* MeetApp — service worker
   Uygulama kabuğunu önbelleğe alır; API istekleri her zaman ağdan gider.
   Böylece uygulama telefona kurulabilir ve bağlantı kopsa bile açılır. */

const CACHE = "meetapp-shell-v1";

const SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "i18n.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API: her zaman ağ. Önbelleğe alınmaz (oturum ve para verisi taze olmalı).
  if (url.pathname.startsWith("/api/")) return;

  // Gezinme istekleri: ağ önce, olmazsa önbellekteki kabuk.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("index.html")),
    );
    return;
  }

  // Statik dosyalar: önbellek önce, arka planda tazele.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
