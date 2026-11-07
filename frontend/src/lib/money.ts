import type { CancelPolicy, Price } from '@/types/domain';

import { dayjs } from './dates';
import { count, WORDS } from './plural';

const NB = '\u00A0';

export function formatRub(amount: number): string {
  return `${Math.round(amount).toLocaleString('ru-RU')}${NB}₽`;
}

export interface PriceSummary {
  /** Главная строка: «Бесплатно», «300 ₽», «≈ 200 ₽ с человека». */
  main: string;
  /** Пояснения: «Скидываемся на аренду: 2 400 ₽ на всех», «Не больше 300 ₽, если наберётся 8». */
  details: string[];
  free: boolean;
  /** Сколько заплатит человек сейчас — для фильтра «до N ₽». */
  perPerson: number;
}

/**
 * При «скидываемся» доля считается от текущего числа участников, но не выше доли при пороге:
 * если порог не наберётся, событие не состоится и платить не придётся.
 */
export function priceSummary(
  price: Price,
  confirmed: number,
  minParticipants: number | null,
  online = false,
): PriceSummary {
  if (price.kind === 'free') return { main: 'Бесплатно', details: [], free: true, perPerson: 0 };
  if (price.kind === 'fixed') {
    return {
      main: formatRub(price.amount),
      details: [online ? 'С человека, оплата на сайте' : 'С человека, оплата на месте'],
      free: false,
      perPerson: price.amount,
    };
  }
  const cap = minParticipants ? Math.ceil(price.total / minParticipants) : null;
  const now = Math.ceil(price.total / Math.max(confirmed, 1));
  const perPerson = cap !== null ? Math.min(now, cap) : now;
  const details = [`Скидываемся${price.note ? ` ${price.note}` : ''}: ${formatRub(price.total)} на${NB}всех`];
  if (confirmed > 1)
    details.push(`Сейчас ${count(confirmed, WORDS.participant)}, это ≈${NB}${formatRub(now)} с человека`);
  if (cap !== null) details.push(`Не больше ${formatRub(cap)} с человека, если наберётся ${minParticipants}`);
  return { main: `≈${NB}${formatRub(perPerson)} с человека`, details, free: false, perPerson };
}

export function freeCancelDeadline(policy: CancelPolicy, startsAt: string): Date {
  const start = dayjs(startsAt);
  if (policy.kind === 'anytime') return start.toDate();
  if (policy.kind === 'hoursBefore') return start.subtract(policy.hours, 'hour').toDate();
  const [h, m] = policy.time.split(':').map(Number);
  return start
    .subtract(1, 'day')
    .hour(h ?? 18)
    .minute(m ?? 0)
    .second(0)
    .toDate();
}

/** Правило отмены записи, которое участник видит до записи. */
export function cancelPolicyText(policy: CancelPolicy, startsAt: string): string {
  if (policy.kind === 'anytime') return 'Отменить запись можно в любой момент';
  const deadline = dayjs(freeCancelDeadline(policy, startsAt));
  if (policy.kind === 'hoursBefore') {
    return `Отменить бесплатно можно до ${deadline.format('HH:mm, D MMMM')}, за ${policy.hours}${NB}ч до начала`;
  }
  return `Отменить бесплатно можно до ${policy.time} накануне, ${deadline.format('D MMMM')}`;
}

export const ORGANIZER_CANCEL_NOTE = 'Если организатор отменит событие, деньги вернут полностью.';
export const PAYMENT_NOTE_DEFAULT = 'Оплата на месте, организатору';
export const ONLINE_CANCEL_NOTE =
  'Если отмените запись в срок, вернём деньги за участие. Сбор сервиса не возвращается.';
export const PAYMENT_NOTE_ONLINE =
  'Оплата на сайте по СБП или картой. К сумме добавится сбор сервиса: он покрывает комиссию банка';
