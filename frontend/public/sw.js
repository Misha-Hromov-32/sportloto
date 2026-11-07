/* Уведомления «Спорт и точка» в браузере (Web Push).
 * Сервер присылает { id, title, body, url }. Если сайт открыт и человек сейчас на нём,
 * уведомление уже всплыло в углу страницы — системное не показываем, чтобы не было двойного. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Спорт и точка', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Спорт и точка';
  const url = data.url || '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const watching = clients.some((c) => c.visibilityState === 'visible' && c.focused);
      if (watching && !data.test) return undefined;
      return self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/favicon-32.png',
        tag: data.id || undefined,
        lang: 'ru',
        data: { url },
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin)
    .href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const same = clients.find((c) => c.url.startsWith(self.location.origin));
      if (same) {
        return same.navigate(url).then((c) => (c || same).focus());
      }
      return self.clients.openWindow(url);
    }),
  );
});
