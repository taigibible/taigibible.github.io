// 離線支援：存下 app 本身與播放過的語音
const VERSION = 'v12';
const SHELL = 'shell-' + VERSION;
const AUDIO = 'audio-v1';
const REAL = 'real-audio-v1';  // 使用者在書卷頁下載的真人錄音
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
  if (url.hostname.endsWith('.github.io') && /\/taigi-bible-audio-(ot|nt)\//.test(url.pathname) && url.pathname.endsWith('.m4a')) {
    // 真人錄音：有下載過就用存檔（支援從中間開始播），沒有就走網路
    e.respondWith(caches.open(REAL).then(c => c.match(url.href)).then(async hit => {
      if (!hit) return fetch(e.request);
      const range = e.request.headers.get('range');
      if (!range) return hit;
      const buf = await hit.arrayBuffer();
      const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
      const total = buf.byteLength;
      const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], total - 1) : total - 1;
      return new Response(buf.slice(start, end + 1), { status: 206, headers: {
        'Content-Type': hit.headers.get('Content-Type') || 'audio/mp4',
        'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
    }));
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
