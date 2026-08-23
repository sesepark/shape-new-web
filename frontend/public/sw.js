const CACHE = "shape-shell-v2";
const STATIC_ASSETS = ["/icon-192.png", "/icon-512.png", "/shape-symbol.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !STATIC_ASSETS.some((path) => event.request.url.endsWith(path))) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

// The API sends JSON, but a plain-text payload still has to produce a notice.
function payloadOf(event) {
  if (!event.data) return { title: "SHAPE 새 공지", url: "/notices" };
  try {
    const parsed = event.data.json();
    return { title: parsed.title || "SHAPE 새 공지", body: parsed.body, url: parsed.url || "/notices" };
  } catch {
    return { title: event.data.text() || "SHAPE 새 공지", url: "/notices" };
  }
}

self.addEventListener("push", (event) => {
  const payload = payloadOf(event);
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body || "SHAPE 게시판에 새 글이 올라왔습니다.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "shape-notice",
    data: { url: payload.url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/notices", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const open = windows.find((client) => client.url.startsWith(self.location.origin));
    if (open) return open.focus().then(() => open.navigate(target));
    return self.clients.openWindow(target);
  }));
});
