import { dropPushSubscription, sendPushSubscription } from './delivery';

/** Браузерные уведомления: разрешение, сервис-воркер /sw.js и подписка Web Push. */

export type BrowserPermission = NotificationPermission | 'unsupported';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

export function browserPermission(): BrowserPermission {
  return pushSupported() ? Notification.permission : 'unsupported';
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  return existing ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/**
 * Спросить разрешение и подписать этот браузер. Без ключа сервера (Web Push не настроен)
 * достаточно разрешения: уведомления показывает открытая вкладка.
 * Возвращает итоговое разрешение.
 */
export async function enableBrowserPush(pushKey: string | null): Promise<BrowserPermission> {
  if (!pushSupported()) return 'unsupported';
  const permission =
    Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return permission;
  const reg = await registration();
  if (pushKey && 'pushManager' in reg) {
    const current = await reg.pushManager.getSubscription();
    const subscription =
      current ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(pushKey),
      }));
    await sendPushSubscription(subscription.toJSON());
  }
  return permission;
}

/** Отписать этот браузер: системные уведомления сюда больше не придут. */
export async function disableBrowserPush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const subscription = await reg?.pushManager?.getSubscription();
  if (!subscription) return;
  await dropPushSubscription(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}

/** Подписка этого браузера уже есть на сервере (проверка по наличию подписки в браузере). */
export async function hasBrowserSubscription(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return Boolean(await reg?.pushManager?.getSubscription());
}

/** Системное уведомление от открытой вкладки, когда Web Push недоступен. */
export async function showLocalNotification(title: string, body: string, url: string, tag?: string) {
  if (browserPermission() !== 'granted') return;
  const reg = await registration().catch(() => null);
  if (reg) await reg.showNotification(title, { body, tag, icon: '/icon-192.png', data: { url } });
  else new Notification(title, { body, tag, icon: '/icon-192.png' });
}
