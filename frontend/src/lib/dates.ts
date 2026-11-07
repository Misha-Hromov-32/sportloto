import baseDayjs from 'dayjs';
import 'dayjs/locale/ru';
import isoWeek from 'dayjs/plugin/isoWeek';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import { getSelectedCity } from './cities';
import { count, WORDS } from './plural';
import { capitalize } from './text';

baseDayjs.extend(utc);
baseDayjs.extend(timezone);
baseDayjs.extend(isoWeek);
baseDayjs.locale('ru');

/** Пояс, в котором показываем время: пояс города, выбранного в шапке. */
export function displayZone(): string {
  return getSelectedCity().timeZone;
}

const LOCAL_STRING = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;

/**
 * Время встреч показывается по поясу выбранного города, а не по часам устройства:
 * «пробежка в 07:30» в Красноярске выглядит как 07:30 и на московском ноутбуке.
 * Строки без пояса («2026-10-24T10:00») понимаются как местное время этого города.
 */
function dayjs(input?: baseDayjs.ConfigType): baseDayjs.Dayjs {
  const tz = displayZone();
  if (typeof input === 'string' && LOCAL_STRING.test(input)) return baseDayjs.tz(input, tz);
  const d = baseDayjs(input);
  return d.isValid() ? d.tz(tz) : d;
}

// Только типы: позволяет и дальше писать `dayjs.Dayjs` в аннотациях.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace dayjs {
  type Dayjs = baseDayjs.Dayjs;
  type ConfigType = baseDayjs.ConfigType;
}

export { dayjs };

const NB = '\u00A0';

export function dayLabel(iso: string, now = dayjs(), zone = displayZone()): string {
  const d = dayjs(iso).tz(zone);
  now = now.tz(zone);
  if (d.isSame(now, 'day')) return 'Сегодня';
  if (d.isSame(now.add(1, 'day'), 'day')) return 'Завтра';
  if (d.isSame(now.subtract(1, 'day'), 'day')) return 'Вчера';
  return capitalize(d.format('dddd'));
}

/** «Суббота, 25 октября, 10:00»; для ближайших дней — «Завтра, 25 октября, 10:00». */
export function formatEventDate(iso: string, now = dayjs(), zone = displayZone()): string {
  const d = dayjs(iso).tz(zone);
  now = now.tz(zone);
  const pattern = d.isSame(now, 'year') ? 'D MMMM' : 'D MMMM YYYY';
  return `${dayLabel(iso, now, zone)}, ${d.format(pattern)}, ${d.format('HH:mm')}`;
}

/** Для карточек: «Сб, 25 октября». */
export function formatShortDate(iso: string): string {
  const d = dayjs(iso);
  return `${capitalize(d.format('dd'))}, ${d.format('D MMMM')}`;
}

export function formatTime(iso: string): string {
  return dayjs(iso).format('HH:mm');
}

export function formatTimeRange(iso: string, durationMin: number, zone = displayZone()): string {
  const start = dayjs(iso).tz(zone);
  return `${start.format('HH:mm')}–${start.add(durationMin, 'minute').format('HH:mm')}`;
}

export function formatDuration(min: number): string {
  if (min < 60) return count(min, WORDS.minute);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${count(h, WORDS.hour)} ${count(m, WORDS.minute)}` : count(h, WORDS.hour);
}

/** «5 минут назад», «вчера в 21:10», «12 октября в 09:00». */
export function formatAgo(iso: string, now = dayjs()): string {
  const d = dayjs(iso);
  const diffMin = now.diff(d, 'minute');
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${count(diffMin, WORDS.minute)} назад`;
  if (d.isSame(now, 'day')) return `сегодня в${NB}${d.format('HH:mm')}`;
  if (d.isSame(now.subtract(1, 'day'), 'day')) return `вчера в${NB}${d.format('HH:mm')}`;
  return `${d.format(d.isSame(now, 'year') ? 'D MMMM' : 'D MMMM YYYY')} в${NB}${d.format('HH:mm')}`;
}

export function formatDayMonth(iso: string): string {
  return dayjs(iso).format('D MMMM');
}

export function dayPart(iso: string): 'morning' | 'day' | 'evening' {
  const h = dayjs(iso).hour();
  if (h < 12) return 'morning';
  if (h < 17) return 'day';
  return 'evening';
}

/** Границы ближайших выходных; в воскресенье — только сегодняшний день. */
export function weekendRange(now = dayjs()): [dayjs.Dayjs, dayjs.Dayjs] {
  const dow = now.isoWeekday();
  if (dow === 7) return [now.startOf('day'), now.endOf('day')];
  const saturday = now.add(6 - dow, 'day').startOf('day');
  return [saturday, saturday.add(1, 'day').endOf('day')];
}
