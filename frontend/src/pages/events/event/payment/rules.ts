import { dayjs } from '@/lib/dates';
import type { EventDetails } from '@/types/api';

/** Встреча с оплатой на сайте: платная, организатор выбрал «Онлайн на сайте». */
export function isOnlinePay(e: Pick<EventDetails, 'paymentMode' | 'price'>): boolean {
  return e.paymentMode === 'online' && e.price.kind !== 'free';
}

/** Складчина: оплата открывается позже (за несколько дней до встречи). */
export function splitOpensLater(e: Pick<EventDetails, 'price' | 'startsAt'>, openDays = 7): boolean {
  return e.price.kind === 'split' && dayjs(e.startsAt).subtract(openDays, 'day').isAfter(dayjs());
}
