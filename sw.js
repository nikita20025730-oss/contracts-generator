// sw.js - Service Worker для push-уведомлений WorkSpace.
//
// Разместить этот файл в КОРНЕ сайта (там же, где index.html) - Service
// Worker может контролировать только те страницы, что лежат на том же
// уровне или глубже относительно его собственного пути, поэтому размещение
// именно в корне обязательно.

// Показывает уведомление, когда сервер прислал push (даже если вкладка
// WorkSpace полностью закрыта - в этом весь смысл push-уведомлений в
// отличие от обычных in-app уведомлений, которые работают только при
// открытом приложении).
self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "WorkSpace", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "WorkSpace";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: payload.url || "/" },
    tag: payload.tag || undefined, // одинаковый tag - новое уведомление заменяет предыдущее, не копится
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Клик по уведомлению - открывает WorkSpace (если вкладка уже открыта,
// переключается на неё вместо дублирования новой).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
