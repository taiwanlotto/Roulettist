const CACHE_NAME = 'roulette-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/mobile.html',
  '/login.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// 安裝 Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('快取已開啟');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.log('快取失敗:', err);
      })
  );
  // 立即啟用新的 Service Worker
  self.skipWaiting();
});

// 啟用 Service Worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('刪除舊快取:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // 立即接管所有頁面
  self.clients.claim();
});

// 攔截請求
self.addEventListener('fetch', event => {
  // 跳過 MQTT WebSocket 連線和 API 請求
  if (event.request.url.includes('wss://') ||
      event.request.url.includes('ws://') ||
      event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 如果快取中有，直接返回
        if (response) {
          return response;
        }

        // 否則從網路獲取
        return fetch(event.request)
          .then(response => {
            // 檢查是否為有效回應
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // 複製回應（因為回應只能使用一次）
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch(() => {
            // 離線時返回快取的首頁
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
          });
      })
  );
});
