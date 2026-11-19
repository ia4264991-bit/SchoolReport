// SchoolReport service worker: keeps the app's own files so it opens without network
// (a teacher can then take the register offline; it is sent when the phone is back online).
// It never touches API calls — those go to the API's own address and are not cached.
const CACHE = 'sr-shell-v1'
const MAX_ASSETS = 80

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

async function remember(request, response) {
  const cache = await caches.open(CACHE)
  await cache.put(request, response)
  const keys = await cache.keys()
  // Old builds' files pile up: drop the oldest beyond the limit.
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) {
    if (!k.url.endsWith('/index.html')) await cache.delete(k)
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    // Network first (always the newest app), the saved copy when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            event.waitUntil(caches.open(CACHE).then((c) => c.put('/index.html', copy)))
          }
          return res
        })
        .catch(async () => (await caches.match('/index.html')) || Response.error())
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    // Build files have unique names and never change: the saved copy is always right.
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) event.waitUntil(remember(req, res.clone()))
        return res
      }))
    )
  }
})
