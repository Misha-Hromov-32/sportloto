import type { AccessNeed, EventAccessExtra, Venue, VenueFeature, VenueKind } from '@/types/domain';

import { zonedParts } from './timezone';

/** Площадки: подписи и расчёт окон расписания. */

export const VENUE_KIND: Record<VenueKind, string> = {
  hall: 'Спортзал',
  field: 'Поле',
  court: 'Корт',
  pool: 'Бассейн',
  ice: 'Каток',
  studio: 'Студия',
  yard: 'Дворовая площадка',
  park: 'Парк',
};

export const VENUE_FEATURE: Record<VenueFeature, { label: string; short: string; access: boolean }> = {
  ramp: { label: 'Пандус', short: 'Пандус', access: true },
  elevator: { label: 'Лифт', short: 'Лифт', access: true },
  accessibleToilet: { label: 'Туалет для маломобильных', short: 'Доступный туалет', access: true },
  accessibleParking: { label: 'Парковка для маломобильных', short: 'Доступная парковка', access: true },
  lockerRoom: { label: 'Раздевалка', short: 'Раздевалка', access: false },
  shower: { label: 'Душ', short: 'Душ', access: false },
  lighting: { label: 'Освещение вечером', short: 'Освещение', access: false },
};

export const VENUE_FEATURES = Object.keys(VENUE_FEATURE) as VenueFeature[];
export const ACCESS_FEATURES = VENUE_FEATURES.filter((f) => VENUE_FEATURE[f].access);

export const ACCESS_EXTRA: Record<EventAccessExtra, { label: string; hint: string }> = {
  escort: { label: 'Есть сопровождающий', hint: 'Встретит у входа и поможет на месте' },
  adaptiveGear: { label: 'Адаптивный инвентарь', hint: 'Есть снаряжение для людей с инвалидностью' },
};

export const ACCESS_NEED: Record<AccessNeed, string> = {
  ramp: 'Пандус',
  elevator: 'Лифт',
  accessibleToilet: 'Доступный туалет',
  escort: 'Сопровождение',
};

export const ACCESS_NEEDS = Object.keys(ACCESS_NEED) as AccessNeed[];

/** Окна расписания — по 2 часа от открытия до закрытия. */
export const SLOT_MIN = 120;
/** С этого часа действует вечерняя цена. */
export const PEAK_FROM = 18;

const DAY_SHORT = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTH_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const toHhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Начала окон дня по местному времени площадки: «08:00», «10:00»… */
export function slotTimes(hours: Venue['hours']): string[] {
  const open = toMinutes(hours.open);
  const close = toMinutes(hours.close);
  const out: string[] = [];
  for (let t = open; t + SLOT_MIN <= close; t += SLOT_MIN) out.push(toHhmm(t));
  return out;
}

/** Местная дата площадки через `offset` дней от момента `nowMs`. */
export function localDate(nowMs: number, timeZone: string, offset = 0): string {
  const today = zonedParts(new Date(nowMs).toISOString(), timeZone).date;
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
}

export function basePrice(venue: Pick<Venue, 'pricePerHour' | 'peakPricePerHour' | 'timeZone'>, iso: string) {
  if (venue.peakPricePerHour === null) return venue.pricePerHour;
  const { time, weekday } = zonedParts(iso, venue.timeZone);
  const peak = weekday >= 6 || Number(time.slice(0, 2)) >= PEAK_FROM;
  return peak ? venue.peakPricePerHour : venue.pricePerHour;
}

/** «сб, 25 октября» по местному времени площадки. */
export function venueDayLabel(iso: string, timeZone: string): string {
  const { date, weekday } = zonedParts(iso, timeZone);
  const [, m, d] = date.split('-').map(Number);
  return `${DAY_SHORT[weekday]}, ${d} ${MONTH_GEN[(m ?? 1) - 1]}`;
}

/** Цена за час словами: «Бесплатно», «1 500 ₽ в час». */
export function hourPrice(price: number): string {
  if (price <= 0) return 'Бесплатно';
  return `${price.toLocaleString('ru-RU')}\u00A0₽ в час`;
}

/** Обновлено владельцем: «сегодня», «вчера», «5 дней назад». */
export function updatedLabel(days: number): string {
  if (days <= 0) return 'Обновлено владельцем сегодня';
  if (days === 1) return 'Обновлено владельцем вчера';
  const mod10 = days % 10;
  const mod100 = days % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'день'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'дня'
        : 'дней';
  return `Обновлено владельцем ${days} ${word} назад`;
}

/** «сегодня, 18:00–22:00», «завтра, 10:00–12:00», «сб, 25 октября, 10:00–12:00». */
export function windowShort(
  w: { startsAt: string; endsAt: string },
  timeZone: string,
  nowMs = Date.now(),
): string {
  const day = zonedParts(w.startsAt, timeZone).date;
  const from = zonedParts(w.startsAt, timeZone).time;
  const to = zonedParts(w.endsAt, timeZone).time;
  if (day === localDate(nowMs, timeZone)) return `сегодня, ${from}–${to}`;
  if (day === localDate(nowMs, timeZone, 1)) return `завтра, ${from}–${to}`;
  return `${venueDayLabel(w.startsAt, timeZone)}, ${from}–${to}`;
}

/** Местное время площадки: «18:00». */
export function venueTime(iso: string, timeZone: string): string {
  return zonedParts(iso, timeZone).time;
}

/** Подпись дня в расписании: «Сегодня», «Завтра», «Сб». */
export function scheduleDayName(date: string, timeZone: string, nowMs = Date.now()): string {
  if (date === localDate(nowMs, timeZone)) return 'Сегодня';
  if (date === localDate(nowMs, timeZone, 1)) return 'Завтра';
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][weekday]!;
}

/** Номер дня и месяц: «25 окт.». */
export function scheduleDayDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  const short = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${d} ${short[(m ?? 1) - 1]}`;
}

/** «1 500 ₽ в час, вечером и в выходные 2 000 ₽». */
export function venuePriceLine(v: Pick<Venue, 'pricePerHour' | 'peakPricePerHour'>): string {
  if (v.pricePerHour <= 0 && !v.peakPricePerHour) return 'Бесплатно';
  const base = hourPrice(v.pricePerHour);
  if (v.peakPricePerHour === null || v.peakPricePerHour === v.pricePerHour) return base;
  return `${base}, вечером и в выходные ${v.peakPricePerHour.toLocaleString('ru-RU')}\u00A0₽`;
}
