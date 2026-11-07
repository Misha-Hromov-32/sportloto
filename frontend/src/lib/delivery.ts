import { apiRequest } from '@/api/client';

/**
 * Каналы доставки уведомлений сайта: почта, браузер (Web Push) и мессенджеры.
 * Сервер: /api/delivery/*.
 */

export type MessengersMode = 'all' | 'important' | 'off';

export interface DeliverySettings {
  email: boolean;
  browser: boolean;
  messengers: MessengersMode;
  emailAddress: string | null;
  emailDeliverable: boolean;
  bots: { vk: boolean };
  pushAvailable: boolean;
  pushKey: string | null;
  pushSubscriptions: number;
}

export type DeliveryPatch = Partial<Pick<DeliverySettings, 'email' | 'browser' | 'messengers'>>;

export type ChannelResult = 'sent' | 'off' | 'failed' | 'unavailable';

export function getDeliverySettings(): Promise<DeliverySettings> {
  return apiRequest<DeliverySettings>('get', '/delivery/settings');
}

export function updateDeliverySettings(patch: DeliveryPatch): Promise<DeliverySettings> {
  return apiRequest<DeliverySettings>('put', '/delivery/settings', { body: patch });
}

export function sendPushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
  return apiRequest<void>('post', '/delivery/push/subscribe', {
    body: { endpoint: subscription.endpoint, keys: subscription.keys, userAgent: navigator.userAgent },
  });
}

export function dropPushSubscription(endpoint: string): Promise<void> {
  return apiRequest<void>('post', '/delivery/push/unsubscribe', { body: { endpoint } });
}

export function sendTestNotification(): Promise<Record<'email' | 'browser', ChannelResult>> {
  return apiRequest('post', '/delivery/test');
}
