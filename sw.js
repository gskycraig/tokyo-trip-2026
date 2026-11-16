// 東京行程網頁的離線快取。VERSION 由 build_site.py 在建置時填入。
const VERSION = '20261116-092734';
const CACHE = 'tokyo-trip-' + VERSION;      // 頁面與 CDN 資源，每次改版換新
const IMG_CACHE = 'tokyo-trip-img';          // 照片，跨版本保留，避免重複下載
const PRECACHE = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-180.png'];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('tokyo-trip-') && k !== CACHE && k !== IMG_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const putIn = (name, req, res) => { const copy = res.clone(); caches.open(name).then(c => c.put(req, copy)); };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
    if (isPage) {   // 頁面：有網路拿最新的，沒網路用上次存的
      e.respondWith(fetch(req).then(res => { if (res.ok) putIn(CACHE, './', res); return res; })
        .catch(() => caches.match('./').then(hit => hit || caches.match(req, { ignoreSearch: true }))));
      return;
    }
    const isImg = url.pathname.includes('/img/');
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) putIn(isImg ? IMG_CACHE : CACHE, req, res); return res; })));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {   // 樣式與字型：先用快取，同時在背景更新
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') putIn(CACHE, req, res); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
  // 其他（Firebase 同步、天氣、AI）一律走網路，不快取
});

// 頁面載入後請這裡把照片與樣式先下載好，之後離線也看得到
self.addEventListener('message', e => {
  const msg = e.data || {};
  if (msg.type !== 'warm' || !Array.isArray(msg.urls)) return;
  e.waitUntil((async () => {
    let ok = 0;
    for (const u of msg.urls.slice(0, 200)) {
      try {
        const url = new URL(u, location.href);
        const same = url.origin === location.origin;
        if (!same && !CDN_HOSTS.includes(url.hostname)) continue;
        const name = same && url.pathname.includes('/img/') ? IMG_CACHE : CACHE;
        const cache = await caches.open(name);
        if (await cache.match(url.href)) { ok++; continue; }
        const res = await fetch(url.href, same ? {} : { mode: 'no-cors' });
        if (res.ok || res.type === 'opaque') { await cache.put(url.href, res); ok++; }
      } catch (err) { }
    }
    if (e.source) e.source.postMessage({ type: 'warmed', ok, total: msg.urls.length });
  })());
});
