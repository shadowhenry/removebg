/**
 * sw.js — Service Worker
 *
 * 策略：
 *  · 应用外壳（同源静态资源）—— 预缓存 + 缓存优先，导航请求网络优先并回退 index.html
 *  · CDN 上的抠图引擎模块（跨域 script）—— 陈旧内容优先，网络更新，失败时回退缓存
 *  · 模型权重由 @imgly/background-removal 自行缓存，这里不做拦截
 */

const VERSION = 'v1.2.2';
const CACHE = `removebg-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/styles.css',
  './assets/js/app.js',
  './assets/js/home.js',
  './assets/js/editor.js',
  './assets/js/remover.js',
  './assets/js/ui.js',
  './assets/img/favicon.svg',
  './assets/img/logo.svg',
  './assets/img/sample-1.jpg',
  './assets/img/sample-2.jpg',
  './assets/img/sample-3.jpg',
  './assets/img/sample-4.jpg',
  './assets/media/demo.gif',
  './icons/icon-192.png',
  './icons/icon-256.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

const CDN_HOSTS = /(^|\.)(jsdelivr\.net|unpkg\.com|esm\.sh|imgly\.com)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled(
        SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function fromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) {
    // 后台静默更新
    fetch(request)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') cache.put(request, res.clone());
      })
      .catch(() => {});
    return hit;
  }
  const res = await fetch(request);
  if (res && res.status === 200 && res.type === 'basic') cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && (res.status === 200 || res.type === 'opaque')) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 同源
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
            return res;
          })
          .catch(async () => {
            const cache = await caches.open(CACHE);
            return (await cache.match('./index.html')) || (await cache.match('./')) ||
              new Response('离线且无缓存', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
          })
      );
      return;
    }

    if (url.pathname.endsWith('/sw.js')) return; // 让浏览器自行管理 SW 脚本
    event.respondWith(fromCacheFirst(request).catch(() => caches.match(request)));
    return;
  }

  // 跨域：仅接管 CDN 上的脚本模块
  if (CDN_HOSTS.test(url.hostname) && request.destination === 'script') {
    event.respondWith(staleWhileRevalidate(request));
  }
});
