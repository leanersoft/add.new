const CACHE_PREFIX = "semnote-add-new";
const CACHE_NAME = `${CACHE_PREFIX}-runtime-v1`;
const PRECACHE_URLS = ["/", "/writer/", "/manifest.webmanifest", "/favicon.svg", "/search-index.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cacheUrls(PRECACHE_URLS, cache);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );

      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") {
    return;
  }

  if (data.type === "CACHE_URLS" && Array.isArray(data.urls)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        await cacheUrls(data.urls, cache);
      })(),
    );
  }

  if (data.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.headers.has("range") || url.pathname === "/sw.js") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleAssetRequest(request, event));
});

async function cacheUrls(urls, cache) {
  const uniqueUrls = Array.from(new Set(urls.map(normalizeUrl).filter(Boolean)));

  await Promise.allSettled(
    uniqueUrls.map(async (url) => {
      const request = new Request(url, { credentials: "same-origin" });
      const response = await fetch(request);

      if (isCacheableResponse(response)) {
        await cache.put(request, response.clone());
      }
    }),
  );
}

function normalizeUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.hash = "";
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function isCacheableResponse(response) {
  return Boolean(response && response.ok);
}

async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cachedResponse = await cache.match(request, { ignoreSearch: true });
    if (cachedResponse) {
      return cachedResponse;
    }

    return (
      (await cache.match("/", { ignoreSearch: true })) ??
      Response.error()
    );
  }
}

async function handleAssetRequest(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    event.waitUntil(updateCache(request, cache));
    return cachedResponse;
  }

  return updateCache(request, cache);
}

async function updateCache(request, cache) {
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
}
