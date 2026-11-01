// 離線支援：存下 app 本身與播放過的語音
const VERSION = 'v3';
const SHELL = 'shell-' + VERSION;
const AUDIO = 'audio-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'books.js', 'poj.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'poj-font.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    // app 本身：先用網路（拿最新版），沒網路才用存檔
    e.respondWith(fetch(e.request).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(SHELL).then(c => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  if (url.hostname === 'hapsing.ithuan.tw') {
    // 語音：先用網路；成功就存一份；沒網路時用存檔
    const key = url.href;
    e.respondWith(fetch(e.request).then(r => {
      if (r.status === 200 || r.type === 'opaque') { const cp = r.clone(); caches.open(AUDIO).then(c => c.put(key, cp)).catch(() => { }); }
      return r;
    }).catch(() => caches.open(AUDIO).then(c => c.match(key)).then(r => r || Response.error())));
  }
});
