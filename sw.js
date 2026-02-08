const CACHE_NAME = 'pitch-detector-v1';
const ASSETS = [
	'./',
	'./index.html',
	'./script.js',
	'./manifest.json',
	'./lib/vue.global.js',
	'./lib/pitchy.js',
	'./lib/yin.js',
	'./lib/pyin.js',
	'./lib/mpm.js',
	'./lib/i18n.js',
	'./agc-processor.js',
	'./stream-processor.js',
	'./icons/icon-192.png',
	'./icons/icon-512.png',
	'./icons/icon.svg',
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then((cache) => cache.addAll(ASSETS))
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) => {
			return Promise.all(
				keys.filter((key) => key !== CACHE_NAME)
					.map((key) => caches.delete(key))
			);
		})
	);
});

self.addEventListener('fetch', (event) => {
	event.respondWith(
		caches.match(event.request)
			.then((response) => {
				return response || fetch(event.request).then((response) => {
					// Cache successful GET requests
					if (!response || response.status !== 200 || response.type !== 'basic' || event.request.method !== 'GET') {
						return response;
					}
					const responseToCache = response.clone();
					caches.open(CACHE_NAME)
						.then((cache) => {
							cache.put(event.request, responseToCache);
						});
					return response;
				});
			})
	);
});
