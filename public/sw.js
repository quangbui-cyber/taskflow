/* Push only: authenticated pages and files are never cached offline. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function safeDestination(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/notifications", self.location.origin);
    // Chỉ mở các trang mà thông báo của app dẫn tới (dự án, góc cảm ơn, nghỉ phép, lịch họp, biên bản họp).
    if (url.origin === self.location.origin &&
        (/^\/projects\/[^/]+$/.test(url.pathname) ||
          /^\/meetings\/[^/]+\/recap$/.test(url.pathname) ||
          ["/recognition", "/notifications", "/leave", "/meetings"].includes(url.pathname))) {
      return url.href;
    }
  } catch { /* Fall back to the user's notifications. */ }
  return new URL("/notifications", self.location.origin).href;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    data = parsed && typeof parsed === "object" ? parsed : {};
  } catch { /* Always show a visible notification. */ }
  event.waitUntil(self.registration.showNotification(
    typeof data.title === "string" ? data.title : "myCreative", {
      body: typeof data.body === "string" ? data.body : "Bạn có cập nhật mới. Mở app để xem.",
      icon: "/api/pwa-icon?size=192",
      badge: "/api/pwa-icon?size=96",
      tag: typeof data.tag === "string" ? data.tag : "mycreative-update",
      data: { url: safeDestination(data.url) },
    }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = safeDestination(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find((item) => item.url === destination);
    if (client) return client.focus();
    return self.clients.openWindow(destination);
  })());
});
