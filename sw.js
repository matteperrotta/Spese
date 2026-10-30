// Fa funzionare l'app anche senza connessione: tiene in memoria la pagina e,
// dopo il primo uso, il lettore di scontrini e i caratteri.
const CACHE = "spese-app-v2";
const CORE = ["./", "index.html", "parse.js", "version.json", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Pagine e file dell'app: prima la rete (per avere gli aggiornamenti), poi la copia salvata
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match("index.html")))
    );
    return;
  }

  // Lettore di scontrini, dati della lingua italiana e caratteri: prima la copia salvata
  if (/cdn\.jsdelivr\.net|tessdata|fonts\.(googleapis|gstatic)\.com/.test(url.host + url.pathname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
