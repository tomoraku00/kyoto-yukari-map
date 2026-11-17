// 画面一式をキャッシュして、電波が弱い場所でも開けるようにする（地図の画像は除く）
const CACHE = "kyoto-map-v4";
const FILES = ["./", "index.html", "style.css", "data.js", "app.js", "vendor/leaflet.js", "vendor/leaflet.css", "manifest.webmanifest", "icon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return; // 地図・フォントはネットから
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
