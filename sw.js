// sw.js — アプリ本体（HTML/CSS/JS/アイコン）と Firebase の部品をキャッシュする。
// データは対象外（Firestore が端末に保存する）。
// 保存済みのものを先に使うので、ファイルを変えて公開するときは必ず CACHE の番号を上げること。
const CACHE = 'family-memo-shell-v6';
const SDK = 'https://www.gstatic.com/firebasejs/13.4.0/'; // store.js の版と合わせる
const SHELL = [
  './', './index.html', './style.css', './app.js', './store.js', './firebase-config.js', './categories.js', './sortable.js',
  './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  SDK + 'firebase-app.js', SDK + 'firebase-auth.js', SDK + 'firebase-firestore.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // ブラウザの一時保存を使わず、必ず最新を取りに行く
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // 同じドメインの別アプリのキャッシュは消さない
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('family-memo-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// キャッシュ優先（すぐ開く・圏外でも開く）。更新は新しい sw.js がまとめて取り込み、次に開いたときに反映される
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin && !req.url.startsWith(SDK)) return;
  e.respondWith(
    caches.open(CACHE)
      .then((c) => c.match(req, { ignoreSearch: req.mode === 'navigate' }))
      .then((hit) => hit || fetch(req)),
  );
});
