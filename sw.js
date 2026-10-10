const VERSION = "v1";

const SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "js/app.js",
  "manifest.webmanifest",
  "assets/icons/timetable.png",
  "assets/icons/drivers.png",
  "assets/icons/constructors.png",
  "assets/icons/app-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(cache => Promise.allSettled(SHELL.map(f => cache.add(f))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Your own files (pages, css, js, images, data json):
  // serve from cache INSTANTLY, refresh quietly in background
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.open(VERSION).then(async cache => {
        const cached = await cache.match(e.request);
        const updating = fetch(e.request).then(res => {
          if (res && res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || updating;
      })
    );
  }
  // External API/proxy requests: untouched, app handles those
});