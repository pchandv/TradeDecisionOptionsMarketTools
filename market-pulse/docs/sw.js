const CACHE_NAME = "market-signal-shell-v4";
const PRECACHE_ASSETS = [
    "./",
    "./index.html",
    "./investing.html",
    "./styles.css",
    "./app.js",
    "./investing.js",
    "./browser-standalone-loader.js",
    "./manifest.webmanifest",
    "./icon.svg",
    "./pwa.js"
];

function resolveAssetUrl(path) {
    return new URL(path, self.registration.scope).toString();
}

function toCacheKey(request) {
    const url = new URL(request.url);
    url.search = "";
    return url.toString();
}

async function precacheShell() {
    const cache = await caches.open(CACHE_NAME);
    const requests = PRECACHE_ASSETS.map((asset) => new Request(resolveAssetUrl(asset), { cache: "reload" }));
    await cache.addAll(requests);
}

async function cleanOldCaches() {
    const keys = await caches.keys();
    await Promise.all(
        keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
    );
}

async function handleNavigation(request) {
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = toCacheKey(request);

    try {
        const response = await fetch(request);
        if (response && response.ok) {
            cache.put(cacheKey, response.clone());
        }
        return response;
    } catch (error) {
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
            return cachedResponse;
        }

        const requestUrl = new URL(request.url);
        const fallbackUrl = requestUrl.pathname.endsWith("/investing.html")
            ? resolveAssetUrl("./investing.html")
            : resolveAssetUrl("./index.html");
        return (await cache.match(fallbackUrl)) || (await cache.match(resolveAssetUrl("./index.html")));
    }
}

async function handleStaticAsset(request) {
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = toCacheKey(request);
    const cachedResponse = await cache.match(cacheKey);

    const networkFetch = fetch(request)
        .then((response) => {
            if (response && response.ok) {
                cache.put(cacheKey, response.clone());
            }
            return response;
        })
        .catch(() => null);

    return cachedResponse || networkFetch || Response.error();
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        precacheShell()
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        cleanOldCaches()
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const requestUrl = new URL(event.request.url);

    if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin || requestUrl.pathname.includes("/api/")) {
        return;
    }

    if (event.request.mode === "navigate") {
        event.respondWith(handleNavigation(event.request));
        return;
    }

    event.respondWith(handleStaticAsset(event.request));
});
