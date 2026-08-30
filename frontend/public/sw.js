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
  // 알림이 데려갈 곳은 **우리 사이트 안**뿐입니다. 지금 알림을 보낼 수 있는 것은
  // VAPID 열쇠를 쥔 우리 서버뿐이지만, 눌렀을 때 어디로 가는지를 알림 내용에
  // 그대로 맡겨 둘 이유는 없습니다. 다른 곳을 가리키면 게시판으로 보냅니다.
  const asked = new URL(event.notification.data?.url || "/notices", self.location.origin);
  const target = asked.origin === self.location.origin ? asked.href : new URL("/notices", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const open = windows.find((client) => client.url.startsWith(self.location.origin));
    if (open) return open.focus().then(() => open.navigate(target));
    return self.clients.openWindow(target);
  }));
});
