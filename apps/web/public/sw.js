// Service worker for tomokichidiary.com.
//
// Deliberately small. It never makes the online site slower or staler:
//
// - Pages are network-first. A visit always gets the live HTML (a republish is
//   visible immediately); the copy kept here is only read when the network
//   fails, so a reader can reopen an article they already visited offline.
// - Hashed build assets (/_astro/*) are immutable, so they are served from
//   cache once seen -- the same thing the HTTP cache already does, but it
//   survives offline.
// - Media on its own origin and everything else is left to the browser. Images
//   are the bulk of the site; caching them here would fill the device for
//   little gain, and cross-origin opaque responses are padded to megabytes
//   each by the quota accounting.
//
// Install fetches only the offline page and the files it needs, so the first
// visit pays for a few kilobytes, not the site.
//
// This file replaces the previous site's tombstone worker at the same URL. On
// activate it deletes every cache it does not own, which also clears whatever
// the older Serwist worker left behind.

const VERSION = "v1";
// The offline page and the assets it renders with live apart from the rest, so
// trimming either of the other caches can never leave it unstyled.
const OFFLINE_CACHE = `td-offline-${VERSION}`;
const STATIC_CACHE = `td-static-${VERSION}`;
const PAGE_CACHE = `td-pages-${VERSION}`;
const OWNED = new Set([OFFLINE_CACHE, STATIC_CACHE, PAGE_CACHE]);
const OFFLINE_URL = "/offline";
const MAX_PAGES = 40;
// Every deploy renames the hashed assets; this bounds what old ones can pile up.
const MAX_ASSETS = 60;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      const response = await fetch(OFFLINE_URL, { cache: "no-cache" });
      if (!response.ok) throw new Error(`offline page: ${response.status}`);
      const html = await response.clone().text();
      // The offline page renders with the site stylesheet; its hashed URLs are
      // only known from the built HTML, so they are read from it.
      const assets = [...html.matchAll(/(?:href|src)="(\/_astro\/[^"]+\.(?:css|js))"/g)].map(
        (match) => match[1],
      );
      await cache.addAll([...new Set(assets)]);
      await cache.put(OFFLINE_URL, response);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !OWNED.has(key)).map((key) => caches.delete(key)));
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(navigate(event));
    return;
  }
  if (url.pathname.startsWith("/_astro/")) {
    event.respondWith(immutable(request));
  }
});

async function navigate(event) {
  try {
    const response = (await event.preloadResponse) || (await fetch(event.request));
    const html = response.headers.get("content-type")?.includes("text/html");
    if (response.ok && response.type === "basic" && html) {
      const copy = response.clone();
      event.waitUntil(remember(event.request, copy));
    }
    return response;
  } catch {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    return (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

async function remember(request, response) {
  const cache = await caches.open(PAGE_CACHE);
  const url = new URL(request.url);
  url.search = "";
  await cache.delete(url.href);
  await cache.put(url.href, response);
  // A revisit re-inserts, so the front of the list is the least recently read.
  await trim(cache, MAX_PAGES);
}

/** Cache keys come back in insertion order; the oldest go first. */
async function trim(cache, max) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((key) => cache.delete(key)));
}

async function immutable(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
    await trim(cache, MAX_ASSETS);
  }
  return response;
}
