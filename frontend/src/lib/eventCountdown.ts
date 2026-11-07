import type { EventState } from '@/types/domain';
import { count } from './plural';

export function countdownText(
  startsAt: string,
  state: EventState,
  now = Date.now(),
  durationMin = 60,
): string | null {
  if (state !== 'upcoming' && state !== 'live') return null;
  const diff = Date.parse(startsAt) - now;
  if (!Number.isFinite(diff)) return null;
  if (diff <= 0)
    return now >= Date.parse(startsAt) + durationMin * 60_000 ? 'Встреча завершилась' : 'Встреча уже идёт';
  const minutes = Math.ceil(diff / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return `До начала ${days ? `${count(days, ['день', 'дня', 'дней'])}${hours ? ` ${count(hours, ['час', 'часа', 'часов'])}` : ''}` : hours ? `${count(hours, ['час', 'часа', 'часов'])}${rest ? ` ${count(rest, ['минута', 'минуты', 'минут'])}` : ''}` : count(rest, ['минута', 'минуты', 'минут'])}`;
}
