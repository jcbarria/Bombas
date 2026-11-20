// Versión: cambie este número en cada publicación para que los teléfonos que ya instalaron la app reciban la nueva.
const CACHE = 'bombas-v14';
const ASSETS = [
  './', 'index.html', 'styles.css', 'core.js', 'i18n.js', 'app.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
  'fonts/ibm-plex-sans-latin-400-normal.woff2', 'fonts/ibm-plex-sans-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-latin-600-normal.woff2', 'fonts/ibm-plex-sans-latin-700-normal.woff2',
  'fonts/ibm-plex-mono-latin-500-normal.woff2', 'fonts/ibm-plex-mono-latin-600-normal.woff2'
];
// Si la red no responde en este tiempo (señal débil en el campo), se usa la copia guardada.
const NET_TIMEOUT_MS = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true })
    .then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined));
}
// Primero la red (así siempre se ve la última versión cuando hay internet) y, sin red o con red
// demasiado lenta, la copia guardada. Cada respuesta buena de la red actualiza la copia.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const net = fetch(req).then((res) => {
    if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  });
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => fromCache(req).then(finish), NET_TIMEOUT_MS);
    net.then((res) => { clearTimeout(timer); finish(res); })
       .catch(() => { clearTimeout(timer); fromCache(req).then((hit) => { if (!done) { done = true; resolve(hit || Response.error()); } }); });
  }));
  e.waitUntil(net.catch(() => {}));   // la copia se sigue actualizando aunque ya se haya respondido con la guardada
});
