/**
 * sw.js — Service Worker
 *
 * 策略：
 *  · 代码与样式（js/css/html/json/webmanifest）—— 网络优先，保证发版后立即生效，离线回退缓存
 *  · 图片 / 字体 / 媒体等大体积基本不变的资源 —— 缓存优先，离线体验更好
 *  · 导航请求 —— 网络优先，失败回退缓存的 index.html
 *  · CDN 上的抠图引擎模块（跨域 script）—— 陈旧内容优先，网络更新，失败时回退缓存
 *  · 模型权重由 @imgly/background-removal 自行缓存，这里不做拦截
 *
 * 注意：js/css 用「缓存优先」会出现「新 HTML + 旧 JS」混用，表现为整站交互失灵
 *      （历史上下载按钮点不动就是这个原因），因此必须走网络优先。
 */

const VERSION = 'v1.2.3';
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

/* 需要「网络优先」的路径：代码与样式，必须随时保持最新 */
const NETWORK_FIRST = /\.(?:js|css|html|json|webmanifest)$/i;

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
      /* 存在旧版本缓存 → 本次是「升级」而非首次安装 */
      const isUpgrade = keys.some((k) => k !== CACHE);
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();

      /* 升级后，已打开页面上跑的是旧缓存资源（新 HTML + 旧 JS 会失灵）。
         主动刷新一次，让新策略与最新资源立即接管；只在升级时触发，不会循环。 */
      if (isUpgrade) {
        const list = await self.clients.matchAll({ type: 'window' });
        await Promise.allSettled(list.map((client) => client.navigate(client.url)));
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

function offlineResponse() {
  return new Response('离线且无缓存', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** 缓存优先（图片等基本不变的大资源）；命中后后台静默更新 */
async function fromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) {
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

/**
 * 网络优先（代码/样式/导航）：在线永远拿最新，离线回退缓存。
 * @param {Request} request
 * @param {string[]} [aliases] 额外写入/回退的缓存键（如导航统一存到 ./index.html）
 * @param {boolean} [revalidate] 强制回源校验（绕过浏览器 HTTP 缓存）。
 *   生产环境静态资源带 max-age=14400，不强制校验的话发版后 4 小时内仍会拿到旧 JS。
 */
async function networkFirst(request, aliases = [], revalidate = false) {
  const cache = await caches.open(CACHE);
  try {
    const res = revalidate ? await fetch(request, { cache: 'no-cache' }) : await fetch(request);
    if (res && res.status === 200 && res.type === 'basic') {
      const puts = [cache.put(request, res.clone())];
      for (const alias of aliases) puts.push(cache.put(alias, res.clone()));
      await Promise.allSettled(puts);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    for (const alias of aliases) {
      const aliasHit = await cache.match(alias);
      if (aliasHit) return aliasHit;
    }
    throw err;
  }
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
      event.respondWith(networkFirst(request, ['./index.html']).catch(offlineResponse));
      return;
    }

    if (url.pathname.endsWith('/sw.js')) return; // 让浏览器自行管理 SW 脚本

    const strategy = NETWORK_FIRST.test(url.pathname)
      ? networkFirst(request, [], true)
      : fromCacheFirst(request);
    event.respondWith(strategy.catch(offlineResponse));
    return;
  }

  // 跨域：仅接管 CDN 上的脚本模块
  if (CDN_HOSTS.test(url.hostname) && request.destination === 'script') {
    event.respondWith(staleWhileRevalidate(request));
  }
});
